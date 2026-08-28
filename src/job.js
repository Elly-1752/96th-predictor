/**
 * THE DAILY JOB (Step 14) — the whole pipeline in order:
 *   fetch -> score -> step-down -> select -> save to Supabase.
 * Triggered once a day at 03:00 EAT by cron-job.org (Phase 4),
 * and manually right now for testing.
 */
'use strict';

const footballData = require('./sources/footballData');
const apiSports = require('./sources/apiSports');
const { consensus, consensusOver, meanOdd } = require('./engine/consensus');
const { buildAnalysis } = require('./engine/analysis');
const { scoreMatch } = require('./engine/scoring');
const { detectRawSignal, stepDown } = require('./engine/stepdown');
const { selectDaily } = require('./engine/select');
const { saveRun } = require('./db');
const { CONFIG } = require('./config');

const PRIORITY_LEAGUES = [
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
  'UEFA Champions League', 'UEFA Europa League', 'Eredivisie', 'Primeira Liga',
  'Championship', 'NBA', 'Euroleague',
];

function todayEAT() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Kickoff policy (user rule):
 *  - the match must still be UPCOMING at run time (no past games), and
 *  - its EAT local start time must be 08:00 or later (the user sleeps 00:00-08:00).
 */
function kickoffAllowed(iso, nowMs) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t) || t < nowMs) return false;
  const eatHour = new Date(t + 3 * 3600 * 1000).getUTCHours();
  return eatHour >= 8;
}

async function runDailyJob() {
  const date = todayEAT();
  const sources = [];
  const started = Date.now();

  /* ---------- 1) football-data.org (coverage layer) ---------- */
  try {
    const m = await footballData.getMatchesByDate(date);
    sources.push({ id: 'football-data.org', role: 'fixtures/top-leagues', ok: true, fixtures: m.length });
  } catch (e) {
    sources.push({ id: 'football-data.org', role: 'fixtures/top-leagues', ok: false, error: e.message });
  }

  /* ---------- 2) API-Football fixtures + odds ---------- */
  const [fxRes, oddsRes] = await Promise.all([
    apiSports.getFootballFixtures(date),
    apiSports.getFootballOddsByDate(date),
  ]);
  sources.push({ id: 'api-football', role: 'fixtures+form+h2h+injuries+odds', ok: true, fixtures: fxRes.fixtures.length });
  const oddsById = new Map(oddsRes.odds.map((o) => [o.ext_id, o.bookmakers]));

  // candidates: real bookmaker coverage, priority leagues first, max 10 (request budget)
  const nowMs = Date.now();
  const covered = fxRes.fixtures
    .filter((f) => (oddsById.get(f.ext_id) || []).length >= 2)
    .filter((f) => kickoffAllowed(f.kickoff, nowMs));
  const candidates = covered
    .sort((a, b) => {
      const pa = PRIORITY_LEAGUES.includes(a.league) ? 0 : 1;
      const pb = PRIORITY_LEAGUES.includes(b.league) ? 0 : 1;
      return pa - pb || String(a.kickoff).localeCompare(String(b.kickoff));
    })
    .slice(0, 8); // request-budget: 8 fixtures x (predictions+injuries) ≈ 16 calls

  /* ---------- 3) score + step-down each football candidate ---------- */
  const scored = [];
  const evidenceRows = [];

  for (const fx of candidates) {
    const books = oddsById.get(fx.ext_id);
    const prediction = await apiSports.getFootballPrediction(fx.ext_id);
    const injuries = await apiSports.getFootballInjuries(fx.ext_id);

    const cons = consensus(books);
    const over25 = consensusOver(books, '2.5');
    if (!cons) continue;

    const analysis = buildAnalysis({
      prediction,
      oddsConsensus: cons,
      injuries,
      homeName: fx.home_team,
      awayName: fx.away_team,
    });
    const score = scoreMatch(analysis, CONFIG.weights);
    if (!score) continue;

    // REAL live prices quoted by the books right now (what a betslip shows)
    const real = {
      winHome: meanOdd(books, (b) => b.home),
      winDraw: meanOdd(books, (b) => b.draw),
      winAway: meanOdd(books, (b) => b.away),
      dcHome: meanOdd(books, (b) => b.dc && b.dc['1X']),
      dcAway: meanOdd(books, (b) => b.dc && b.dc['X2']),
      over15: meanOdd(books, (b) => b.ou && b.ou['1.5'] && b.ou['1.5'].over),
      over25: meanOdd(books, (b) => b.ou && b.ou['2.5'] && b.ou['2.5'].over),
    };

    const p = { home: cons.home, draw: cons.draw, away: cons.away, over25 };
    const raw = detectRawSignal(p, 'football');
    const sd = stepDown(raw, { sport: 'football', homeTeam: fx.home_team, awayTeam: fx.away_team, p, real });

    scored.push({
      league: fx.league, sport: 'football', home: fx.home_team, away: fx.away_team,
      kickoff: fx.kickoff, confidence: score.confidence, rawSignal: raw.signal,
      stepped: sd.stepped, raw: sd.raw,
    });

    evidenceRows.push({
      sport: 'football', league: fx.league, country: fx.country,
      home_team: fx.home_team, away_team: fx.away_team, kickoff: fx.kickoff,
      form: analysis.form, h2h: analysis.h2h,
      odds: p, news: analysis.news,
    });
  }

  /* ---------- 4) basketball (games + odds) ---------- */
  try {
    const bb = await apiSports.getBasketballGames(date);
    sources.push({ id: 'api-basketball', role: 'games+odds', ok: true, fixtures: bb.games.length });
    for (const g of bb.games.slice(0, 6)) {
      if (!kickoffAllowed(g.kickoff, nowMs)) continue;
      const books = await apiSports.getBasketballOdds(g.ext_id);
      const cons = consensus(books);
      if (!cons) continue;
      const analysis = { form: null, h2h: null, odds: { home: cons.home * 100, away: cons.away * 100 }, news: null };
      const score = scoreMatch(analysis, CONFIG.weights);
      if (!score) continue;
      const real = {
        mlHome: meanOdd(books, (b) => b.home),
        mlAway: meanOdd(books, (b) => b.away),
        books, // spreads for the safer-handicap step-down
      };
      const p = { home: cons.home, away: cons.away };
      const raw = detectRawSignal(p, 'basketball');
      const sd = stepDown(raw, { sport: 'basketball', homeTeam: g.home_team, awayTeam: g.away_team, p, real });
      scored.push({
        league: g.league, sport: 'basketball', home: g.home_team, away: g.away_team,
        kickoff: g.kickoff, confidence: score.confidence, rawSignal: raw.signal,
        stepped: sd.stepped, raw: sd.raw,
      });
      evidenceRows.push({
        sport: 'basketball', league: g.league, country: g.country,
        home_team: g.home_team, away_team: g.away_team, kickoff: g.kickoff,
        form: null, h2h: null, odds: p, news: null,
      });
    }
  } catch (e) {
    sources.push({ id: 'api-basketball', role: 'games+odds', ok: false, error: e.message });
  }

  /* ---------- 5) select the two tables (floors: safe>=2.5/3.0, accum>=10) ---------- */
  const sel = selectDaily(scored, CONFIG);
  const realCount = [...sel.safe.picked, ...sel.accum.picked].filter((c) => c.realOdds).length;

  /* ---------- 6) persist to Supabase ---------- */
  const run = {
    run_date: date,
    engine_version: '1.0',
    safe_combined_odds: sel.safe.combined,
    accum_combined_odds: sel.accum.combined,
    sources_used: sources,
    fixtures: evidenceRows,
    safe_picks: sel.safe.picked.map((c, i) => ({
      position: i + 1, sport: c.sport, league: c.league,
      home_team: c.home, away_team: c.away, kickoff: c.kickoff,
      raw_signal: c.rawSignal, market: c.market, selection: c.selection,
      odds: c.odds, confidence: c.confidence, step_down_note: c.note,
    })),
    accum_legs: sel.accum.picked.map((c, i) => ({
      position: i + 1, sport: c.sport, league: c.league,
      home_team: c.home, away_team: c.away, kickoff: c.kickoff,
      raw_signal: c.rawSignal, market: c.market, selection: c.selection,
      odds: c.odds, confidence: c.confidence,
    })),
  };

  const runId = await saveRun(run);

  return {
    runId,
    date,
    analysed: scored.length,
    safe: sel.safe,
    accum: sel.accum,
    adjusted: sel.adjusted,
    warnings: sel.warnings,
    realOddsPicks: realCount,
    sources,
    ms: Date.now() - started,
  };
}

module.exports = { runDailyJob, todayEAT, kickoffAllowed };
