// PGA Leaderboard — posts logo + text top-10 to Facebook
// Runs Thu–Sun at 23:30 UTC (7:30pm ET), captures each round's end-of-day leaderboard
const { getStore } = require('@netlify/blobs');

async function fetchLeaderboard(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        { role: 'user', content: 'Search for the current PGA Tour tournament leaderboard. Return ONLY raw JSON, no markdown:\n{"tournament":"NAME","round":"R1","players":[{"pos":1,"name":"PLAYER","score":-10,"today":-4},{"pos":2,"name":"PLAYER","score":-8,"today":-3}]}\nInclude top 10 players. Score and today are strokes relative to par (negative = under par). If no tournament active, return {"tournament":"","round":"","players":[]}' },
        { role: 'assistant', content: '{' },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const match = ('{' + text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON: ${text.slice(0, 120)}`);
  return JSON.parse(match[0]);
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

function fmtScore(n) {
  if (n == null || n === '' || isNaN(Number(n))) return 'E';
  const v = Number(n);
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

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
    board = await fetchLeaderboard(anthropicKey);
    console.log(`pga-card: fetched ${board.players?.length || 0} players, tournament: ${board.tournament}`);
  } catch(e) {
    console.error('pga-card fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  if (!board.tournament || !board.players || board.players.length < 1) {
    console.log('pga-card: no tournament active — skipping');
    return { statusCode: 200, body: 'No tournament' };
  }

  const lines = board.players.slice(0, 10).map(p => {
    const pos   = p.pos != null ? `T${p.pos}`.replace('T1 ', ' 1 ') : '?';
    const score = fmtScore(p.score);
    const today = p.today != null ? ` (today: ${fmtScore(p.today)})` : '';
    return `${String(p.pos).padStart(2)}. ${p.name}  ${score}${today}`;
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
