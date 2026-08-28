/**
 * Supabase persistence (Step 14) — uses the SERVICE ROLE key.
 * This key bypasses RLS by design, so the backend can write while
 * the public app can only read.
 */
'use strict';
const { createClient } = require('@supabase/supabase-js');

// Node 20 has no native WebSocket; supabase realtime needs one.
if (!global.WebSocket) {
  try { global.WebSocket = require('ws'); } catch (_) { /* realtime unused anyway */ }
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * run = {
 *  run_date, engine_version, safe_combined_odds, accum_combined_odds,
 *  sources_used: [...],
 *  fixtures: [ {sport,league,country,home_team,away_team,kickoff,form,h2h,odds,news} ],
 *  safe_picks: [ {position,sport,league,home_team,away_team,kickoff,raw_signal,market,selection,odds,confidence,step_down_note} ],
 *  accum_legs: [ same shape without step_down_note ]
 * }
 */
async function saveRun(run) {
  // 1) Replace any previous run for this EAT date (cascade deletes old rows)
  const del = await sb.from('daily_runs').delete().eq('run_date', run.run_date);
  if (del.error) throw new Error('delete old run: ' + del.error.message);

  // 2) Insert the run header
  const insRun = await sb
    .from('daily_runs')
    .insert({
      run_date: run.run_date,
      engine_version: run.engine_version,
      safe_combined_odds: run.safe_combined_odds,
      accum_combined_odds: run.accum_combined_odds,
      sources_used: run.sources_used,
    })
    .select()
    .single();
  if (insRun.error) throw new Error('insert run: ' + insRun.error.message);
  const runId = insRun.data.id;

  // 3) Evidence cache (fixtures)
  if (run.fixtures.length) {
    const f = await sb.from('fixtures').insert(
      run.fixtures.map((fx) => ({ run_id: runId, ...fx }))
    );
    if (f.error) throw new Error('insert fixtures: ' + f.error.message);
  }

  // 4) Table 1 rows
  if (run.safe_picks.length) {
    const s = await sb.from('safe_picks').insert(
      run.safe_picks.map((p) => ({ run_id: runId, run_date: run.run_date, ...p }))
    );
    if (s.error) throw new Error('insert safe_picks: ' + s.error.message);
  }

  // 5) Table 2 rows
  if (run.accum_legs.length) {
    const a = await sb.from('accumulator_legs').insert(
      run.accum_legs.map((p) => ({ run_id: runId, run_date: run.run_date, ...p }))
    );
    if (a.error) throw new Error('insert accumulator_legs: ' + a.error.message);
  }

  return runId;
}

module.exports = { saveRun, sb };
