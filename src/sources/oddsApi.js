/**
 * Source #4 — TheOddsAPI (the-odds-api.com), free tier.
 *
 * FREE TIER REALITY (important, explained in Step 11):
 *   ✔ 25 requests/day, no credit card
 *   ✔ sports covered: NBA + MLB only
 *   ✔ market: h2h (moneyline) only
 *   ✔ bookmakers: US books only
 *   ✘ soccer NOT included on free -> our soccer odds come from
 *     API-Football /odds instead (same consensus math).
 */
'use strict';

const BASE = 'https://api.the-odds-api.com/v4';

/** NBA moneylines from US books (when season has upcoming games). */
async function getNbaOdds() {
  const url = `${BASE}/sports/basketball_nba/odds` +
    `?apiKey=${process.env.ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`TheOddsAPI HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const events = await res.json();
  return {
    remaining: res.headers.get('x-requests-remaining'),
    events: (events || []).map((ev) => ({
      sport: 'basketball',
      source: 'the-odds-api',
      ext_id: ev.id,
      league: ev.sport_title || 'NBA',
      home_team: ev.home_team,
      away_team: ev.away_team,
      kickoff: ev.commence_time,
      books: (ev.bookmakers || []).map((b) => {
        const m = (b.markets || []).find((x) => x.key === 'h2h');
        if (!m) return null;
        const odd = (name) => {
          const o = m.outcomes.find((x) => x.name === name);
          return o ? o.price : null;
        };
        return { book: b.title, home: odd(ev.home_team), away: odd(ev.away_team) };
      }).filter(Boolean),
    })),
  };
}

/** Live-demonstrates the free-tier soccer limitation (usually a 403). */
async function probeSoccerRestriction() {
  const url = `${BASE}/sports/soccer_epl/odds` +
    `?apiKey=${process.env.ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  const body = await res.text();
  return { status: res.status, message: body.slice(0, 220) };
}

module.exports = { getNbaOdds, probeSoccerRestriction };
