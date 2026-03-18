// ─────────────────────────────────────────────────────────────────────────────
// 24-Hour SIGACT Summary — Netlify Scheduled Function
// Schedule: daily at 12:30 UTC (8:30am EDT)
//
// Fetches EUCOM + CENTCOM + INDOPACOM RSS feeds concurrently,
// generates a combined 24-hour SIGACT summary via Claude Haiku,
// runs a second-pass verification against source material,
// and posts to Facebook Page.
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN
//   URL  (auto-set by Netlify)
// ─────────────────────────────────────────────────────────────────────────────

const { getStore } = require('@netlify/blobs');

const COCOM_AOR = {
  EUCOM:     'Europe and Eurasia — Ukraine conflict, NATO posture, Balkans, Baltic states, Russian military activity, European defense industry. NOT Middle East, Africa, or Asia.',
  CENTCOM:   'Middle East and Central Asia — Iraq, Syria, Iran, Yemen, Afghanistan, Red Sea/Arabian Gulf, Israel-Gaza. NOT Europe, Sub-Saharan Africa, or Asia-Pacific.',
  INDOPACOM: 'Indo-Pacific — South China Sea, Taiwan Strait, North Korea, Southeast Asia, Australia/Japan/South Korea alliances. NOT Europe, Middle East, or Africa.',
};

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

function formatItems(items, max = 20) {
  return items.slice(0, max).map((it, i) =>
    `${i+1}. [${it.source}] ${it.title}${it.desc ? ' — ' + it.desc.slice(0, 120) : ''}`
  ).join('\n');
}

// ── Second-pass verification ──────────────────────────────────────────────────
async function verifyPost(rawSource, generatedPost, anthropicKey) {
  const verifyPrompt = `You are a fact-checking editor for a military OSINT dashboard.
Review the following 24-hour SIGACT summary and apply these rules strictly:

AOR RULES — enforce geographic scope per section:
- EUCOM section: ${COCOM_AOR.EUCOM}
- CENTCOM section: ${COCOM_AOR.CENTCOM}
- INDOPACOM section: ${COCOM_AOR.INDOPACOM}

1. Remove any bullet that covers events outside that section's AOR (e.g. a Middle East item in the EUCOM section must be deleted).

2. Every remaining bullet must be traceable to a specific headline or snippet in the source material. If a bullet cannot be matched, delete it.

3. Remove any bullet that contains:
   - Casualty numbers not explicitly stated in source headlines
   - Unit names, ship names, commander names not present in source material
   - Causal language not directly from the source (e.g. 'resulting in', 'causing', 'leading to')
   - Any speculation about intent, outcome, or next steps

4. If a section ends up with fewer than 2 verified bullets, omit that entire section from the post rather than pad it.

5. Return the corrected post only. No commentary, no explanation of changes.

SOURCE MATERIAL:
${rawSource}

POST TO VERIFY:
${generatedPost}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: verifyPrompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) throw new Error(`Verification API error: ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || null;
}

exports.handler = async function() {
  const siteUrl = (process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');
  const dateStr = new Date().toISOString().slice(0, 10);
  const dateKey = `sigactsummary-${dateStr}`;

  try {
    const store    = getStore('sitrep-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`sigactsummary: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  // ── Fetch all three COCOMs concurrently ───────────────────────────────────
  const [eucomRes, centcomRes, indopacomRes] = await Promise.allSettled([
    fetchRSSItems('EUCOM',     siteUrl),
    fetchRSSItems('CENTCOM',   siteUrl),
    fetchRSSItems('INDOPACOM', siteUrl),
  ]);

  const eucom     = eucomRes.status     === 'fulfilled' ? eucomRes.value     : [];
  const centcom   = centcomRes.status   === 'fulfilled' ? centcomRes.value   : [];
  const indopacom = indopacomRes.status === 'fulfilled' ? indopacomRes.value : [];

  if (!eucom.length && !centcom.length && !indopacom.length) {
    return { statusCode: 200, body: 'No RSS items for any COCOM — skipping' };
  }

  const eucomText     = formatItems(eucom);
  const centcomText   = formatItems(centcom);
  const indopacomText = formatItems(indopacom);

  const rawSource = `EUCOM:\n${eucomText}\n\nCENTCOM:\n${centcomText}\n\nINDOPACOM:\n${indopacomText}`;

  const prompt = `You are a military OSINT analyst writing a 24-hour SIGACT summary for a public geopolitical awareness page.

AOR RULES — each section must stay within its geographic scope:
- EUCOM: ${COCOM_AOR.EUCOM}
- CENTCOM: ${COCOM_AOR.CENTCOM}
- INDOPACOM: ${COCOM_AOR.INDOPACOM}

Given these RSS headlines and snippets from the last 24 hours, organized by COCOM region:

EUCOM:
${eucomText}

CENTCOM:
${centcomText}

INDOPACOM:
${indopacomText}

Write a post formatted exactly like this:

🌐 24-HR SIGACT SUMMARY | ${dateStr} UTC

🔵 EUCOM
- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]

🟡 CENTCOM
- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]

🔴 INDOPACOM
- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]

⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com

#OSINT #EUCOM #CENTCOM #INDOPACOM #TOCMonkey

Rules:
- Each section must ONLY use items from its own AOR source list above. Do not pull CENTCOM events into EUCOM, etc.
- Minimum 3 bullets per section. If fewer than 3 real items exist for a section, omit that section entirely.
- Locations first, always. No speculation, no editorial, no adjectives.
- Use only what is stated in the source headlines — do not add context, causes, or outcomes not in the source.
- Consolidate duplicate reports of the same event into one bullet. Max 5 bullets per section.
Output only the post text — no preamble, no explanation.`;

  // ── Call Claude Haiku — Step 1: Generation ────────────────────────────────
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
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!aiRes.ok) return { statusCode: 500, body: `Claude API error: ${aiRes.status}` };

  const aiData = await aiRes.json();
  const draftText = aiData?.content?.[0]?.text?.trim();
  if (!draftText) return { statusCode: 500, body: 'No content from Claude' };

  console.log('DRAFT (pre-verification):\n', draftText);

  // ── Step 2: Verification ──────────────────────────────────────────────────
  let finalText = draftText;
  try {
    const verified = await verifyPost(rawSource, draftText, anthropicKey);
    if (verified) {
      finalText = verified;
      if (draftText !== finalText) {
        console.log('VERIFIED (post-verification):\n', finalText);
        console.log('⚠️ Verification made changes to the draft.');
      } else {
        console.log('✓ Verification: no changes.');
      }
    } else {
      console.warn('Verification returned empty — using draft.');
    }
  } catch(verifyErr) {
    console.error('Verification failed — using draft:', verifyErr.message);
  }

  // ── Post to Facebook ──────────────────────────────────────────────────────
  try {
    const fbResult = await postToFacebook(finalText);
    const postId   = fbResult.id || fbResult.post_id || 'unknown';
    console.log(`24hr summary posted: ${postId}`);

    try {
      const store = getStore('sitrep-dedup');
      await store.set(dateKey, postId);
    } catch(e) {
      console.warn('Blobs dedup write failed (non-fatal):', e.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fb_post_id: postId, brief: finalText }),
    };
  } catch(fbErr) {
    console.error('Facebook post failed:', fbErr.message);
    console.log('Final brief:\n', finalText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: fbErr.message, brief: finalText }),
    };
  }
};
