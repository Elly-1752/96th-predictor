/**
 * DAILY SELECTION — user product rule v3:
 *   Table 1 SAFE:        UNLIMITED legs; combined odds must land in [2.00 .. 3.00].
 *   Table 2 ACCUMULATOR: UNLIMITED legs; combined odds MINIMUM 10.00, no maximum.
 *
 * Strategy: best confidence first; keep adding legs until the minimum target is
 * reached, but NEVER add a leg that would push SAFE above 3.00 (last resort for
 * the minimum-leg count may exceed it, flagged with a warning).
 * Prefer spreading across leagues. Thin market day -> publish best effort + warning.
 */
'use strict';

const round2 = (v) => Math.round(v * 100) / 100;

function sortByConfidence(list) {
  return list.slice().sort((a, b) => b.confidence - a.confidence || b.odds - a.odds);
}

/**
 * cands: candidate pick objects with .odds and .league
 * opts: { minLegs, maxLegs, targetMin, targetMax }
 */
function buildToRange(cands, { minLegs, maxLegs, targetMin, targetMax }) {
  const picked = [];
  let combined = 1;
  const leagues = new Set();

  const add = (c) => {
    picked.push(c);
    combined = round2(combined * c.odds);
    leagues.add(c.league);
  };
  const wouldOverflow = (c) => Number.isFinite(targetMax) && round2(combined * c.odds) > targetMax;
  const done = () => picked.length >= maxLegs || combined >= targetMin;

  const pool = sortByConfidence(cands);

  // pass 1 — league diversification until minimum target reached (respecting the cap)
  for (const c of pool) {
    if (done()) break;
    if (leagues.has(c.league) || wouldOverflow(c)) continue;
    add(c);
  }
  // pass 2 — keep stacking best confidence until minimum target reached
  for (const c of pool) {
    if (done()) break;
    if (picked.includes(c) || wouldOverflow(c)) continue;
    add(c);
  }
  // pass 3 — honour minimum leg count (smallest odds first; cap may bend as last resort)
  const byOdds = pool.slice().sort((a, b) => a.odds - b.odds);
  for (const c of byOdds) {
    if (picked.length >= minLegs) break;
    if (picked.includes(c)) continue;
    add(c);
  }

  return { picked, combined };
}

/**
 * scored = candidate objects:
 * { league, sport, home, away, kickoff, confidence, rawSignal,
 *   stepped: {market, selection, odds, real, note}, raw: {market, selection, odds, real} }
 */
function selectDaily(scored, config) {
  const lim = config.limits;
  const th = config.thresholds;
  const adjusted = {};
  const warnings = [];

  const mapSafe = (c) => ({
    ...c, odds: c.stepped.odds, market: c.stepped.market,
    selection: c.stepped.selection, note: c.stepped.note, realOdds: !!c.stepped.real,
  });
  const mapAcc = (c) => ({
    ...c, odds: c.raw.odds, market: c.raw.market,
    selection: c.raw.selection, note: 'Straight line (accumulator rule).', realOdds: !!c.raw.real,
  });

  /* ---------- Table 1: SAFE (stepped markets only, combined 2.00-3.00) ---------- */
  let safeTh = th.safe;
  let safeCands = scored.filter((c) => c.confidence >= safeTh).map(mapSafe);
  while (safeCands.length < lim.safe.minLegs && safeTh > 55) {
    safeTh -= 2;
    safeCands = scored.filter((c) => c.confidence >= safeTh).map(mapSafe);
  }
  if (safeTh !== th.safe) adjusted.safe = { from: th.safe, to: safeTh };

  const safe = buildToRange(safeCands, {
    minLegs: lim.safe.minLegs,
    maxLegs: lim.safe.maxLegs,
    targetMin: lim.safe.targetMin,
    targetMax: lim.safe.targetMax,
  });
  if (safe.combined < lim.safe.targetMin) {
    warnings.push(`SAFE combined ${safe.combined} below 2.00 (thin market day).`);
  }
  if (safe.combined > lim.safe.targetMax) {
    warnings.push(`SAFE combined ${safe.combined} above 3.00 (could not fit the range with min legs).`);
  }

  /* ---------- Table 2: ACCUMULATOR (straight lines, unlimited legs, min 10.00) ---------- */
  let accTh = th.accumulator;
  let accCands = scored.filter((c) => c.confidence >= accTh).map(mapAcc);
  while (accCands.length < lim.accumulator.minLegs && accTh > 52) {
    accTh -= 2;
    accCands = scored.filter((c) => c.confidence >= accTh).map(mapAcc);
  }
  if (accTh !== th.accumulator) adjusted.accumulator = { from: th.accumulator, to: accTh };

  const accum = buildToRange(accCands, {
    minLegs: lim.accumulator.minLegs,
    maxLegs: lim.accumulator.maxLegs,
    targetMin: lim.accumulator.targetMin,
    targetMax: lim.accumulator.targetMax,
  });
  if (accum.combined < lim.accumulator.targetMin) {
    warnings.push(`ACCUMULATOR combined ${accum.combined} below 10.00 (thin market day).`);
  }

  return { safe, accum, adjusted, warnings };
}

module.exports = { selectDaily, buildToRange };
