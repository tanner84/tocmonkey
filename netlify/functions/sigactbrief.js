// ─────────────────────────────────────────────────────────────────────────────
// SIGACT Brief — Netlify Scheduled Function
// Schedule: every 4 hours (0 */4 * * *)
//
// Each run picks one COCOM based on UTC hour window:
//   00-03 → EUCOM     04-07 → CENTCOM    08-11 → INDOPACOM
//   12-15 → AFRICOM   16-19 → SOUTHCOM   20-23 → NORTHCOM
//
// 1. Fetches live RSS items for that COCOM (calls own /rss function)
// 2. Generates SIGACT UPDATE post via Claude Haiku
// 3. POSTs to Facebook Page
//
// Required env vars (same as marketbrief):
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN
//   URL  (auto-set by Netlify — the site's deploy URL)
// ─────────────────────────────────────────────────────────────────────────────

// UTC hour → COCOM rotation (4-hour windows)
const COCOM_ROTATION = [
  { cocom: 'EUCOM',      full: 'U.S. European Command',          hours: [0,1,2,3]   },
  { cocom: 'CENTCOM',    full: 'U.S. Central Command',           hours: [4,5,6,7]   },
  { cocom: 'INDOPACOM',  full: 'U.S. Indo-Pacific Command',      hours: [8,9,10,11] },
  { cocom: 'AFRICOM',    full: 'U.S. Africa Command',            hours: [12,13,14,15] },
  { cocom: 'SOUTHCOM',   full: 'U.S. Southern Command',          hours: [16,17,18,19] },
  { cocom: 'NORTHCOM',   full: 'U.S. Northern Command',          hours: [20,21,22,23] },
];

function getCocomForHour(utcHour) {
  return COCOM_ROTATION.find(c => c.hours.includes(utcHour)) || COCOM_ROTATION[0];
}

// ── Fetch RSS items for COCOM via own function ────────────────────────────────
async function fetchRSSItems(cocom, siteUrl) {
  const url = `${siteUrl}/.netlify/functions/rss?cocom=${cocom}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

// ── Post to Facebook ──────────────────────────────────────────────────────────
async function postToFacebook(message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: pageToken }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function() {
  const utcHour = new Date().getUTCHours();
  const { cocom, full } = getCocomForHour(utcHour);
  const timestamp = new Date().toISOString().replace('T',' ').slice(0,16);

  const siteUrl = (process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');

  // ── Fetch RSS items ───────────────────────────────────────────────────────
  let items = [];
  try {
    items = await fetchRSSItems(cocom, siteUrl);
  } catch(e) {
    console.error('RSS fetch error:', e.message);
    return { statusCode: 500, body: `RSS fetch failed: ${e.message}` };
  }

  // Take top 20 most recent items — Claude will select the most relevant
  const top = items.slice(0, 20);
  if (top.length === 0) {
    return { statusCode: 200, body: 'No RSS items — skipping post' };
  }

  const itemsText = top.map((it, i) =>
    `${i+1}. [${it.source}] ${it.title}${it.desc ? ' — ' + it.desc.slice(0, 120) : ''}`
  ).join('\n');

  // ── Build Claude prompt ───────────────────────────────────────────────────
  const prompt = `You are a military OSINT analyst writing a public SIGACT update for a geopolitical awareness page.

Given these raw RSS headlines and snippets for ${full} (${cocom}) region:
${itemsText}

Write a SIGACT UPDATE post formatted exactly like this:

🔴 SIGACT UPDATE | ${cocom} | ${timestamp} UTC

- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]
(3-6 items max)

⚠️ DISCLAIMER: All reporting is derived from open-source media. Not verified by primary sources. For situational awareness only.

#OSINT #${cocom} #TOCMonkey

Rules: No speculation. No editorial. Locations first. Include any item with geographic/political/security/conflict relevance — cast a wide net. Only respond with exactly SKIP if there is truly nothing newsworthy at all.
Output only the post text — no preamble, no explanation.`;

  // ── Call Claude Haiku ─────────────────────────────────────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!aiRes.ok) return { statusCode: 500, body: `Claude API error: ${aiRes.status}` };

  const aiData = await aiRes.json();
  const briefText = aiData?.content?.[0]?.text?.trim();

  if (!briefText || briefText === 'SKIP') {
    console.log(`SIGACT ${cocom}: Claude returned SKIP — insufficient relevant items`);
    return { statusCode: 200, body: `Skipped ${cocom} — insufficient relevant items` };
  }

  // ── Post to Facebook ──────────────────────────────────────────────────────
  try {
    const fbResult = await postToFacebook(briefText);
    console.log(`SIGACT ${cocom} posted: ${fbResult.id}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, cocom, fb_post_id: fbResult.id, brief: briefText }),
    };
  } catch(fbErr) {
    console.error('Facebook post failed:', fbErr.message);
    console.log('Generated brief:\n', briefText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, cocom, error: fbErr.message, brief: briefText }),
    };
  }
};
