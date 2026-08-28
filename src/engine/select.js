/**
 * DAILY SELECTION — floors, not caps (user product rule v2):
 *   Table 1 SAFE:        combined odds MINIMUM 3.00 (2.50 acceptable floor), NO maximum.
 *   Table 2 ACCUMULATOR: combined odds MINIMUM 10.00, NO maximum.
 *
 * Strategy: best confidence first; keep adding legs until the TARGET combined
 * odds are reached (or legs run out). Prefer spreading across leagues.
 * If the market day is thin and we end under the floor, we still publish the
 * best effort and the run report carries a warning.
 */
'use strict';

const round2 = (v) => Math.round(v * 100) / 100;

function sortByConfidence(list) {
  return list.slice().sort((a, b) => b.confidence - a.confidence || b.odds - a.odds);
}

function buildToFloor(cands, { minLegs, maxLegs, target }) {
  const picked = [];
  let combined = 1;
  const leagues = new Set();

  const add = (c) => {
    picked.push(c);
    combined = round2(combined * c.odds);
    leagues.add(c.league);
  };

  const pool = sortByConfidence(cands);

  // pass 1 — league diversification until target reached
  for (const c of pool) {
    if (picked.length >= maxLegs || combined >= target) break;
    if (leagues.has(c.league)) continue;
    add(c);
  }
  // pass 2 — keep stacking best confidence until target reached
  for (const c of pool) {
    if (picked.length >= maxLegs || combined >= target) break;
    if (picked.includes(c)) continue;
    add(c);
  }
  // pass 3 — honour minimum leg count
  for (const c of pool) {
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

  /* ---------- Table 1: SAFE (stepped markets only) ---------- */
  let safeTh = th.safe;
  let safeCands = scored.filter((c) => c.confidence >= safeTh).map(mapSafe);
  while (safeCands.length < lim.safe.minPicks && safeTh > 55) {
    safeTh -= 2;
    safeCands = scored.filter((c) => c.confidence >= safeTh).map(mapSafe);
  }
  if (safeTh !== th.safe) adjusted.safe = { from: th.safe, to: safeTh };

  const safe = buildToFloor(safeCands, {
    minLegs: lim.safe.minPicks,
    maxLegs: lim.safe.maxPicks,
    target: lim.safe.targetCombined,
  });
  if (safe.combined < lim.safe.floorCombined) {
    warnings.push(`SAFE combined ${safe.combined} below floor ${lim.safe.floorCombined} (thin market day).`);
  }

  /* ---------- Table 2: ACCUMULATOR (straight lines allowed) ---------- */
  let accTh = th.accumulator;
  let accCands = scored.filter((c) => c.confidence >= accTh).map(mapAcc);
  while (accCands.length < lim.accumulator.minLegs && accTh > 52) {
    accTh -= 2;
    accCands = scored.filter((c) => c.confidence >= accTh).map(mapAcc);
  }
  if (accTh !== th.accumulator) adjusted.accumulator = { from: th.accumulator, to: accTh };

  const accum = buildToFloor(accCands, {
    minLegs: lim.accumulator.minLegs,
    maxLegs: lim.accumulator.maxLegs,
    target: lim.accumulator.floorCombined, // minimum acts as the build target
  });
  if (accum.combined < lim.accumulator.floorCombined) {
    warnings.push(`ACCUMULATOR combined ${accum.combined} below floor ${lim.accumulator.floorCombined} (thin market day).`);
  }

  return { safe, accum, adjusted, warnings };
}

module.exports = { selectDaily };
