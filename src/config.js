/**
 * 96th Predictor Engine — central configuration.
 * EVERY secret comes from environment variables (process.env).
 * Nothing sensitive is ever written in code.
 */
'use strict';
require('dotenv').config();

const CONFIG = {
  // Scoring weights (must add up to 1.0)
  weights: { form: 0.40, h2h: 0.30, odds: 0.20, news: 0.10 },

  // Daily output rules
  limits: {
    safe:     { minPicks: 2, maxPicks: 3, maxCombinedOdds: 3.0 },
    accumulator: { minLegs: 3, maxLegs: 5, maxCombinedOdds: 10.0 },
  },

  // Minimum confidence (0..100) a fixture must score to be eligible
  thresholds: { safe: 65, accumulator: 60 },

  // 03:00 EAT daily job
  scheduleHourEAT: 3,
};

/** Which env vars are present? (names only — values are NEVER printed) */
function envStatus() {
  return [
    'FOOTBALL_DATA_KEY', 'API_SPORTS_KEY', 'ODDS_API_KEY',
    'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'CRON_SECRET',
  ].map((name) => ({ name, present: Boolean(process.env[name]) }));
}

module.exports = { CONFIG, envStatus };
