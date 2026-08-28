/**
 * Builds a clean "analysis" object per match from the raw API data.
 * Think of it as translating every source into ONE common language:
 * a 0..100 score per side for each of the four layers.
 */
'use strict';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** "45%" or 45 -> 45 ; null -> null */
function pct(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace('%', ''));
  return isNaN(n) ? null : n;
}

/** form given as percent, or as a string like "WWDLW" (W=1, D=0.5) */
function formScore(pctValue, last5) {
  const p = pct(pctValue);
  if (p != null) return clamp(p, 0, 100);
  if (last5 && last5.length) {
    let s = 0;
    for (const ch of last5) {
      if (ch === 'W') s += 1;
      else if (ch === 'D') s += 0.5;
    }
    return clamp((s / last5.length) * 100, 0, 100);
  }
  return null; // layer missing
}

/** H2H percentages {home, draw, away} -> score per side (draws split half-half) */
function h2hScores(h2h) {
  if (!h2h) return null;
  const h = pct(h2h.home), d = pct(h2h.draw), a = pct(h2h.away);
  if (h == null || a == null) return null;
  const half = (d || 0) / 2;
  return { home: clamp(h + half, 0, 100), away: clamp(a + half, 0, 100) };
}

/** injuries map { teamName: [ ... ] } -> news score per side */
function newsScores(injuries, homeName, awayName) {
  if (!injuries) return null;
  const homeOut = (injuries[homeName] || []).length;
  const awayOut = (injuries[awayName] || []).length;
  if (!homeOut && !awayOut && !Object.keys(injuries).length) return null; // nothing reported at all
  return {
    home: clamp(96 - homeOut * 9 + awayOut * 2, 0, 100),
    away: clamp(96 - awayOut * 9 + homeOut * 2, 0, 100),
  };
}

function buildAnalysis({ prediction, oddsConsensus, injuries, homeName, awayName }) {
  return {
    form: prediction
      ? {
          home: formScore(prediction.formHome, prediction.last5Home),
          away: formScore(prediction.formAway, prediction.last5Away),
        }
      : null,
    h2h: prediction ? h2hScores(prediction.h2h) : null,
    odds: oddsConsensus
      ? { home: oddsConsensus.home * 100, away: (oddsConsensus.away || 0) * 100 }
      : null,
    news: newsScores(injuries, homeName, awayName),
  };
}

module.exports = { buildAnalysis, clamp };
