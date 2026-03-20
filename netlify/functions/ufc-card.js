// UFC Results — posts logo + text main card results to Facebook
// Runs Saturday at 07:00 UTC (3am ET), captures Friday night results
const { getStore } = require('@netlify/blobs');

async function fetchResults(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        { role: 'user', content: 'Search for the most recent UFC or UFC Fight Night event results from last night or this week. Return ONLY raw JSON, no markdown:\n{"event":"UFC 000: NAME","date":"Mon DD YYYY","fights":[{"fighter1":"NAME","fighter2":"NAME","winner":"NAME","method":"KO/TKO","round":1,"time":"1:23","mainCard":true}]}\nInclude main card fights only (mainCard:true). If no recent event, return {"event":"","date":"","fights":[]}' },
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

  const now     = new Date();
  const dateKey = `ufc-${now.toISOString().slice(0, 10)}`;

  try {
    const store = getStore('sports-card-dedup');
    if (await store.get(dateKey)) {
      console.log(`ufc-card: already posted ${dateKey}`);
      return { statusCode: 200, body: 'Already posted' };
    }
  } catch(e) { console.warn('dedup check failed:', e.message); }

  let data;
  try {
    data = await fetchResults(anthropicKey);
    console.log(`ufc-card: fetched ${data.fights?.length || 0} fights, event: ${data.event}`);
  } catch(e) {
    console.error('ufc-card fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  if (!data.event || !data.fights || data.fights.length < 1) {
    console.log('ufc-card: no event found — skipping');
    return { statusCode: 200, body: 'No event' };
  }

  const lines = data.fights.map(f => {
    const method = [f.method, f.round ? `R${f.round}` : '', f.time].filter(Boolean).join(' ');
    return `🥊 ${f.winner} def. ${f.winner === f.fighter1 ? f.fighter2 : f.fighter1} — ${method}`;
  });

  const message = `🥋 [UFC] RESULTS | ${data.event} | ${data.date}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#UFC #MMA #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('ufc-card posted:', result.id);
    try { await getStore('sports-card-dedup').set(dateKey, result.id); } catch(e) {}
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('ufc-card post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
