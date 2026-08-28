/* 96th Predictor Engine — dashboard.
   Reads DIRECTLY from Supabase (anon key, RLS = read-only). No libraries. */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function eatNow() { return new Date(Date.now() + 3 * 3600 * 1000); }
function fmtDate(dstr) {
  const d = new Date(dstr + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function fmtTimeEAT(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }) + ' EAT';
}
function fmtKick(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }) + ' EAT';
}

async function main() {
  const cfgRes = await fetch('/api/config');
  const cfg = await cfgRes.json();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Backend has no Supabase config yet.');

  const H = { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey };
  const get = async (path) => {
    const r = await fetch(cfg.supabaseUrl + '/rest/v1/' + path, { headers: H });
    if (!r.ok) throw new Error('Supabase HTTP ' + r.status);
    return r.json();
  };

  // latest run (today's card, or most recent if today not generated yet)
  const runs = await get('daily_runs?order=run_date.desc&limit=1');
  if (!runs.length) throw new Error('No runs yet.');
  const run = runs[0];

  const [safe, legs] = await Promise.all([
    get(`safe_picks?run_id=eq.${run.id}&order=position.asc`),
    get(`accumulator_legs?run_id=eq.${run.id}&order=position.asc`),
  ]);

  $('loading').classList.add('hidden');
  $('error').classList.add('hidden');
  $('content').classList.remove('hidden');

  $('card-date').textContent = fmtDate(run.run_date);
  $('generated-at').textContent = fmtTimeEAT(run.generated_at);
  $('safe-combined').textContent = 'Combined ' + Number(run.safe_combined_odds).toFixed(2);
  $('accum-combined').textContent = 'Combined ' + Number(run.accum_combined_odds).toFixed(2);

  const row = (p, showNote) => `
    <tr>
      <td class="pos">${esc(p.position)}</td>
      <td>
        <div class="match-teams">${esc(p.home_team)} <span style="color:var(--grey);font-weight:400">vs</span> ${esc(p.away_team)}</div>
        <div class="match-meta">
          <span class="sport-dot ${p.sport}">${p.sport === 'football' ? '⚽ FOOTBALL' : '🏀 BASKETBALL'}</span>
          ${esc(p.league)}${p.kickoff ? ' · ' + fmtKick(p.kickoff) : ''}
        </div>
      </td>
      <td>
        <div class="market-name">${esc(p.market)}</div>
        <div class="selection-name">${esc(p.selection)}</div>
        ${showNote && p.step_down_note ? `<div class="step-note">${esc(p.step_down_note)}</div>` : ''}
      </td>
      <td><span class="odds-chip">${Number(p.odds).toFixed(2)}</span></td>
      <td>
        <span class="conf-val">${Math.round(Number(p.confidence))}%</span>
        <div class="conf-bar"><span style="width:${Math.round(Number(p.confidence))}%"></span></div>
      </td>
    </tr>`;

  $('safe-body').innerHTML = safe.map((p) => row(p, true)).join('');

  const legsHtml = legs.map((p) => row(p, false)).join('');
  const totalRow = legs.length ? `
    <tr class="total-row">
      <td></td><td>TOTAL — ${legs.length} legs</td><td>Every leg cleared the confidence threshold</td>
      <td><span class="odds-chip">${Number(run.accum_combined_odds).toFixed(2)}</span></td><td></td>
    </tr>` : '';
  $('accum-body').innerHTML = legsHtml + totalRow;

  /* ---------- copy-to-clipboard (fast manual entry at any bookmaker) ---------- */
  const fmtList = (title, rows, combined, rule) =>
    `96th PREDICTOR — ${title} (${fmtDate(run.run_date)})\n` +
    rows.map((p) => `${p.position}) ${p.selection} @${Number(p.odds).toFixed(2)}\n   ${p.home_team} vs ${p.away_team} — ${p.league}`).join('\n') +
    `\nCombined: ${Number(combined).toFixed(2)} (${rule})`;

  const wire = (id, text) => {
    const b = $(id);
    if (!b) return;
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = 'Copied ✔';
        setTimeout(() => { b.textContent = 'Copy'; }, 2000);
      } catch (_) { b.textContent = 'Select manually'; }
    };
  };
  wire('copy-safe', fmtList('SAFE PICKS', safe, run.safe_combined_odds, 'min 3.00'));
  wire('copy-accum', fmtList('ACCUMULATOR', legs, run.accum_combined_odds, 'min 10.00'));

  initManualRun(run.run_date);
}

/* ------------------------------------------------- manual once-a-day run */
function initManualRun(currentRunDate) {
  const btn = $('run-btn');
  const st = $('run-status');
  const overlay = $('wait-overlay');
  const waitMsg = $('wait-msg');
  if (!btn) return;
  const todayStr = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  let poll = null;
  let msgTimer = null;

  const MSGS = [
    'Inakusanya mechi za leo (08:00 EAT kuendelea)…',
    'Inasoma odds HALISI za mabookmaker…',
    'Inapima form, H2H na majeraha…',
    'Inapunguza risk (step-down)…',
    'Inajenga SAFE PICKS (min 3.00)…',
    'Inajenga ACCUMULATOR (min 10.00)…',
  ];
  let msgIdx = 0;

  const showWait = () => {
    overlay.classList.remove('hidden');
    waitMsg.textContent = MSGS[0];
    msgIdx = 0;
    if (msgTimer) clearInterval(msgTimer);
    msgTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % MSGS.length;
      waitMsg.textContent = MSGS[msgIdx];
    }, 5000);
  };
  const hideWait = () => {
    if (msgTimer) clearInterval(msgTimer);
    msgTimer = null;
    overlay.classList.add('hidden');
  };

  const setDone = () => {
    btn.disabled = true;
    btn.textContent = '✔ Card ya leo tayari';
    st.textContent = 'Imezalishwa leo. Kesho bofya ⚡ tena unapoamka.';
  };

  const startPolling = () => {
    btn.disabled = true;
    btn.textContent = '⏳ Inachambua…';
    showWait();
    if (poll) clearInterval(poll);
    poll = setInterval(async () => {
      let s = null;
      try { s = await (await fetch('/api/last-run')).json(); } catch (_) { return; }
      if (!s || s.running) return;
      clearInterval(poll); poll = null;
      if (s.ok) {
        waitMsg.textContent = '✔ Imekamilika! Inapakia card mpya…';
        setTimeout(() => { hideWait(); location.reload(); }, 900);
      } else {
        hideWait();
        btn.disabled = false;
        btn.textContent = '⚡ Jaribu tena';
        st.textContent = 'Job imeshindwa: ' + (s.error || 'unknown error');
      }
    }, 8000);
  };

  if (currentRunDate === todayStr) { setDone(); }

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Inaanza…';
    let r = null;
    try { r = await (await fetch('/api/start-daily-run', { method: 'POST' })).json(); } catch (_) { r = { ok: false }; }
    if (r.alreadyRanToday) { setDone(); return; }
    startPolling();
  };

  // if a run is already in progress (page opened mid-run), resume the waiting screen
  fetch('/api/last-run').then((x) => x.json()).then((s) => {
    if (s && s.running) startPolling();
  }).catch(() => {});
}

main().catch((e) => {
  console.error(e);
  $('loading').classList.add('hidden');
  $('error').classList.remove('hidden');
  $('error-detail').textContent = e.message;
  initManualRun(null); // no runs yet — the manual button must still work
});

/* ------------------------------------------------- PWA: install + offline */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('install-btn');
  if (btn) {
    btn.classList.remove('hidden');
    btn.onclick = async () => {
      btn.classList.add('hidden');
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    };
  }
});
window.addEventListener('appinstalled', () => {
  const btn = $('install-btn');
  if (btn) btn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
