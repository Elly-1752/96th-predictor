/**
 * Source #1 — football-data.org (free tier).
 * Role: today's football fixtures across the top ~13 competitions.
 * Auth: X-Auth-Token header. Rate: ~10 req/min (we use ~1/day).
 */
'use strict';

const BASE = 'https://api.football-data.org/v4';

async function getMatchesByDate(dateStr) {
  const res = await fetch(`${BASE}/matches?date=${dateStr}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY },
  });
  if (!res.ok) throw new Error(`football-data.org HTTP ${res.status}`);
  const json = await res.json();

  return (json.matches || []).map((m) => ({
    sport: 'football',
    source: 'football-data.org',
    ext_id: m.id,
    league: m.competition ? m.competition.name : 'Unknown',
    country: m.competition && m.competition.area ? m.competition.area.name : null,
    home_team: m.homeTeam ? m.homeTeam.name : null,
    away_team: m.awayTeam ? m.awayTeam.name : null,
    kickoff: m.utcDate || null,
  }));
}

module.exports = { getMatchesByDate };
