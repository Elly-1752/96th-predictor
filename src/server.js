/**
 * 96th Predictor Engine — web server.
 * '/' serves a tiny branded status page (so the preview is not blank).
 * '/health' serves JSON diagnostics.
 */
'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const { CONFIG, envStatus } = require('./config');
const { runDailyJob, runDate } = require('./job');
const { countRunsForDate } = require('./db');

const app = express();
app.disable('x-powered-by');

const STATUS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>96th Predictor Engine — Backend</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#FFFFFF;color:#0A0A0A;font-family:Arial,Helvetica,sans-serif}
  .card{border:2px solid #0A0A0A;border-radius:16px;padding:36px 44px;text-align:center;
        box-shadow:0 10px 30px rgba(10,10,10,.12)}
  .mark{width:64px;height:64px;margin:0 auto 14px;border:3px solid #D4AF37;border-radius:16px;
        display:grid;place-items:center;font-size:26px;font-weight:800;color:#D4AF37}
  h1{font-size:18px;letter-spacing:3px;margin:6px 0}
  p{color:#6B6B60;font-size:13px}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#2e9e44;margin-right:6px}
  a{color:#B8942A}
</style>
</head>
<body>
  <div class="card">
    <div class="mark">96</div>
    <h1>96<sup>th</sup> PREDICTOR ENGINE</h1>
    <p><span class="dot"></span>Backend alive — jiko linafanya kazi 🍳</p>
    <p>Diagnostics: <a href="/health">/health</a></p>
  </div>
</body>
</html>`;

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/status', (_req, res) => res.type('html').send(STATUS_HTML));

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), env: envStatus(), config: CONFIG.weights });
});

/** Public, safe-by-design: anon key is meant to be public (RLS limits it to reads). */
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

/**
 * SECURED daily trigger (Step 17) — only cron-job.org knows the secret.
 * Accepts GET or POST; secret via x-cron-secret header OR ?secret= query.
 *
 * IMPORTANT (cron-job.org free tier: max 30s timeout):
 * the job takes ~3 minutes, so we DO NOT wait for it here. We validate the
 * secret, START the job in the background, and answer instantly. The job then
 * runs to completion on this server; watch progress via GET /api/last-run.
 */
let jobState = { running: false, startedAt: null, finishedAt: null, ok: null, error: null, date: null };

function startJobBackground() {
  if (jobState.running) return false;
  jobState = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, error: null, date: null };
  runDailyJob()
    .then((r) => {
      jobState = { ...jobState, running: false, finishedAt: new Date().toISOString(), ok: true, error: null, date: r.date, safeCombined: r.safe.combined, accumCombined: r.accum.combined };
    })
    .catch((e) => {
      jobState = { ...jobState, running: false, finishedAt: new Date().toISOString(), ok: false, error: e.message };
    });
  return true;
}

app.post('/run-daily-job', runJobHandler);
app.get('/run-daily-job', runJobHandler);
function runJobHandler(req, res) {
  const secret = req.get('x-cron-secret') || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!startJobBackground()) {
    return res.json({ ok: true, alreadyRunning: true, startedAt: jobState.startedAt });
  }
  res.json({ ok: true, started: true, note: 'Job running in background — see /api/last-run' });
}

/** Public progress/status of the latest daily job (no secrets). */
app.get('/api/last-run', (_req, res) => res.json(jobState));

/** How many manual runs happened today (EAT) — dashboard shows n/3. */
app.get('/api/runs-today', async (_req, res) => {
  try {
    const count = await countRunsForDate(runDate());
    res.json({ date: runDate(), count, limit: CONFIG.limits.maxRunsPerDay });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * MANUAL trigger from the dashboard button — up to 3 runs per day.
 * A failed run never blocks retries; only the quota-safe daily cap does.
 */
app.post('/api/start-daily-run', async (_req, res) => {
  if (jobState.running) {
    return res.json({ ok: true, alreadyRunning: true, note: 'Job is already running — see /api/last-run' });
  }
  try {
    const count = await countRunsForDate(runDate());
    if (count >= CONFIG.limits.maxRunsPerDay) {
      return res.status(429).json({ ok: false, dailyLimit: true, message: 'Umefikisha runs 3 za leo (ulinzi wa quota ya API). Jaribu tena kesho.' });
    }
  } catch (e) {
    /* DB check failed — allow the run; running-flag still prevents doubles */
  }
  startJobBackground();
  res.json({ ok: true, started: true, note: 'Job running in background — see /api/last-run' });
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, '..', 'public')));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[96th] server listening on :${PORT}`);
  console.log('[96th] env check:', envStatus().map((e) => `${e.name}=${e.present ? 'OK' : 'MISSING'}`).join(' '));
});
