// ─────────────────────────────────────────────────────────────────────────────
// TOC SITREP — Netlify Scheduled Function
// Schedule: daily at 18:00 UTC (2pm ET)
//
// Fetches RSS items for all 6 COCOMs concurrently, generates a transnational
// organized crime daily briefing via Claude Haiku, posts to Facebook Page.
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

  // ── Fetch all 6 COCOMs concurrently ──────────────────────────────────────
  const [eucomRes, centcomRes, indopacomRes, northcomRes, southcomRes, africomRes] =
    await Promise.allSettled([
      fetchRSSItems('EUCOM',     siteUrl),
      fetchRSSItems('CENTCOM',   siteUrl),
      fetchRSSItems('INDOPACOM', siteUrl),
      fetchRSSItems('NORTHCOM',  siteUrl),
      fetchRSSItems('SOUTHCOM',  siteUrl),
      fetchRSSItems('AFRICOM',   siteUrl),
    ]);

  const eucom     = eucomRes.status     === 'fulfilled' ? eucomRes.value     : [];
  const centcom   = centcomRes.status   === 'fulfilled' ? centcomRes.value   : [];
  const indopacom = indopacomRes.status === 'fulfilled' ? indopacomRes.value : [];
  const northcom  = northcomRes.status  === 'fulfilled' ? northcomRes.value  : [];
  const southcom  = southcomRes.status  === 'fulfilled' ? southcomRes.value  : [];
  const africom   = africomRes.status   === 'fulfilled' ? africomRes.value   : [];

  const prompt = `You are a transnational organized crime (TOC) analyst writing a daily briefing for a geopolitical awareness page. You have access to RSS feeds and OSINT sources covering organized crime, cartel activity, sanctions, and corruption.

Given these news items from the last 24 hours organized by COCOM region:

EUCOM:
${formatItems(eucom)}

CENTCOM:
${formatItems(centcom)}

INDOPACOM:
${formatItems(indopacom)}

NORTHCOM:
${formatItems(northcom)}

SOUTHCOM:
${formatItems(southcom)}

AFRICOM:
${formatItems(africom)}

Write a post formatted exactly like this:

🕵️ TOC SITREP | ${dateStr} UTC

🔵 EUCOM
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]

🟡 CENTCOM
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]

🔴 INDOPACOM
- [OCG/actor] — [one sentence, factual, terse]

🟠 NORTHCOM
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]

🟤 SOUTHCOM
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]

⚫ AFRICOM
- [OCG/actor] — [one sentence, factual, terse]

FALLBACK RULE — if fewer than 2 real news items exist for a region, replace that region's bullets with a SPOTLIGHT block instead:

🔦 SPOTLIGHT | [REGION]
[OCG or figure name] — [3-4 sentences of background: structure, leadership, state-crime nexus if applicable, current threat posture. Draw from known OSINT. No speculation beyond documented reporting.]

Known entities for fallback reference:
EUCOM — Solntsevskaya Bratva, Tambovskaya, Izmaylovskaya, Georgian Vory, Mogilevich, Kalashov, Deripaska, Kovalchuk, Zolotov
CENTCOM — Hawala networks, Iranian IRGC procurement cells, Afghan opium networks
INDOPACOM — 14K Triad, Bamboo Union, North Korean Lazarus Group financial ops
NORTHCOM — Sinaloa Cartel, CJNG, Zetas remnants, Gulf Cartel
SOUTHCOM — Tren de Aragua, FARC dissidents, PCC, Clan del Golfo
AFRICOM — Black Axe, MEND remnants, Sahelian smuggling networks

⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com

#TOC #OSINT #OrganizedCrime #TOCMonkey

Rules:
- Name the specific OCG or actor first on every bullet, never lead with a country name.
- No adjectives, no editorial, no speculation beyond documented reporting.
- Consolidate duplicate reports into one bullet.
- Max 4 bullets per region.
- Spotlight blocks are preferable to thin or padded bullets.
- FSB-OCG nexus is a first-class data point — flag it explicitly when documented.
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
    console.log(`TOC SITREP posted: ${fbResult.id}`);
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
