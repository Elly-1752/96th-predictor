/** Smoke-test of the scoring engine (Step 12) on REAL today's matches. */
'use strict';
require('dotenv').config();

const apiSports = require('./sources/apiSports');
const { consensus } = require('./engine/consensus');
const { buildAnalysis } = require('./engine/analysis');
const { scoreMatch } = require('./engine/scoring');
const { CONFIG } = require('./config');

function todayEAT() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

(async () => {
  const d = todayEAT();
  const [fxRes, oddsRes] = await Promise.all([
    apiSports.getFootballFixtures(d),
    apiSports.getFootballOddsByDate(d),
  ]);
  const oddsById = new Map(oddsRes.odds.map((o) => [o.ext_id, o.bookmakers]));

  // pick up to 3 fixtures that have bookmaker coverage
  const candidates = fxRes.fixtures.filter((f) => (oddsById.get(f.ext_id) || []).length >= 2).slice(0, 3);

  for (const fx of candidates) {
    const prediction = await apiSports.getFootballPrediction(fx.ext_id);
    const injuries = await apiSports.getFootballInjuries(fx.ext_id);
    const cons = consensus(oddsById.get(fx.ext_id));

    const analysis = buildAnalysis({
      prediction,
      oddsConsensus: cons,
      injuries,
      homeName: fx.home_team,
      awayName: fx.away_team,
    });
    const score = scoreMatch(analysis, CONFIG.weights);

    console.log(`\n⚽ ${fx.home_team} vs ${fx.away_team}  (${fx.league})`);
    console.log(`   layers used : ${score.layersUsed.join(', ')}`);
    console.log(`   grades      : home ${score.grades.home} | away ${score.grades.away}`);
    const fav = score.favouriteSide === 'home' ? fx.home_team : fx.away_team;
    console.log(`   favourite   : ${fav}  ->  CONFIDENCE ${score.confidence}/100`);
  }

  console.log('\nSCORING ENGINE OK ✔');
})().catch((e) => { console.error('SCORE TEST FAILED:', e.message); process.exit(1); });
