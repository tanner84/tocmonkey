// ─────────────────────────────────────────────────────────────────────────────
// Sports Scores — ESPN unofficial API, no key required
// Covers NFL, NBA, MLB, NHL, CFB, CBB, EPL, MLS
// 5-minute cache, returns flat array of game objects
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cache = { ts: 0, data: [] };

const LEAGUES = [
  { key: 'nfl',     sport: 'football',  league: 'nfl',              label: 'NFL'  },
  { key: 'nba',     sport: 'basketball',league: 'nba',              label: 'NBA'  },
  { key: 'mlb',     sport: 'baseball',  league: 'mlb',              label: 'MLB'  },
  { key: 'nhl',     sport: 'hockey',    league: 'nhl',              label: 'NHL'  },
  { key: 'cfb',     sport: 'football',  league: 'college-football',  label: 'CFB'  },
  { key: 'cbb',     sport: 'basketball',league: 'mens-college-basketball', label: 'CBB' },
  { key: 'epl',     sport: 'soccer',    league: 'eng.1',            label: 'EPL'  },
  { key: 'mls',     sport: 'soccer',    league: 'usa.1',            label: 'MLS'  },
];

// --- GOLF (PGA) ---
async function fetchPGA() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const event = data.events?.[0];
    if (!event) return [];
    const comp = event.competitions?.[0];
    const leaderboard = comp?.competitors || [];
    if (!leaderboard.length) return [];
    const roundStatus = comp?.status?.type?.shortDetail || '';
    const tournamentName = event.shortName || event.name || 'PGA TOUR';
    const top = leaderboard.slice(0, 5).map(p => {
      const pos   = p.status?.position?.displayValue || p.status?.position || '';
      const name  = p.athlete?.shortName || p.athlete?.displayName || '';
      const score = p.score || 'E';
      const thru  = p.status?.thru ? `thru ${p.status.thru}` : '';
      return `${pos} ${name} ${score}${thru ? ' ('+thru+')' : ''}`;
    }).join('  ·  ');
    const display = `${tournamentName}${roundStatus ? ' · ' + roundStatus : ''}: ${top}`;
    return [{ label: 'PGA', state: comp?.status?.type?.state || 'post', display }];
  } catch { return []; }
}

// --- UFC / MMA ---
async function fetchUFC() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const events = data.events || [];
    if (!events.length) return [];
    const results = [];
    for (const ev of events.slice(0, 4)) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const state  = comp.status?.type?.state || 'pre';
      const fighters = comp.competitors || [];
      const f1 = fighters[0]; const f2 = fighters[1];
      if (!f1 || !f2) continue;
      const n1 = f1.athlete?.shortName || f1.athlete?.displayName || f1.team?.displayName || '?';
      const n2 = f2.athlete?.shortName || f2.athlete?.displayName || f2.team?.displayName || '?';
      const eventName = ev.shortName || ev.name || 'UFC';
      // Odds
      const odds = comp.odds?.[0];
      const oddsStr = odds ? ` (${odds.awayTeamOdds?.moneyLine > 0 ? '+'+odds.awayTeamOdds?.moneyLine : odds.awayTeamOdds?.moneyLine || ''} / ${odds.homeTeamOdds?.moneyLine > 0 ? '+'+odds.homeTeamOdds?.moneyLine : odds.homeTeamOdds?.moneyLine || ''})` : '';
      if (state === 'post') {
        const winner   = fighters.find(f => f.winner);
        const winName  = winner?.athlete?.shortName || winner?.athlete?.displayName || '';
        const method   = comp.status?.type?.shortDetail || 'DEC';
        results.push({ label: 'UFC', state: 'post', display: `${eventName} · ${n1} vs ${n2} — ${winName ? winName + ' def.' : ''} ${method}` });
      } else if (state === 'in') {
        const rnd  = comp.status?.period || 1;
        const clk  = comp.status?.displayClock || '';
        results.push({ label: 'UFC', state: 'in', display: `${eventName} · ${n1} vs ${n2} — RD ${rnd} ${clk} LIVE` });
      } else {
        const d = new Date(ev.date);
        const dateStr = d.toLocaleDateString('en-US', { month:'numeric', day:'numeric', timeZone:'UTC' });
        results.push({ label: 'UFC', state: 'pre', display: `${eventName} · ${n1} vs ${n2}${oddsStr} — ${dateStr}` });
      }
    }
    return results;
  } catch { return []; }
}

// --- F1 ---
async function fetchF1() {
  try {
    const res = await fetch('https://api.jolpi.ca/ergast/f1/current/last/results/', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const race = data.MRData?.RaceTable?.Races?.[0];
    if (!race) return [];
    const results = race.Results || [];
    if (!results.length) return [];
    const winner = results[0]?.Driver;
    const team = results[0]?.Constructor?.name;
    const display = `${race.raceName} — 1st: ${winner.givenName} ${winner.familyName} (${team})`;
    return [{ label: 'F1', state: 'post', display }];
  } catch { return []; }
}

function espnUrl(sport, league) {
  return `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
}

function parseGame(event, label) {
  try {
    const comp   = event.competitions?.[0];
    if (!comp) return null;
    const status = comp.status?.type;
    const state  = status?.state;  // 'pre' | 'in' | 'post'
    const detail = status?.shortDetail || '';

    const teams = comp.competitors || [];
    const home  = teams.find(t => t.homeAway === 'home');
    const away  = teams.find(t => t.homeAway === 'away');
    if (!home || !away) return null;

    const hAbbr = home.team?.abbreviation || home.team?.shortDisplayName || '???';
    const aAbbr = away.team?.abbreviation || away.team?.shortDisplayName || '???';
    const hScore = home.score ?? '';
    const aScore = away.score ?? '';

    let display = '';
    if (state === 'pre') {
      // upcoming — show date/time
      const d = new Date(event.date);
      const opts = { weekday:'short', month:'numeric', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' };
      display = `${aAbbr} @ ${hAbbr}  ${d.toLocaleString('en-US', opts)}`;
    } else if (state === 'in') {
      display = `${aAbbr} ${aScore} · ${hAbbr} ${hScore}  ${detail}`;
    } else {
      // final
      const winner = parseInt(hScore) > parseInt(aScore) ? hAbbr : aAbbr;
      display = `${aAbbr} ${aScore} · ${hAbbr} ${hScore}  FINAL${detail.includes('OT') ? '/OT' : ''}`;
    }

    return { label, state, display };
  } catch { return null; }
}

exports.handler = async function(event) {
  const headers = { 'Content-Type': 'application/json' };

  // Serve cache if fresh
  if (Date.now() - cache.ts < CACHE_TTL && cache.data.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ games: cache.data, cached: true }) };
  }


  // Always fetch PGA, F1, and UFC first
  const [pga, f1, ufc] = await Promise.all([fetchPGA(), fetchF1(), fetchUFC()]);
  const results = [...pga, ...f1, ...ufc];

  // Fetch regular leagues
  await Promise.allSettled(LEAGUES.map(async ({ key, sport, league, label }) => {
    try {
      const res = await fetch(espnUrl(sport, league), {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const events = data.events || [];
      const now = Date.now();
      const relevant = events.filter(ev => {
        const state = ev.competitions?.[0]?.status?.type?.state;
        const d = new Date(ev.date).getTime();
        if (state === 'in') return true;
        if (state === 'post' && now - d < 24 * 3600 * 1000) return true;
        if (state === 'pre'  && d - now < 36 * 3600 * 1000) return true;
        return false;
      });
      const ORDER = { in: 0, post: 1, pre: 2 };
      relevant.sort((a, b) => {
        const sa = a.competitions?.[0]?.status?.type?.state;
        const sb = b.competitions?.[0]?.status?.type?.state;
        return (ORDER[sa] ?? 3) - (ORDER[sb] ?? 3);
      });
      relevant.slice(0, 6).forEach(ev => {
        const g = parseGame(ev, label);
        if (g) results.push(g);
      });
    } catch { /* league offline — skip */ }
  }));

  // Sort final output: live > post > pre, then by label
  const ORDER = { in: 0, post: 1, pre: 2 };
  results.sort((a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3));

  cache = { ts: Date.now(), data: results };

  return { statusCode: 200, headers, body: JSON.stringify({ games: results, cached: false }) };
};
