/**
 * THE RISK STEP-DOWN (Step 13) — the golden rule of this app:
 *   NEVER publish the raw highest-confidence outcome.
 *   Always move to the nearest SAFER adjacent market.
 *
 * Mapping (from the product spec):
 *   Over 2.5 goals consensus      ->  Over 1.5 goals
 *   Team to win consensus         ->  Double Chance (team or draw)
 *   Clean-sheet favourite         ->  Double Chance (BTTS:No as alt note)
 *   Basketball big favourite      ->  safer handicap line (half the implied margin)
 *   Basketball regular favourite  ->  moneyline with +2.5 margin buffer
 */
'use strict';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Decide what the market consensus is "saying" before we soften it. */
function detectRawSignal(p, sport) {
  // p = { home, draw?, away, over25? }  (probabilities from consensus)
  const favSide = p.home >= p.away ? 'home' : 'away';
  const pFav = Math.max(p.home, p.away);

  if (sport === 'basketball') {
    if (pFav >= 0.78) return { signal: 'BASKETBALL_BIG_FAVORITE', side: favSide, pFav };
    return { signal: 'TEAM_TO_WIN', side: favSide, pFav };
  }

  if (pFav >= 0.55) return { signal: 'TEAM_TO_WIN', side: favSide, pFav };
  if (p.over25 != null && p.over25 >= 0.58) return { signal: 'OVER_2_5_GOALS', side: favSide, pFav };
  if (pFav >= 0.62 && p.over25 != null && p.over25 < 0.50) {
    return { signal: 'CLEAN_SHEET_FAVORITE', side: favSide, pFav };
  }
  return { signal: 'TEAM_TO_WIN', side: favSide, pFav };
}

/** Implied points margin from a win probability (logistic inverse, scale ~6.5). */
function impliedMargin(pFav) {
  const p = clamp(pFav, 0.55, 0.95);
  return 6.5 * Math.log(p / (1 - p));
}

/** Approximate P(over 1.5) when books only quote the 2.5 line. */
function estimateOver15(pOver25) {
  return clamp(0.35 + pOver25 * 0.75, 0.55, 0.96);
}

/**
 * Apply the step-down.
 * ctx = { sport, homeTeam, awayTeam, p (consensus probs) }
 * returns { raw, stepped } where each is { market, selection, odds, note }
 */
function stepDown(raw, ctx) {
  const { sport, homeTeam, awayTeam, p } = ctx;
  const favTeam = raw.side === 'home' ? homeTeam : awayTeam;
  const pDraw = p.draw != null ? p.draw : 0.24;

  /* ------------------------- raw markets (accumulator may use these) */
  let rawMarket;
  if (sport === 'basketball') {
    rawMarket = { market: 'Moneyline', selection: `${favTeam} to win`, odds: round2(clamp(0.96 / raw.pFav, 1.22, 2.60)) };
  } else if (raw.signal === 'OVER_2_5_GOALS') {
    rawMarket = { market: 'Over 2.5 Goals', selection: 'Over 2.5 Goals', odds: round2(clamp(0.95 / p.over25, 1.45, 2.40)) };
  } else {
    rawMarket = { market: 'Match Winner', selection: `${favTeam} to win`, odds: round2(clamp(0.96 / raw.pFav, 1.28, 3.20)) };
  }

  /* ------------------------- stepped (SAFE) markets */
  let stepped;
  switch (raw.signal) {
    case 'OVER_2_5_GOALS': {
      const p15 = estimateOver15(p.over25);
      stepped = {
        market: 'Over 1.5 Goals',
        selection: 'Over 1.5 Goals',
        odds: round2(clamp(0.95 / p15, 1.14, 1.55)),
        note: 'Goals consensus detected — stepped one full line down (2.5 → 1.5).',
      };
      break;
    }
    case 'CLEAN_SHEET_FAVORITE': {
      stepped = {
        market: 'Double Chance',
        selection: `${favTeam} or Draw (${raw.side === 'home' ? '1X' : 'X2'})`,
        odds: round2(clamp(0.96 / (raw.pFav + pDraw), 1.12, 1.65)),
        note: 'Clean-sheet favourite — softened to Win/Draw (BTTS: No is the alternative at similar odds).',
      };
      break;
    }
    case 'BASKETBALL_BIG_FAVORITE': {
      const margin = impliedMargin(raw.pFav);
      const line = Math.max(1.5, Math.round((margin / 2) * 2) / 2); // HALF the implied margin
      stepped = {
        market: 'Handicap (safer line)',
        selection: `${favTeam} -${line}`,
        odds: round2(clamp(0.95 / (0.52 + raw.pFav * 0.16), 1.30, 1.85)),
        note: `Big favourite (implied margin ~${margin.toFixed(1)}) — line cut to HALF (-${line}) as the safer adjacent market.`,
      };
      break;
    }
    case 'TEAM_TO_WIN':
    default: {
      if (sport === 'basketball') {
        const pCover = Math.min(0.93, raw.pFav + 0.07);
        stepped = {
          market: 'Handicap (buffered +2.5)',
          selection: `${favTeam} +2.5`,
          odds: round2(clamp(0.95 / pCover, 1.12, 1.62)),
          note: `Straight ${favTeam} ML softened with a +2.5 points buffer.`,
        };
      } else {
        stepped = {
          market: 'Double Chance',
          selection: `${favTeam} or Draw (${raw.side === 'home' ? '1X' : 'X2'})`,
          odds: round2(clamp(0.96 / (raw.pFav + pDraw), 1.12, 1.75)),
          note: `Consensus on ${favTeam} to win — stepped down to Win or Draw.`,
        };
      }
    }
  }

  return { raw: rawMarket, stepped };
}

module.exports = { detectRawSignal, stepDown, impliedMargin, estimateOver15 };
