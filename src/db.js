/**
 * Supabase persistence (Step 14) — uses the SERVICE ROLE key.
 * This key bypasses RLS by design, so the backend can write while
 * the public app can only read.
 *
 * The client is created LAZILY (on first use) so the web server can
 * still serve / and /health even before env vars exist.
 */
'use strict';
const { createClient } = require('@supabase/supabase-js');

// Node 20 has no native WebSocket; supabase realtime needs one.
if (!global.WebSocket) {
  try { global.WebSocket = require('ws'); } catch (_) { /* realtime unused anyway */ }
}

let _client = null;
function client() {
  if (!_client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_KEY (set them on Render).');
    }
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _client;
}

/**
 * run = {
 *  run_date, engine_version, safe_combined_odds, accum_combined_odds,
 *  sources_used: [...],
 *  fixtures: [...], safe_picks: [...], accum_legs: [...]
 * }
 */
async function saveRun(run) {
  const sb = client();

  // NOTE: previous runs for the same date are KEPT (history for the 3x/day
  // manual runs). The dashboard always shows the most recent generated_at,
  // so a FAILED run can never wipe an existing card.

  // 1) Insert the run header
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

/** How many runs exist for the given EAT date (manual trigger allows up to 3/day). */
async function countRunsForDate(date) {
  const sb = client();
  const { count, error } = await sb
    .from('daily_runs')
    .select('id', { count: 'exact', head: true })
    .eq('run_date', date);
  if (error) throw new Error(error.message);
  return count || 0;
}

module.exports = { saveRun, countRunsForDate };
