// ─────────────────────────────────────────────────────────────────────────────
// Maritime SITREP — Netlify Scheduled Function
// Schedule: daily at 01:00 UTC
//
// Fetches RSS feeds for maritime-relevant COCOMs + ALL (maritime sources),
// generates a naval/shipping/maritime security brief via Claude Haiku,
// runs a second-pass verification, and posts to Facebook Page.
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
//   URL  (auto-set by Netlify)
// ─────────────────────────────────────────────────────────────────────────────

const { getStore } = require('@netlify/blobs');

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

// ── Second-pass verification ──────────────────────────────────────────────────
async function verifyPost(rawSource, generatedPost, anthropicKey) {
  const verifyPrompt = `You are a fact-checking editor for a naval intelligence SITREP.
Review the following Maritime SITREP post and apply these rules strictly:

ACCURACY RULES:

1. INTERCEPT & CASUALTY FIGURES — If a bullet cites an intercept count or casualty number, verify it is explicitly stated in the source material. If the source is ambiguous about whether the figure is a single-event count or a cumulative total, rewrite to clarify (e.g., "intercepted 13 drones in the latest wave" vs "13 total since conflict onset"). Remove any figure not traceable to source.

2. MUNITIONS AND TARGET SPECIFICITY — Remove or generalize any bullet that names a specific munition type (bunker-buster, Tomahawk, Shahed-136, etc.) or precise target subcategory (coastal missile site, command node, etc.) unless a named source confirms it. Replace with operational-level language: "strikes on Iranian missile infrastructure" not "strikes using bunker-buster munitions on coastal missile sites."

3. COCOM THEATER ROUTING — Verify that each bullet appears under the correct regional section. Assign events to the region where the effect originates, not just where it is felt. A Beijing economic decision affecting INDOPACOM shipping should be under INDOPACOM, not the Red Sea section. Flag cross-theater linkages with a note rather than misassigning the event.

4. ACTOR COMPLETENESS — For Gulf states with active air defense or maritime incidents, check whether Bahrain (host of U.S. 5th Fleet) is mentioned when present in source reporting. Omitting Bahrain when it appears in source is a significant gap.

5. CHOKEPOINT STATUS LANGUAGE — Replace static descriptors ("closed," "open") with status language reflecting current reporting: "effectively closed," "limited transits reported," "reopening attempts underway." If tanker movement has resumed even partially, note it.

6. CONFIDENCE SIGNALING — For any detail not confirmed by a named OSINT source, use hedged language inline: "reported," "unconfirmed," "per open-source reporting." The footer disclaimer does not substitute for inline hedging where confidence varies.

7. SOURCE TRACEABILITY — Remove any bullet that cannot be matched to a specific headline or snippet in the source material provided.

Return the corrected post only. No commentary, no explanation of changes.

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
      max_tokens: 1000,
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
  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dateKey = `maritime-${dateStr}`;

  // ── Dedup — one post per day ───────────────────────────────────────────────
  try {
    const store    = getStore('sitrep-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`maritimesitrep: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

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

  const maritimeText  = formatItems(maritime, 20);
  const centcomText   = formatItems(centcom, 10);
  const indopacomText = formatItems(indopacom, 10);
  const eucomText     = formatItems(eucom, 10);
  const northcomText  = formatItems(northcom, 8);

  const rawSource = [
    `DEDICATED MARITIME SOURCES:\n${maritimeText}`,
    `CENTCOM (Red Sea / Gulf of Aden / Persian Gulf):\n${centcomText}`,
    `INDOPACOM (South China Sea / Western Pacific / Indian Ocean):\n${indopacomText}`,
    `EUCOM (Black Sea / Baltic / Mediterranean):\n${eucomText}`,
    `NORTHCOM (Arctic / North Atlantic):\n${northcomText}`,
  ].join('\n\n');

  const prompt = `You are a naval intelligence analyst writing a daily maritime SITREP for a geopolitical awareness page. Focus exclusively on naval activity, shipping security, port incidents, chokepoint threats, piracy, and maritime gray-zone operations.

ACCURACY RULES — apply these before writing any bullet:

1. INTERCEPT & CASUALTY FIGURES: Distinguish single-event figures from cumulative totals. If a source reports "13 drones intercepted," confirm whether that is one engagement or aggregate since conflict onset. Prefer cumulative figures; if using a single-event count, label it explicitly (e.g., "intercepted 13 drones in the latest wave").

2. MUNITIONS AND TARGET SPECIFICITY: Only assert specific munition types (bunker-buster, Tomahawk, Shahed-136, etc.) or precise target subcategories (coastal missile site, command node, etc.) when a named source confirms it. If the action is confirmed but specifics are not, write at operational level: "strikes on Iranian missile infrastructure" not "strikes using bunker-buster munitions on coastal missile sites."

3. COCOM THEATER ROUTING: Assign events to the region where the effect originates, not just where it is felt. A Beijing economic decision affecting INDOPACOM shipping belongs under INDOPACOM, not the Red Sea section. Use cross-theater linkage notes where relevant.

4. ACTOR COMPLETENESS (GCC): When reporting Gulf state air defense or maritime incidents, check all six GCC members: Bahrain, Kuwait, Oman, Qatar, Saudi Arabia, UAE. Bahrain hosts U.S. 5th Fleet and is a persistent target — omit it only if absent from source reporting.

5. CHOKEPOINT STATUS LANGUAGE: Avoid static "closed" or "open." Use: "effectively closed," "limited transits reported," "reopening attempts underway," "partial traffic resumed." If tanker movement has resumed even partially, note it — operationally significant.

6. CONFIDENCE SIGNALING: For any detail not confirmed by a named OSINT source, use hedged language inline: "reported," "unconfirmed," "per open-source reporting." The footer disclaimer does not substitute for inline hedging where confidence varies.

Given these RSS items from the last 24 hours:

DEDICATED MARITIME SOURCES (gCaptain, USNI, Naval News, etc.):
${maritimeText}

CENTCOM (Red Sea / Gulf of Aden / Persian Gulf):
${centcomText}

INDOPACOM (South China Sea / Western Pacific / Indian Ocean):
${indopacomText}

EUCOM (Black Sea / Baltic / Mediterranean):
${eucomText}

NORTHCOM (Arctic / North Atlantic):
${northcomText}

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
- [chokepoint/route] — [one sentence on traffic, disruption, or threat — use status language, not static descriptors]
- [chokepoint/route] — [one sentence on traffic, disruption, or threat]

FALLBACK RULE — if fewer than 2 real maritime items exist for a region, replace that region's bullets with a SPOTLIGHT block:

🔦 SPOTLIGHT | [REGION]
[Vessel, actor, or threat] — [3-4 sentences of background: recent pattern, threat actor, state nexus if applicable. Draw from documented OSINT only. No speculation.]

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
- Use only what is stated in the source headlines. Do not invent munition types, unit names, or casualty figures.
- Consolidate duplicate reports into one bullet.
- Max 4 bullets per region.
- Shipping & Chokepoints section always present if any relevant items exist.
- Spotlight blocks preferred over padded or thin bullets.
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
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!aiRes.ok) return { statusCode: 500, body: `Claude API error: ${aiRes.status}` };

  const aiData = await aiRes.json();
  const draftText = aiData?.content?.[0]?.text?.trim();
  if (!draftText) return { statusCode: 500, body: 'No content from Claude' };

  console.log('Maritime SITREP DRAFT (pre-verification):\n', draftText);

  // ── Step 2: Verification ──────────────────────────────────────────────────
  let finalText = draftText;
  try {
    const verified = await verifyPost(rawSource, draftText, anthropicKey);
    if (verified) {
      finalText = verified;
      if (draftText !== finalText) {
        console.log('Maritime SITREP VERIFIED (post-verification):\n', finalText);
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
    console.log(`Maritime SITREP posted: ${postId}`);

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
