/** Manual smoke-test of the data-fetching layer (Step 10). */
'use strict';
require('dotenv').config();

const fd = require('./sources/footballData');
const as = require('./sources/apiSports');

function todayEAT() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

(async () => {
  const d = todayEAT();
  console.log('EAT date:', d);

  // 1) football-data.org — today's top-league fixtures
  const fdMatches = await fd.getMatchesByDate(d);
  console.log('\n[football-data.org] matches today:', fdMatches.length);
  fdMatches.slice(0, 3).forEach((m) =>
    console.log('   ', m.league, '|', m.home_team, 'vs', m.away_team, '|', (m.kickoff || '').slice(11, 16), 'UTC'));

  // 2) API-Football — wide fixtures
  const fb = await as.getFootballFixtures(d);
  console.log('\n[api-football] fixtures today:', fb.fixtures.length, '| requests remaining:', fb.remaining);

  // 3) predictions (form + H2H) + injuries for the first 2 fixtures
  for (const fx of fb.fixtures.slice(0, 2)) {
    const pred = await as.getFootballPrediction(fx.ext_id);
    const inj = await as.getFootballInjuries(fx.ext_id);
    console.log(`\n[api-football] ${fx.home_team} vs ${fx.away_team}`);
    console.log('    advice:', pred && pred.advice);
    console.log('    win%  :', pred && pred.winProb && JSON.stringify(pred.winProb));
    console.log('    form  : home', pred && pred.formHome, '| away', pred && pred.formAway);
    console.log('    injured/suspended teams:', Object.keys(inj).length ? Object.keys(inj).join(', ') : 'none reported');
  }

  // 4) API-Basketball — games today (+ odds for the first game)
  const bb = await as.getBasketballGames(d);
  console.log('\n[api-basketball] games today:', bb.games.length, '| requests remaining:', bb.remaining);
  if (bb.games.length) {
    console.log('    e.g.', bb.games[0].league, '|', bb.games[0].home_team, 'vs', bb.games[0].away_team);
    const odds = await as.getBasketballOdds(bb.games[0].ext_id);
    console.log('    books quoting game #1:', odds.length ? odds.map((o) => o.book).slice(0, 4).join(', ') : 'none');
  }

  console.log('\nFETCH LAYER OK ✔');
})().catch((e) => { console.error('FETCH TEST FAILED:', e.message); process.exit(1); });
