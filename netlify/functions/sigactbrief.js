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
// 3. Runs second-pass verification against source material
// 4. POSTs to Facebook Page
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN
//   URL  (auto-set by Netlify — the site's deploy URL)
// ─────────────────────────────────────────────────────────────────────────────

// UTC hour → COCOM rotation (4-hour windows)
const COCOM_ROTATION = [
  {
    cocom: 'EUCOM', full: 'U.S. European Command', hours: [0,1,2,3],
    focus: 'Ukraine conflict, Eastern European security, NATO posture, Balkans, Baltic states, European defense industry, Russian military activity',
    exclude: 'Do NOT include items from the Middle East, Africa, or Asia — those belong to other COCOMs.',
  },
  {
    cocom: 'CENTCOM', full: 'U.S. Central Command', hours: [4,5,6,7],
    focus: 'Middle East conflicts, Iraq, Syria, Iran, Yemen, Afghanistan, Central Asia, Red Sea/Arabian Gulf security, Israel-Gaza',
    exclude: 'Do NOT include items from Europe, Sub-Saharan Africa, or Asia-Pacific.',
  },
  {
    cocom: 'INDOPACOM', full: 'U.S. Indo-Pacific Command', hours: [8,9,10,11],
    focus: 'South China Sea, Taiwan Strait, North Korea, Indo-Pacific military activity, Southeast Asia security, Australia/Japan/South Korea alliances',
    exclude: 'Do NOT include items from Europe, Middle East, or Africa.',
  },
  {
    cocom: 'AFRICOM', full: 'U.S. Africa Command', hours: [12,13,14,15],
    focus: 'Sahel instability, Horn of Africa, West Africa coups/terror, East Africa maritime security, sub-Saharan conflicts, Wagner/Russian activity in Africa',
    exclude: 'Do NOT include items from Europe, Middle East, or Asia.',
  },
  {
    cocom: 'SOUTHCOM', full: 'U.S. Southern Command', hours: [16,17,18,19],
    focus: 'Latin America and Caribbean security, Venezuela, Colombia, Mexico cartels, Haiti, narcotrafficking, regional elections and instability',
    exclude: 'Do NOT include items from Europe, Middle East, Africa, or Asia.',
  },
  {
    cocom: 'NORTHCOM', full: 'U.S. Northern Command', hours: [20,21,22,23],
    focus: 'North American homeland security, U.S.-Canada-Mexico border, Arctic sovereignty, NORAD activity, domestic military readiness, cyber threats to U.S. infrastructure',
    exclude: 'Do NOT include items outside North America or the Arctic region.',
  },
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

// ── Second-pass verification ──────────────────────────────────────────────────
async function verifyPost(rawSource, generatedPost, cocom, focus, exclude, anthropicKey) {
  const verifyPrompt = `You are a fact-checking editor for a military OSINT dashboard.
Review the following SIGACT post for ${cocom} and apply these rules strictly:

AOR FOCUS: ${focus}
GEOGRAPHIC RULE: ${exclude}

1. Remove any bullet that covers events outside the ${cocom} AOR. If a bullet describes events in the Middle East, Africa, Asia, etc. and this is a EUCOM post — delete it. Apply the same logic for all COCOMs.

2. Every remaining bullet must be traceable to a specific headline or snippet in the source material. If a bullet cannot be matched, delete it.

3. Remove any bullet that contains:
   - Casualty numbers not explicitly stated in source headlines
   - Unit names, ship names, commander names, or locations not present in source material
   - Causal language not directly from the source (e.g. 'resulting in', 'causing', 'leading to')
   - Any speculation about intent, outcome, or next steps

4. If fewer than 2 bullets remain after review, respond with only: SKIP

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
      max_tokens: 500,
      messages: [{ role: 'user', content: verifyPrompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`Verification API error: ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function() {
  const utcHour = new Date().getUTCHours();
  const { cocom, full, focus, exclude } = getCocomForHour(utcHour);
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

AOR: ${full} (${cocom})
FOCUS TOPICS: ${focus}
STRICT GEOGRAPHIC RULE: ${exclude}

Given these raw RSS headlines and snippets:
${itemsText}

Write a SIGACT UPDATE post formatted exactly like this:

🔴 SIGACT UPDATE | ${cocom} | ${timestamp} UTC

- [location] — [one sentence, factual, terse]
- [location] — [one sentence, factual, terse]
(3-6 items max)

⚠️ DISCLAIMER: All reporting is derived from open-source media. Not verified by primary sources. For situational awareness only.

#OSINT #${cocom} #TOCMonkey

Rules:
- Only include items that fall within the ${cocom} AOR. Discard any items outside that geographic scope.
- No speculation. No editorial. No invented details. Locations first.
- Use only what is stated in the source headlines — do not add context, causes, or outcomes not in the source.
- Only respond with exactly SKIP if there is truly nothing relevant within the AOR.
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
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!aiRes.ok) return { statusCode: 500, body: `Claude API error: ${aiRes.status}` };

  const aiData = await aiRes.json();
  const draftText = aiData?.content?.[0]?.text?.trim();

  if (!draftText || draftText === 'SKIP') {
    console.log(`SIGACT ${cocom}: Claude returned SKIP — insufficient relevant items`);
    return { statusCode: 200, body: `Skipped ${cocom} — insufficient relevant items` };
  }

  console.log(`SIGACT ${cocom} DRAFT (pre-verification):\n`, draftText);

  // ── Step 2: Verification ──────────────────────────────────────────────────
  let finalText = draftText;
  try {
    const verified = await verifyPost(itemsText, draftText, cocom, focus, exclude, anthropicKey);
    if (verified === 'SKIP') {
      console.log(`SIGACT ${cocom}: verification rejected all bullets (out-of-AOR or unverifiable) — skipping`);
      return { statusCode: 200, body: `Skipped ${cocom} — failed verification` };
    } else if (verified) {
      finalText = verified;
      if (draftText !== finalText) {
        console.log(`SIGACT ${cocom} VERIFIED (post-verification):\n`, finalText);
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
    console.log(`SIGACT ${cocom} posted: ${fbResult.id}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, cocom, fb_post_id: fbResult.id, brief: finalText }),
    };
  } catch(fbErr) {
    console.error('Facebook post failed:', fbErr.message);
    console.log('Final brief:\n', finalText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, cocom, error: fbErr.message, brief: finalText }),
    };
  }
};
