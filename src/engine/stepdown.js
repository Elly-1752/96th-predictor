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
 *   Basketball regular favourite  ->  gentle real handicap line (~ -2.5)
 *
 * ODDS POLICY (user requirement): odds shown are the REAL consensus prices
 * quoted by the bookmakers right now (average across books). Theoretical
 * formulas are ONLY a fallback when a market has no live coverage.
 */
'use strict';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Decide what the market consensus is "saying" before we soften it. */
function detectRawSignal(p, sport) {
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

/** Pick the real spread line (favourite perspective) nearest to target. */
function nearestSpread(books, favSide, targetLine) {
  // favSide 'home'|'away'; spread entries {side,line,odd} are per-book
  const byLine = new Map();
  for (const b of books || []) {
    for (const s of b.spread || []) {
      if (s.side !== favSide) continue;
      const key = s.line;
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(s.odd);
    }
  }
  let best = null;
  for (const [line, odds] of byLine) {
    const avg = round2(odds.reduce((a, b) => a + b, 0) / odds.length);
    const dist = Math.abs(line - targetLine);
    if (!best || dist < best.dist - 1e-9) best = { line, odd: avg, dist };
  }
  return best; // { line, odd } from the favourite's perspective
}

/**
 * Apply the step-down.
 * ctx = { sport, homeTeam, awayTeam, p (consensus probs),
 *         real = real market prices:
 *           football: { winHome, winDraw, winAway, dcHome(1X), dcAway(X2), over15, over25 }
 *           basketball: { mlHome, mlAway, books (for spreads) }
 *       }
 */
function stepDown(raw, ctx) {
  const { sport, homeTeam, awayTeam, p } = ctx;
  const real = ctx.real || {};
  const favTeam = raw.side === 'home' ? homeTeam : awayTeam;
  const pDraw = p.draw != null ? p.draw : 0.24;

  /* ------------- REAL prices first, theoretical fallback second ------------- */
  const realWin = raw.side === 'home' ? real.winHome : real.winAway;
  const realDc = raw.side === 'home' ? real.dcHome : real.dcAway;
  const realMl = raw.side === 'home' ? real.mlHome : real.mlAway;

  /* ------------------------- raw markets (accumulator may use these) */
  let rawMarket;
  if (sport === 'basketball') {
    rawMarket = {
      market: 'Moneyline',
      selection: `${favTeam} to win`,
      odds: realMl || round2(clamp(0.96 / raw.pFav, 1.22, 2.60)),
      real: Boolean(realMl),
    };
  } else if (raw.signal === 'OVER_2_5_GOALS') {
    rawMarket = {
      market: 'Over 2.5 Goals',
      selection: 'Over 2.5 Goals',
      odds: real.over25 || round2(clamp(0.95 / p.over25, 1.45, 2.40)),
      real: Boolean(real.over25),
    };
  } else {
    rawMarket = {
      market: 'Match Winner',
      selection: `${favTeam} to win`,
      odds: realWin || round2(clamp(0.96 / raw.pFav, 1.28, 3.20)),
      real: Boolean(realWin),
    };
  }

  /* ------------------------- stepped (SAFE) markets */
  let stepped;
  switch (raw.signal) {
    case 'OVER_2_5_GOALS': {
      const fallback = round2(clamp(0.95 / estimateOver15(p.over25), 1.14, 1.55));
      stepped = {
        market: 'Over 1.5 Goals',
        selection: 'Over 1.5 Goals',
        odds: real.over15 || fallback,
        real: Boolean(real.over15),
        note: 'Goals consensus detected — stepped one full line down (2.5 → 1.5).',
      };
      break;
    }
    case 'CLEAN_SHEET_FAVORITE':
    case 'TEAM_TO_WIN': {
      if (sport === 'basketball') {
        // gentle real handicap (safer adjacent market); fallback = real ML
        const sp = nearestSpread(real.books, raw.side, -2.5);
        if (sp) {
          stepped = {
            market: 'Handicap (safer line)',
            selection: `${favTeam} ${sp.line > 0 ? '+' + sp.line : sp.line}`,
            odds: sp.odd,
            real: true,
            note: `Straight ML softened to a real market handicap line (${sp.line}).`,
          };
        } else {
          stepped = {
            market: 'Moneyline',
            selection: `${favTeam} to win`,
            odds: realMl || round2(clamp(0.96 / raw.pFav, 1.22, 2.60)),
            real: Boolean(realMl),
            note: 'No live spread coverage — using the real moneyline price.',
          };
        }
        break;
      }
      const fallbackDc = round2(clamp(0.96 / (raw.pFav + pDraw), 1.12, 1.75));
      stepped = {
        market: 'Double Chance',
        selection: `${favTeam} or Draw (${raw.side === 'home' ? '1X' : 'X2'})`,
        odds: realDc || fallbackDc,
        real: Boolean(realDc),
        note: raw.signal === 'CLEAN_SHEET_FAVORITE'
          ? 'Clean-sheet favourite — softened to Win/Draw (BTTS: No is the alternative).'
          : `Consensus on ${favTeam} to win — stepped down to Win or Draw.`,
      };
      break;
    }
    case 'BASKETBALL_BIG_FAVORITE': {
      const half = -Math.max(1.5, Math.round((impliedMargin(raw.pFav) / 2) * 2) / 2);
      const sp = nearestSpread(real.books, raw.side, half);
      if (sp) {
        stepped = {
          market: 'Handicap (safer line)',
          selection: `${favTeam} ${sp.line > 0 ? '+' + sp.line : sp.line}`,
          odds: sp.odd,
          real: true,
          note: `Big favourite — raw line cut to HALF (real market line ${sp.line}).`,
        };
      } else {
        stepped = {
          market: 'Moneyline',
          selection: `${favTeam} to win`,
          odds: realMl || round2(clamp(0.95 / (0.52 + raw.pFav * 0.16), 1.30, 1.85)),
          real: Boolean(realMl),
          note: 'No live spread coverage — using the real moneyline price.',
        };
      }
      break;
    }
    default:
      stepped = null;
  }

  return { raw: rawMarket, stepped };
}

module.exports = { detectRawSignal, stepDown, impliedMargin, estimateOver15, nearestSpread };
