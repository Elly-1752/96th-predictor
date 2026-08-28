/**
 * Bookmaker consensus — the "20% market opinion" layer.
 *
 * Plain language:
 *  1. Every decimal odd hides an implied probability: 1 / odd.
 *     (Odds 2.00 => the book thinks ~50%.)
 *  2. Books add a margin (overround) so probabilities sum to >100%.
 *     We "de-vig": shrink them back until they sum to exactly 100%.
 *  3. We average the de-vigged probabilities across all bookmakers.
 *     That average = the market's collective, de-biased opinion.
 */
'use strict';

/** quote = { home: 2.1, draw: 3.4, away: 3.6 } (any outcome may be missing) */
function devig(quote) {
  const keys = Object.keys(quote).filter((k) => quote[k] > 1);
  if (!keys.length) return null;
  const raw = keys.map((k) => 1 / quote[k]);
  const total = raw.reduce((a, b) => a + b, 0);
  const out = {};
  keys.forEach((k, i) => { out[k] = raw[i] / total; });
  return out;
}

/** books = [ {book, home, draw?, away}, ... ] -> averaged probabilities */
function consensus(books) {
  const devs = (books || []).map(devig).filter(Boolean);
  if (!devs.length) return null;
  const keys = Object.keys(devs[0]);
  const out = {};
  for (const k of keys) {
    out[k] = devs.reduce((a, d) => a + (d[k] || 0), 0) / devs.length;
  }
  // round to 4dp
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10000) / 10000;
  return out;
}

/**
 * REAL consensus price: simple average of the decimal odds the books
 * are actually quoting right now. This is what the user sees in a
 * betslip — we show REAL market prices, not theoretical ones.
 * get = (book) => odd number or null
 */
function meanOdd(books, get) {
  const vals = (books || []).map(get).filter((v) => v && v > 1 && v < 60);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

/** Average de-vigged OVER probability for a goals line, e.g. line='2.5' */
function consensusOver(books, line) {
  const probs = [];
  for (const b of books || []) {
    const q = b.ou && b.ou[line];
    if (!q || !q.over || !q.under) continue;
    probs.push((1 / q.over) / (1 / q.over + 1 / q.under));
  }
  if (!probs.length) return null;
  return Math.round((probs.reduce((a, b) => a + b, 0) / probs.length) * 10000) / 10000;
}

module.exports = { devig, consensus, consensusOver, meanOdd };
