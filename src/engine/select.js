/**
 * DAILY SELECTION (Step 14).
 *
 * Plain language:
 *  - Sort all analysed matches by confidence (best first).
 *  - Table 1 (SAFE): take 2-3 STEPPED markets, multiplying odds as we go,
 *    never crossing the 3.00 cap. Prefer spreading across leagues.
 *  - Table 2 (ACCUMULATOR): take 3-5 legs using RAW (straight) markets,
 *    never crossing the 10.00 cap.
 *  - If not enough matches clear the confidence bar, lower the bar by 2
 *    at a time (never below the floor) and note it in the run report.
 */
'use strict';

const round2 = (v) => Math.round(v * 100) / 100;

function sortByConfidence(list) {
  return list.slice().sort((a, b) => b.confidence - a.confidence || a.odds - b.odds);
}

function greedy(cands, { maxLegs, maxCombined, preferDiverse }) {
  const picked = [];
  let combined = 1;
  const leagues = new Set();

  const add = (c) => {
    picked.push(c);
    combined = round2(combined * c.odds);
    leagues.add(c.league);
  };
  const fits = (c) => combined * c.odds <= maxCombined + 1e-9;

  const pool = sortByConfidence(cands);

  if (preferDiverse) {
    for (const c of pool) {
      if (picked.length >= maxLegs) break;
      if (leagues.has(c.league)) continue;
      if (fits(c)) add(c);
    }
  }
  for (const c of pool) {
    if (picked.length >= maxLegs) break;
    if (picked.includes(c)) continue;
    if (fits(c)) add(c);
  }
  return { picked, combined };
}

/**
 * scored = array of candidate objects:
 * { league, sport, home, away, kickoff, confidence,
 *   stepped: {market, selection, odds, note}, raw: {market, selection, odds},
 *   rawSignal, evidence }
 */
function selectDaily(scored, config) {
  const lim = config.limits;
  const th = config.thresholds;
  const adjusted = {};

  /* ---------- Table 1: SAFE (stepped markets only) ---------- */
  let safeTh = th.safe;
  let safeCands = scored
    .filter((c) => c.confidence >= safeTh)
    .map((c) => ({ ...c, odds: c.stepped.odds, market: c.stepped.market, selection: c.stepped.selection, note: c.stepped.note }));
  while (safeCands.length < lim.safe.minPicks && safeTh > 55) {
    safeTh -= 2;
    safeCands = scored
      .filter((c) => c.confidence >= safeTh)
      .map((c) => ({ ...c, odds: c.stepped.odds, market: c.stepped.market, selection: c.stepped.selection, note: c.stepped.note }));
  }
  if (safeTh !== th.safe) adjusted.safe = { from: th.safe, to: safeTh };

  const safe = greedy(safeCands, {
    maxLegs: lim.safe.maxPicks,
    maxCombined: lim.safe.maxCombinedOdds,
    preferDiverse: true,
  });

  /* ---------- Table 2: ACCUMULATOR (straight lines allowed) ---------- */
  let accTh = th.accumulator;
  let accCands = scored
    .filter((c) => c.confidence >= accTh)
    .map((c) => ({ ...c, odds: c.raw.odds, market: c.raw.market, selection: c.raw.selection, note: 'Straight line (accumulator rule).' }));
  while (accCands.length < lim.accumulator.minLegs && accTh > 52) {
    accTh -= 2;
    accCands = scored
      .filter((c) => c.confidence >= accTh)
      .map((c) => ({ ...c, odds: c.raw.odds, market: c.raw.market, selection: c.raw.selection, note: 'Straight line (accumulator rule).' }));
  }
  if (accTh !== th.accumulator) adjusted.accumulator = { from: th.accumulator, to: accTh };

  const accum = greedy(accCands, {
    maxLegs: lim.accumulator.maxLegs,
    maxCombined: lim.accumulator.maxCombinedOdds,
    preferDiverse: true,
  });

  return { safe, accum, adjusted };
}

module.exports = { selectDaily };
