/** Smoke-test of the step-down logic (Step 13) on real markets. */
'use strict';
require('dotenv').config();

const apiSports = require('./sources/apiSports');
const { consensus, consensusOver } = require('./engine/consensus');
const { detectRawSignal, stepDown } = require('./engine/stepdown');

function todayEAT() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
const pc = (x) => (x == null ? '-' : (x * 100).toFixed(0) + '%');

(async () => {
  const d = todayEAT();

  /* ---------------- football examples ---------------- */
  const [fxRes, oddsRes] = await Promise.all([
    apiSports.getFootballFixtures(d),
    apiSports.getFootballOddsByDate(d),
  ]);
  const oddsById = new Map(oddsRes.odds.map((o) => [o.ext_id, o.bookmakers]));
  const cands = fxRes.fixtures.filter((f) => (oddsById.get(f.ext_id) || []).length >= 3).slice(0, 2);

  for (const fx of cands) {
    const books = oddsById.get(fx.ext_id);
    const p1x2 = consensus(books);
    const over25 = consensusOver(books, '2.5');
    const p = { home: p1x2.home, draw: p1x2.draw, away: p1x2.away, over25 };
    const raw = detectRawSignal(p, 'football');
    const { raw: rawM, stepped } = stepDown(raw, {
      sport: 'football', homeTeam: fx.home_team, awayTeam: fx.away_team, p,
    });

    console.log(`\n⚽ ${fx.home_team} vs ${fx.away_team}`);
    console.log(`   consensus: home ${pc(p.home)} draw ${pc(p.draw)} away ${pc(p.away)} | over2.5 ${pc(p.over25)}`);
    console.log(`   RAW signal   : ${raw.signal}  ->  ${rawM.market} "${rawM.selection}" @ ${rawM.odds}`);
    console.log(`   STEPPED (safe): ${stepped.market} "${stepped.selection}" @ ${stepped.odds}`);
    console.log(`   note: ${stepped.note}`);
  }

  /* ---------------- basketball example ---------------- */
  const bb = await apiSports.getBasketballGames(d);
  if (bb.games.length) {
    const g = bb.games[0];
    const books = await apiSports.getBasketballOdds(g.ext_id);
    const c = consensus(books);
    if (c) {
      const p = { home: c.home, away: c.away };
      const raw = detectRawSignal(p, 'basketball');
      const { raw: rawM, stepped } = stepDown(raw, {
        sport: 'basketball', homeTeam: g.home_team, awayTeam: g.away_team, p,
      });
      console.log(`\n🏀 ${g.home_team} vs ${g.away_team}`);
      console.log(`   consensus: home ${pc(p.home)} away ${pc(p.away)}`);
      console.log(`   RAW signal   : ${raw.signal}  ->  ${rawM.market} "${rawM.selection}" @ ${rawM.odds}`);
      console.log(`   STEPPED (safe): ${stepped.market} "${stepped.selection}" @ ${stepped.odds}`);
      console.log(`   note: ${stepped.note}`);
    }
  }

  console.log('\nSTEP-DOWN OK ✔');
})().catch((e) => { console.error('STEPDOWN TEST FAILED:', e.message); process.exit(1); });
