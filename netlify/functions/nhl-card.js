// NHL Scores — posts logo + text scores to Facebook
const { getStore } = require('@netlify/blobs');

async function fetchScores(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        { role: 'user', content: 'Search for last night\'s NHL final scores. Return ONLY raw JSON, no markdown:\n{"games":[{"away":"TEAM","awayScore":0,"home":"TEAM","homeScore":0,"ot":false}]}\nUse full team names. Cap at 12 games. If none, return {"games":[]}' },
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
  const parsed = JSON.parse(match[0]);
  return Array.isArray(parsed.games) ? parsed.games : [];
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).toUpperCase();
  const dateKey = `nhl-${now.toISOString().slice(0, 10)}`;

  try {
    const store = getStore('sports-card-dedup');
    if (await store.get(dateKey)) {
      console.log(`nhl-card: already posted ${dateKey}`);
      return { statusCode: 200, body: 'Already posted' };
    }
  } catch(e) { console.warn('dedup check failed:', e.message); }

  let games;
  try {
    games = await fetchScores(anthropicKey);
    console.log(`nhl-card: fetched ${games.length} games`);
  } catch(e) {
    console.error('nhl-card fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  if (games.length < 1) {
    console.log('nhl-card: no games found — skipping');
    return { statusCode: 200, body: 'No games' };
  }

  const lines = games.map(g => {
    const ot = g.ot && g.ot !== false ? ` (${g.ot === true ? 'OT' : g.ot})` : '';
    const winner  = g.awayScore > g.homeScore ? '→' : ' ';
    const winner2 = g.homeScore > g.awayScore ? '→' : ' ';
    return `${winner} ${g.away} ${g.awayScore}  —  ${g.home} ${g.homeScore} ${winner2}${ot}`.trim();
  });

  const message = `🏒 [NHL] SCORES | ${dateStr}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#NHL #Hockey #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('nhl-card posted:', result.id);
    try { await getStore('sports-card-dedup').set(dateKey, result.id); } catch(e) {}
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('nhl-card post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
