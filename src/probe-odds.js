/** Inspect which markets/books API-SPORTS actually returns (to use REAL odds). */
'use strict';
require('dotenv').config();
const apiSports = require('./sources/apiSports');

function todayEAT() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

(async () => {
  const d = todayEAT();

  const res = await fetch(`https://v3.football.api-sports.io/odds?date=${d}&timezone=Africa/Dar_es_Salaam`, {
    headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
  });
  const json = await res.json();
  const fx = (json.response || []).find((o) => (o.bookmakers || []).length >= 3);
  if (fx) {
    console.log('FOOTBALL fixture', fx.fixture.id);
    const bm = fx.bookmakers[0];
    console.log('book:', bm.name);
    for (const b of bm.bets) {
      const vals = (b.values || []).slice(0, 6).map((v) => v.value + '=' + v.odd).join(', ');
      console.log('  bet id', b.id, '|', b.name, '|', vals);
    }
  }

  await new Promise((r) => setTimeout(r, 7000));
  const bb = await apiSports.getBasketballGames(d);
  if (bb.games.length) {
    await new Promise((r) => setTimeout(r, 7000));
    const res2 = await fetch(`https://v1.basketball.api-sports.io/odds?game=${bb.games[0].id}`, {
      headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
    });
    const j2 = await res2.json();
    const g = (j2.response || [])[0];
    if (g && g.bookmakers && g.bookmakers[0]) {
      console.log('\nBASKETBALL game', g.id, '| book:', g.bookmakers[0].name);
      for (const b of g.bookmakers[0].bets) {
        const vals = (b.values || []).slice(0, 6).map((v) => v.value + '=' + v.odd).join(', ');
        console.log('  bet id', b.id, '|', b.name, '|', vals);
      }
    }
  }
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
