/**
 * THE SCORING ENGINE (Step 12).
 *
 * Plain language:
 *  Each layer is like a teacher giving the match a mark (0..100) per side:
 *    form  (40%) — how well each team played recently
 *    h2h   (30%) — who historically wins when these two meet
 *    odds  (20%) — the bookmakers' collective opinion (de-vigged)
 *    news  (10%) — who is healthier / less tired
 *  Final grade per side = weighted average of the marks.
 *  The side with the higher grade is the "consensus favourite",
 *  and that grade becomes the match CONFIDENCE (0..100).
 *
 *  If a teacher is absent (layer missing), their share is re-divided
 *  among the teachers present (weight renormalisation).
 */
'use strict';

function renormalize(weights, present) {
  const keys = Object.keys(weights).filter((k) => present[k]);
  const total = keys.reduce((a, k) => a + weights[k], 0);
  const out = {};
  keys.forEach((k) => { out[k] = Math.round((weights[k] / total) * 100) / 100; });
  return out;
}

/**
 * analysis = { form:{home,away}|null, h2h:{...}|null, odds:{...}|null, news:{...}|null }
 * weights  = { form:0.4, h2h:0.3, odds:0.2, news:0.1 }  (from config)
 */
function scoreMatch(analysis, weights) {
  const layers = {};
  for (const k of ['form', 'h2h', 'odds', 'news']) {
    if (analysis[k] && analysis[k].home != null && analysis[k].away != null) {
      layers[k] = analysis[k];
    }
  }
  const layerCount = Object.keys(layers).length;
  if (!layerCount) return null;

  const w = renormalize(weights, {
    form: !!layers.form, h2h: !!layers.h2h, odds: !!layers.odds, news: !!layers.news,
  });

  let home = 0, away = 0;
  for (const k of Object.keys(w)) {
    home += w[k] * layers[k].home;
    away += w[k] * layers[k].away;
  }
  home = Math.round(home * 10) / 10;
  away = Math.round(away * 10) / 10;

  const side = home >= away ? 'home' : 'away';
  return {
    favouriteSide: side,
    confidence: Math.max(home, away),
    grades: { home, away },
    layersUsed: Object.keys(layers),
    weightsUsed: w,
  };
}

module.exports = { scoreMatch, renormalize };
