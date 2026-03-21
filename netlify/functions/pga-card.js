// PGA Leaderboard — pulls verified data from ESPN Golf API, posts logo + text top-10 to Facebook
// Runs Thu–Sun at 23:30 UTC (7:30pm ET), captures each round's end-of-day leaderboard
const { getStore } = require('@netlify/blobs');

function fmtScore(val) {
  const n = Number(val);
  if (isNaN(n) || val === '' || val == null) return 'E';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

async function fetchLeaderboard() {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga';
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ESPN Golf API ${res.status}`);
  const data = await res.json();

  // ESPN returns events array — find the active/most recent tournament
  const events = data.events || [];
  if (events.length === 0) return null;

  // Prefer in-progress or most recently completed event
  const event = events.find(e => e.status?.type?.state === 'in') || events[0];
  if (!event) return null;

  const tournamentName = event.name || event.shortName || '';
  const roundDetail    = event.status?.type?.detail || event.status?.type?.description || '';
  const comp           = event.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  if (competitors.length === 0) {
    console.log('pga-card: ESPN returned 0 competitors. Raw event status:', JSON.stringify(event.status));
    return null;
  }

  // Sort by position (numeric part of position display name, or use existing order)
  const sorted = [...competitors].sort((a, b) => {
    const posA = parseInt(a.status?.position?.id || a.sortOrder || '999', 10);
    const posB = parseInt(b.status?.position?.id || b.sortOrder || '999', 10);
    return posA - posB;
  });

  const players = sorted.slice(0, 10).map((c, i) => {
    const name    = c.athlete?.displayName || c.displayName || 'Unknown';
    // Score relative to par — ESPN may provide as 'score', 'toPar', or in linescores
    const toPar   = c.score ?? c.toPar;
    const posLabel = c.status?.position?.displayName || `${i + 1}`;
    // Today's round score — last linescore entry
    const scores   = c.linescores || [];
    const todayRaw = scores.length > 0 ? scores[scores.length - 1].value : null;
    return {
      pos:   posLabel,
      name,
      score: toPar,
      today: todayRaw,
    };
  });

  return { tournament: tournamentName, round: roundDetail, players };
}

async function postToFacebook(message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://tocmonkey.com/logo.png', message, access_token: pageToken }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return await res.json();
}

exports.handler = async () => {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).toUpperCase();
  const dateKey = `pga-${now.toISOString().slice(0, 10)}`;

  try {
    const store = getStore('sports-card-dedup');
    if (await store.get(dateKey)) {
      console.log(`pga-card: already posted ${dateKey}`);
      return { statusCode: 200, body: 'Already posted' };
    }
  } catch(e) { console.warn('dedup check failed:', e.message); }

  let board;
  try {
    board = await fetchLeaderboard();
    console.log(`pga-card: fetched ${board?.players?.length || 0} players — ${board?.tournament || 'no tournament'}`);
  } catch(e) {
    console.error('pga-card fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  if (!board || !board.tournament || !board.players || board.players.length < 1) {
    console.log('pga-card: no tournament data — skipping');
    return { statusCode: 200, body: 'No tournament' };
  }

  const lines = board.players.map(p => {
    const score = fmtScore(p.score);
    const today = p.today != null ? ` (${fmtScore(p.today)})` : '';
    return `${String(p.pos).padStart(3)}. ${p.name}  ${score}${today}`;
  });

  const message = `⛳ [PGA] LEADERBOARD | ${board.tournament} — ${board.round} | ${dateStr}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#PGA #Golf #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('pga-card posted:', result.id);
    try { await getStore('sports-card-dedup').set(dateKey, result.id); } catch(e) {}
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('pga-card post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
