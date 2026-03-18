// ─────────────────────────────────────────────────────────────────────────────
// ADIZ Brief — Netlify Scheduled Function
// Schedule: daily at 07:00 UTC (3am ET)
//
// Two-stage pipeline:
//   Stage 1 — Claude Sonnet + web_search: gather ADIZ events, produce
//             structured ADIZ Snapshot per Prompt 1 analytical framework
//   Stage 2 — Claude Haiku: compress snapshot into Facebook post per
//             Prompt 2 social formatter rules
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const { getStore } = require('@netlify/blobs');

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

// ── Stage 1: ADIZ Snapshot (Sonnet + web_search) ─────────────────────────────
async function fetchADIZSnapshot(timestamp, dateStr, anthropicKey) {
  const prompt = `You are an airspace intelligence analyst for TOC Monkey, a SITREP dashboard that maps security events to COCOM threat environments. Search for ADIZ intercepts, sovereign airspace violations, unusual air activity, and airspace closures from the past 24 hours across all COCOM theaters.

Search for recent news on: ADIZ intercepts, QRA scrambles, Russian bomber activity, Chinese airspace incursions, NORAD intercepts, NATO air policing, airspace violations, unusual military flight patterns, airspace closures.

After gathering results, produce a structured ADIZ Snapshot following these exact rules:

---

EVENT CLASSIFICATION — use only these types, do not upgrade:
- SOVEREIGN VIOLATION: Unannounced entry into sovereign national airspace. Requires official confirmation.
- ADIZ INTERCEPT: Aircraft entered ADIZ without filing, resulting in QRA or escort.
- CLOSE APPROACH: Aircraft approached ADIZ boundary without entering.
- UNUSUAL PATTERN: ISR orbit, bomber on atypical routing, transponder-off near sensitive airspace.
- AIRSPACE CLOSURE: Sovereign or administrative closure affecting civil or military traffic.

CONFIDENCE LEVELS — assign per event:
- CONFIRMED: Named government or military source on record.
- CORROBORATED: Multiple OSINT sources consistent with each other.
- SINGLE SOURCE: One OSINT source, no official confirmation.
- UNVERIFIED: Reported but not independently supported.

ACTOR ATTRIBUTION — do not infer actor from aircraft type alone. If unknown, say unknown.
AIRCRAFT TYPE — omit if unconfirmed rather than infer.
LOCATION — as specific as source supports; use regional descriptor if coordinates unconfirmed.

THEATER BASELINES — flag deviation from baseline, not just presence of activity:

NORTHCOM: Baseline = Russian Tu-95/Tu-160 transits near Alaskan ADIZ 1-2x monthly, NORAD-announced post-facto. Escalation: increased frequency, new vectors, fighter escort, transponder-off.

EUCOM: Baseline = Near-continuous Russian activity near Baltic, Black Sea, Scandinavian approaches. NATO QRA intercepts routine. Escalation: weapons bay activation, formation flights, multi-axis simultaneous approaches, activity near Finnish/Swedish airspace.

INDOPACOM: Baseline = Frequent and increasing Chinese activity near Taiwan Strait and Japanese ADIZ. JASDF/ROKAF intercepts published regularly. North Korean provocations periodic. Escalation: PLA combined arms coordination, H-6 beyond first island chain, activity during sensitive political windows.

CENTCOM: In active conflict, standard ADIZ framework may not apply. Assess: Iranian drone corridor activity, civil aviation airspace closure status, coalition/Iranian deconfliction breakdowns. Note if theater has transitioned from peacetime ADIZ posture.

SOUTHCOM: Baseline = Low volume. Russian bomber transits to Venezuela periodic and announced. Escalation: unannounced transits, new basing, third-party actor airspace use.

AFRICOM: Limited formal ADIZ infrastructure. Focus on: unauthorized overflights of partner airspace, Russian/Wagner air patterns, foreign military aviation at non-traditional basing.

ASSESSMENT RULES:
1. Pattern before incident — lead regional assessment with pattern context, then individual event.
2. Separate description from inference — state what happened, then new line for what it may indicate. Never blend.
3. No actor motive assertion — describe behavior only. Flag inference as inference.
4. CENTCOM exception — active kinetic operations: use "active conflict airspace management," note ADIZ baselines do not apply.
5. Empty regions — say "No activity above baseline threshold." Do not fabricate.
6. Fabrication prevention — sparse data = sparse output. Do not populate empty fields. Correct confidence levels matter more than complete-looking output.

---

OUTPUT FORMAT — produce exactly this structure:

ADIZ SNAPSHOT | ${dateStr} ${timestamp} UTC
[CLASSIFICATION: UNCLASSIFIED // OSINT]

[For each active region:]
[REGION NAME]
EVENT: [One line factual description] [CONFIDENCE LEVEL]
RESPONSE: [Intercept/no intercept, platform if known, or "No intercept response confirmed"]
ASSESSMENT: [Pattern context + analytical takeaway, description separated from inference]

[For inactive regions:]
[REGION NAME]: No activity above baseline threshold.

All reporting derived from open-source media and publicly available data. Unverified. For situational awareness only. | tocmonkey.com`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(50000),
  });

  if (!res.ok) throw new Error(`Anthropic API error (Stage 1): ${res.status}`);
  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Stage 1 response');
  return textBlock.text.trim();
}

// ── Stage 2: Social Formatter (Haiku) ─────────────────────────────────────────
async function formatFacebookPost(snapshot, dateStr, anthropicKey) {
  const prompt = `You are a social media formatter for TOC Monkey. You receive a completed ADIZ Snapshot as input. You do not re-analyze, re-verify, or add new information. Your only job is to compress the highest-signal content into a Facebook post.

VOICE: Direct and informational, not dramatic. Written for an audience that understands basic defense and geopolitical terminology. Confident but appropriately hedged where source material is unverified. Never sensationalized.

FORMAT RULES:
- Lead with the highest-signal event or pattern from the snapshot. If nothing is above baseline, say so — do not manufacture urgency.
- No bullet points in the post body
- 3-5 sentences maximum for the main post body
- Confidence levels from the snapshot carry through — SINGLE SOURCE events use "reportedly" or "per open-source reporting"
- Close with: Not verified. For situational awareness only.
- Hashtags on final line, 3-5 maximum, always include #TOCMonkey and #ADIZ, add theater-specific tags based on content (e.g., #EUCOM #NATOAirspace #INDOPACOM #NORTHCOM)

PRIORITY ORDER for lead content:
1. SOVEREIGN VIOLATION (rare — always leads if present)
2. CONFIRMED event above baseline for its theater
3. Pattern events (third incident this week, new approach vector, new actor behavior)
4. CORROBORATED events above baseline
5. If nothing clears the above — post "No significant ADIZ activity above baseline in the current window" with standard close and hashtags. Do not fabricate a post around SINGLE SOURCE or UNVERIFIED events.

WHAT NOT TO DO:
- Do not assert actor intent ("Russia is probing..." → "Russian aircraft were intercepted...")
- Do not upgrade event types from the snapshot
- Do not add details not present in the snapshot
- Do not use dramatic language: "alarming," "shocking," "unprecedented"
- Do not post SINGLE SOURCE or UNVERIFIED events without explicit hedging

OUTPUT FORMAT:
ADIZ SNAPSHOT | ${dateStr} UTC

[2-3 sentence factual summary of lead event]... [1 sentence pattern context if applicable]... [1 sentence regional significance if supported].

Not verified. For situational awareness only.

#TOCMonkey #ADIZ #[TheaterTag] #[EventTag]

---

ADIZ SNAPSHOT TO FORMAT:
${snapshot}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`Anthropic API error (Stage 2): ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const now       = new Date();
  const dateStr   = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 16);
  const dateKey   = `adiz-${dateStr}`;

  // ── Dedup — one post per day ───────────────────────────────────────────────
  try {
    const store    = getStore('sitrep-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`adizbrief: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  // ── Stage 1: ADIZ Snapshot ─────────────────────────────────────────────────
  let snapshot;
  try {
    snapshot = await fetchADIZSnapshot(timestamp, dateStr, anthropicKey);
    console.log('ADIZ Snapshot (Stage 1):\n', snapshot);
  } catch(e) {
    console.error('Stage 1 failed:', e.message);
    return { statusCode: 500, body: `Stage 1 failed: ${e.message}` };
  }

  // ── Stage 2: Facebook Post ─────────────────────────────────────────────────
  let fbPost;
  try {
    fbPost = await formatFacebookPost(snapshot, dateStr, anthropicKey);
    console.log('Facebook Post (Stage 2):\n', fbPost);
  } catch(e) {
    console.error('Stage 2 failed:', e.message);
    return { statusCode: 500, body: `Stage 2 failed: ${e.message}` };
  }

  if (!fbPost) {
    console.log('adizbrief: Stage 2 returned empty — skipping post');
    return { statusCode: 200, body: 'Stage 2 returned empty — skipping' };
  }

  // ── Post to Facebook ───────────────────────────────────────────────────────
  try {
    const fbResult = await postToFacebook(fbPost);
    const postId   = fbResult.id || fbResult.post_id || 'unknown';
    console.log(`adizbrief posted: ${postId}`);

    try {
      const store = getStore('sitrep-dedup');
      await store.set(dateKey, postId);
    } catch(e) {
      console.warn('Blobs dedup write failed (non-fatal):', e.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fb_post_id: postId, snapshot, post: fbPost }),
    };
  } catch(e) {
    console.error('Facebook post failed:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message, snapshot, post: fbPost }),
    };
  }
};
