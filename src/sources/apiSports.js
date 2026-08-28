/**
 * Source #2 & #3 — API-SPORTS family (API-Football v3 + API-Basketball v1).
 * Free tier: 100 requests/day PER API. Key goes in `x-apisports-key` header.
 *
 * Daily budget plan (soccer):  fixtures(1) + odds-by-date(1) +
 *   predictions(~10-15) + injuries(~10-15)  ≈ 25-35 requests — well under 100.
 * Basketball: games(1) + odds per game (~5) ≈ 6 requests.
 */
'use strict';

const FB = 'https://v3.football.api-sports.io';
const BB = 'https://v1.basketball.api-sports.io';

// Free tier = 10 requests/minute AND 100/day.
// => space calls 6.5s apart; when the API answers with a rate-limit error
//    (HTTP 429, or HTTP 200 with errors.rateLimit + empty response),
//    wait and retry.
const SPACING_MS = 6500;
let lastCall = 0;

async function apiGet(base, path) {
  for (let attempt = 0; ; attempt++) {
    const wait = Math.max(0, lastCall + SPACING_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();

    const res = await fetch(`${base}${path}`, {
      headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
    });
    const json = await res.json().catch(() => ({}));
    if (json.errors && json.errors.requests) {
      throw new Error('API-SPORTS DAILY LIMIT reached (100/day) — resets at midnight UTC. Job will succeed after reset.');
    }
    const rateLimited = res.status === 429 || (json.errors && json.errors.rateLimit);

    if (rateLimited && attempt < 2) {
      await new Promise((r) => setTimeout(r, 8000));
      continue;
    }
    if (!res.ok || rateLimited) {
      throw new Error(`API-SPORTS ${path} HTTP ${res.status} ${JSON.stringify(json.errors || {})}`);
    }
    return {
      data: json.response || [],
      remaining: res.headers.get('x-ratelimit-requests-remaining'),
    };
  }
}

/* ------------------------------------------------------------- FOOTBALL */

/** All fixtures for a date (wide league coverage). */
async function getFootballFixtures(dateStr) {
  const { data, remaining } = await apiGet(FB, `/fixtures?date=${dateStr}&timezone=Africa/Dar_es_Salaam`);
  return {
    remaining,
    fixtures: data.map((f) => ({
      sport: 'football',
      source: 'api-football',
      ext_id: f.fixture.id,
      league: f.league.name,
      country: f.league.country,
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      kickoff: f.fixture.date,
      status: f.fixture.status.short,
    })),
  };
}

/** Bookmaker odds for ALL fixtures on a date — ONE request. */
async function getFootballOddsByDate(dateStr) {
  const { data, remaining } = await apiGet(FB, `/odds?date=${dateStr}&timezone=Africa/Dar_es_Salaam`);
  return {
    remaining,
    odds: data.map((o) => ({
      ext_id: o.fixture.id,
      bookmakers: (o.bookmakers || [])
        .filter((b) => b.name !== 'Betfair') // exchange handled separately if ever needed
        .map((b) => {
          const h2h = (b.bets || []).find((x) => x.id === 1); // Match Winner (1X2)
          const ou = (b.bets || []).find((x) => x.id === 5);  // Over/Under goals
          const dc = (b.bets || []).find((x) => x.id === 10); // Double Chance
          if (!h2h) return null;
          const get = (v) => { const o2 = h2h.values.find((x) => x.value === v); return o2 ? o2.odd : null; };
          // over/under prices per goal line, e.g. ou['2.5'] = { over: 1.9, under: 1.9 }
          const ouMap = {};
          if (ou) {
            for (const v of ou.values || []) {
              const m = /^(Over|Under)\s+(\d+(?:\.\d+)?)$/.exec(v.value || '');
              if (!m) continue;
              const line = m[2];
              ouMap[line] = ouMap[line] || {};
              ouMap[line][m[1] === 'Over' ? 'over' : 'under'] = +v.odd;
            }
          }
          // Double Chance: value Home = 1X, Away = X2, Draw = 12
          const dcMap = {};
          if (dc) {
            for (const v of dc.values || []) {
              if (v.value === 'Home') dcMap['1X'] = +v.odd;
              if (v.value === 'Away') dcMap['X2'] = +v.odd;
              if (v.value === 'Draw') dcMap['12'] = +v.odd;
            }
          }
          return { book: b.name, home: +get('Home'), draw: +get('Draw'), away: +get('Away'), ou: ouMap, dc: dcMap };
        })
        .filter(Boolean),
    })),
  };
}

/** Form + H2H + comparison bundled in ONE request per fixture. */
async function getFootballPrediction(fixtureId) {
  const { data } = await apiGet(FB, `/predictions?fixture=${fixtureId}`);
  const p = Array.isArray(data) ? data[0] : data;
  if (!p) return null;
  const c = p.comparison || {};
  return {
    ext_id: fixtureId,
    advice: p.predictions && p.predictions.advice,
    winProb: p.predictions && p.predictions.percent ? {
      home: parseFloat(p.predictions.percent.home),
      draw: parseFloat(p.predictions.percent.draw),
      away: parseFloat(p.predictions.percent.away),
    } : null,
    formHome: c.form ? c.form.home : null,   // e.g. "WWDLW"
    formAway: c.form ? c.form.away : null,
    h2h: c.h2h || null,                       // { home: %, draw: %, away: % , matches:[...] }
    last5Home: (p.team && p.team.home && p.team.home.league && p.team.home.form) || null,
    last5Away: (p.team && p.team.away && p.team.away.league && p.team.away.form) || null,
  };
}

/** Injuries + suspensions for ONE fixture. */
async function getFootballInjuries(fixtureId) {
  const { data } = await apiGet(FB, `/injuries?fixture=${fixtureId}`);
  const byTeam = {};
  for (const row of data || []) {
    const team = row.team ? row.team.name : 'Unknown';
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push({ player: row.player ? row.player.name : null, reason: row.player ? row.player.reason : null });
  }
  return byTeam;
}

/* ----------------------------------------------------------- BASKETBALL */

/** Basketball games for a date (NBA, EuroLeague, ...). */
async function getBasketballGames(dateStr) {
  const { data, remaining } = await apiGet(BB, `/games?date=${dateStr}&timezone=Africa/Dar_es_Salaam`);
  return {
    remaining,
    games: data.map((g) => ({
      sport: 'basketball',
      source: 'api-basketball',
      ext_id: g.id,
      league: g.league ? g.league.name : 'Unknown',
      country: g.league && g.league.country ? g.league.country.name : null,
      home_team: g.teams.home.name,
      away_team: g.teams.away.name,
      kickoff: g.date,
    })),
  };
}

/** Bookmaker odds for ONE basketball game (ML + spreads + totals). */
async function getBasketballOdds(gameId) {
  const { data } = await apiGet(BB, `/odds?game=${gameId}`);
  const out = [];
  for (const o of data || []) {
    for (const b of o.bookmakers || []) {
      const ml = (b.bets || []).find((x) => x.id === 1);  // Match Winner
      const hd = (b.bets || []).find((x) => x.id === 2);  // Handicap / spread
      if (!ml) continue;
      const getMl = (v) => { const x = ml.values.find((y) => y.value === v); return x ? +x.odd : null; };
      // spread values look like "Home-5.5" / "Away+5.5"
      const spread = [];
      if (hd) {
        for (const v of hd.values || []) {
          const m = /^(Home|Away)([+-]\d+(?:\.\d+)?)$/.exec(v.value || '');
          if (!m) continue;
          spread.push({ side: m[1] === 'Home' ? 'home' : 'away', line: parseFloat(m[2]), odd: +v.odd });
        }
      }
      out.push({ book: b.name, home: getMl('Home'), away: getMl('Away'), spread });
    }
  }
  return out;
}

module.exports = {
  getFootballFixtures,
  getFootballOddsByDate,
  getFootballPrediction,
  getFootballInjuries,
  getBasketballGames,
  getBasketballOdds,
};
