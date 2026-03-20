// F1 Race Results — posts logo + text scores to Facebook
const { getStore } = require('@netlify/blobs');

async function fetchResults(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        { role: 'user', content: 'Search for the most recent Formula 1 Grand Prix race results. Return ONLY a raw JSON object — no prose, no markdown:\n{"race":"","circuit":"","date":"Mon DD YYYY","results":[{"pos":1,"driver":"","team":"","time":""},{"pos":2,"driver":"","team":"","gap":""},{"pos":3,"driver":"","team":"","gap":""}]}' },
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

exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  let data;
  try {
    data = await fetchResults(anthropicKey);
    console.log('f1-card-test: fetched', data.race, data.date);
  } catch(e) {
    console.error('f1-card-test fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  const MEDAL = ['', '🥇', '🥈', '🥉'];
  const lines = (data.results || []).slice(0, 3).map(r => {
    const medal = MEDAL[r.pos] || `P${r.pos}`;
    const time  = r.pos === 1 ? (r.time || '') : (r.gap || '');
    return `${medal} ${r.driver} — ${r.team}${time ? ' — ' + time : ''}`;
  });

  const message = `[F1] ${data.race} | ${data.date}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#F1 #Formula1 #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('f1-card-test posted:', result.id);
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('f1-card-test post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
