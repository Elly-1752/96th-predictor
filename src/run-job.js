/** Manual trigger for the daily job (also used later by the cron endpoint). */
'use strict';
require('dotenv').config();

const { runDailyJob } = require('./job');

runDailyJob()
  .then((r) => {
    console.log(`\n=== DAILY JOB DONE — ${r.date} (run #${r.runId}, ${r.ms}ms) ===`);
    console.log('sources:', r.sources.map((s) => `${s.id}${s.ok ? '' : '(FAIL)'}`).join(', '));
    console.log(`analysed ${r.analysed} fixtures`);
    console.log(`\nTABLE 1 — SAFE PICKS (combined ${r.safe.combined} | target >=3.00, floor 2.50, no max):`);
    r.safe.picked.forEach((c, i) =>
      console.log(`  ${i + 1}. [${c.sport}] ${c.home} vs ${c.away} | ${c.market}: ${c.selection} @ ${c.odds} (${c.realOdds ? 'REAL odds' : 'est.'}) | conf ${c.confidence}`));
    console.log(`\nTABLE 2 — ACCUMULATOR (combined ${r.accum.combined} | minimum 10.00, no max):`);
    r.accum.picked.forEach((c, i) =>
      console.log(`  ${i + 1}. [${c.sport}] ${c.home} vs ${c.away} | ${c.market}: ${c.selection} @ ${c.odds} (${c.realOdds ? 'REAL odds' : 'est.'}) | conf ${c.confidence}`));
    if (Object.keys(r.adjusted).length) console.log('\nthreshold adjustments:', JSON.stringify(r.adjusted));
    if (r.warnings && r.warnings.length) console.log('\nWARNINGS:', r.warnings.join(' | '));
    console.log(`\nreal bookmaker prices used in ${r.realOddsPicks}/${r.safe.picked.length + r.accum.picked.length} picks`);
    console.log('\nSaved to Supabase ✔');
  })
  .catch((e) => {
    console.error('JOB FAILED:', e.message);
    process.exit(1);
  });
