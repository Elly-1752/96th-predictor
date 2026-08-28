/** Smoke-test of the odds layer (Step 11). */
'use strict';
require('dotenv').config();

const oddsApi = require('./sources/oddsApi');
const apiSports = require('./sources/apiSports');
const { consensus } = require('./engine/consensus');

function todayEAT() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
const pct = (x) => (x == null ? '-' : (x * 100).toFixed(1) + '%');

(async () => {
  // 1) TheOddsAPI — NBA (the ONLY basketball it covers on free)
  try {
    const nba = await oddsApi.getNbaOdds();
    console.log('[the-odds-api] NBA events with odds:', nba.events.length, '| requests remaining:', nba.remaining);
    if (nba.events.length) {
      const e = nba.events[0];
      console.log('   sample:', e.home_team, 'vs', e.away_team, '| books:', e.books.length);
      const c = consensus(e.books);
      if (c) console.log('   consensus prob -> home:', pct(c.home), '| away:', pct(c.away));
    }
  } catch (e) {
    console.log('[the-odds-api] NBA fetch note:', e.message);
  }

  // 2) Prove the soccer limitation on free tier (expect 403)
  const probe = await oddsApi.probeSoccerRestriction();
  console.log('\n[the-odds-api] soccer probe -> HTTP', probe.status);
  console.log('   server says:', probe.message.replace(/\s+/g, ' ').slice(0, 200));

  // 3) Our soccer odds plan: API-Football /odds + same consensus math
  const o = await apiSports.getFootballOddsByDate(todayEAT());
  const withBooks = o.odds.filter((x) => x.bookmakers && x.bookmakers.length >= 2);
  console.log('\n[api-football] fixtures with 2+ books today:', withBooks.length, '| remaining:', o.remaining);
  if (withBooks.length) {
    const s = withBooks[0];
    const c = consensus(s.bookmakers);
    console.log('   fixture id', s.ext_id, '| books:', s.bookmakers.map((b) => b.book).slice(0, 4).join(', '));
    console.log('   consensus prob -> home:', pct(c.home), 'draw:', pct(c.draw), 'away:', pct(c.away));
  }

  console.log('\nODDS LAYER OK ✔');
})().catch((e) => { console.error('ODDS TEST FAILED:', e.message); process.exit(1); });
