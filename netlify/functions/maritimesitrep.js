// ─────────────────────────────────────────────────────────────────────────────
// Maritime SITREP — Netlify Scheduled Function
// Schedule: daily at 01:00 UTC
//
// Fetches RSS feeds for maritime-relevant COCOMs + ALL (maritime sources),
// generates a naval/shipping/maritime security brief via Claude Haiku,
// and posts to Facebook Page.
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
//   URL  (auto-set by Netlify)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchRSSItems(cocom, siteUrl) {
  const url = `${siteUrl}/.netlify/functions/rss?cocom=${cocom}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`RSS ${cocom} failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

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

function formatItems(items, max = 15) {
  return items.slice(0, max).map((it, i) =>
    `${i+1}. [${it.source}] ${it.title}${it.desc ? ' — ' + it.desc.slice(0, 120) : ''}`
  ).join('\n') || '(no items)';
}

exports.handler = async function() {
  const siteUrl = (process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');
  const dateStr = new Date().toISOString().slice(0, 10);

  // ── Fetch maritime-relevant COCOMs + ALL maritime sources concurrently ─────
  const [centcomRes, indopacomRes, eucomRes, northcomRes, allRes] =
    await Promise.allSettled([
      fetchRSSItems('CENTCOM',   siteUrl),
      fetchRSSItems('INDOPACOM', siteUrl),
      fetchRSSItems('EUCOM',     siteUrl),
      fetchRSSItems('NORTHCOM',  siteUrl),
      fetchRSSItems('ALL',       siteUrl),
    ]);

  const centcom   = centcomRes.status   === 'fulfilled' ? centcomRes.value   : [];
  const indopacom = indopacomRes.status === 'fulfilled' ? indopacomRes.value : [];
  const eucom     = eucomRes.status     === 'fulfilled' ? eucomRes.value     : [];
  const northcom  = northcomRes.status  === 'fulfilled' ? northcomRes.value  : [];
  const allItems  = allRes.status       === 'fulfilled' ? allRes.value       : [];

  // Filter ALL items to maritime sources only
  const MARITIME_HANDLES = new Set(['GCAPTAIN','NAVALNEWS','MARITIMEEXEC','USNI','LLOYDSLIST','SPLASH247']);
  const maritime = allItems.filter(it => MARITIME_HANDLES.has(it.source));

  if (!centcom.length && !indopacom.length && !eucom.length && !northcom.length && !maritime.length) {
    return { statusCode: 200, body: 'No RSS items for any COCOM — skipping' };
  }

  const prompt = `You are a naval intelligence analyst writing a daily maritime SITREP for a geopolitical awareness page. Focus exclusively on naval activity, shipping security, port incidents, chokepoint threats, piracy, and maritime gray-zone operations.

Given these RSS items from the last 24 hours:

DEDICATED MARITIME SOURCES (gCaptain, USNI, Naval News, etc.):
${formatItems(maritime, 20)}

CENTCOM (Red Sea / Gulf of Aden / Persian Gulf):
${formatItems(centcom, 10)}

INDOPACOM (South China Sea / Western Pacific / Indian Ocean):
${formatItems(indopacom, 10)}

EUCOM (Black Sea / Baltic / Mediterranean):
${formatItems(eucom, 10)}

NORTHCOM (Arctic / North Atlantic):
${formatItems(northcom, 8)}

Write a post formatted exactly like this:

⚓ MARITIME SITREP | ${dateStr} UTC

🟡 RED SEA / GULF OF ADEN
- [vessel/location] — [one sentence, factual, terse]
- [vessel/location] — [one sentence, factual, terse]

🔴 SOUTH CHINA SEA / PACIFIC
- [vessel/location] — [one sentence, factual, terse]
- [vessel/location] — [one sentence, factual, terse]

🔵 BLACK SEA / BALTIC / MED
- [vessel/location] — [one sentence, factual, terse]

🟤 ARCTIC / NORTH ATLANTIC
- [vessel/location] — [one sentence, factual, terse]

🌊 SHIPPING & CHOKEPOINTS
- [chokepoint/route] — [one sentence on traffic, disruption, or threat]
- [chokepoint/route] — [one sentence on traffic, disruption, or threat]

FALLBACK RULE — if fewer than 2 real maritime items exist for a region, replace that region's bullets with a SPOTLIGHT block instead:

🔦 SPOTLIGHT | [REGION]
[Vessel, actor, or threat] — [3-4 sentences of background: recent pattern, threat actor, state nexus if applicable. Draw from known OSINT. No speculation beyond documented reporting.]

Known entities for fallback reference:
RED SEA — Houthi naval denial ops, Iranian shadow fleet, MV Tutor wreck, Operation Prosperity Guardian
SOUTH CHINA SEA — PLAN carrier ops, Philippine BRP Sierra Madre standoff, Taiwan Strait transits, Mischief Reef
BLACK SEA — Russian Black Sea Fleet attrition, Ukrainian maritime drone strikes, grain corridor status
ARCTIC — Russian Northern Fleet, NATO exercise posture, Northwest Passage transit rights
CHOKEPOINTS — Bab-el-Mandeb, Strait of Hormuz, Malacca Strait, Danish Straits, Turkish Straits

⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com

#Maritime #NavalOSINT #ShippingSecurity #TOCMonkey

Rules:
- Lead with vessel name, location, or chokepoint — never lead with a country name alone.
- No speculation, no editorial, no adjectives.
- Consolidate duplicate reports into one bullet.
- Max 4 bullets per region.
- Shipping & Chokepoints section always present if any relevant items exist.
- Spotlight blocks preferred over padded or thin bullets.
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
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!aiRes.ok) return { statusCode: 500, body: `Claude API error: ${aiRes.status}` };

  const aiData = await aiRes.json();
  const briefText = aiData?.content?.[0]?.text?.trim();
  if (!briefText) return { statusCode: 500, body: 'No content from Claude' };

  // ── Post to Facebook ──────────────────────────────────────────────────────
  try {
    const fbResult = await postToFacebook(briefText);
    console.log(`Maritime SITREP posted: ${fbResult.id}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fb_post_id: fbResult.id, brief: briefText }),
    };
  } catch(fbErr) {
    console.error('Facebook post failed:', fbErr.message);
    console.log('Generated brief:\n', briefText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: fbErr.message, brief: briefText }),
    };
  }
};
