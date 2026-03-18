// ─────────────────────────────────────────────────────────────────────────────
// TOC SITREP — Netlify Scheduled Function
// Schedule: daily at 18:00 UTC (2pm ET)
//
// Fetches RSS items for all 6 COCOMs concurrently, generates a transnational
// organized crime daily briefing via Claude Haiku, verifies against sources,
// and posts to Facebook Page.
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
//   URL  (auto-set by Netlify)
// ─────────────────────────────────────────────────────────────────────────────

// Per-COCOM OCG focus and geographic scope
const { getStore } = require('@netlify/blobs');

const COCOM_OCG = {
  EUCOM: {
    aor: 'Europe and Eurasia',
    focus: 'Russian organized crime (Bratva, Vory), FSB-OCG nexus, Eastern European trafficking networks, sanctions evasion, money laundering through European banks, Balkan crime groups',
    actors: 'Solntsevskaya Bratva, Tambovskaya, Izmaylovskaya, Georgian Vory, Mogilevich, Kalashov, Deripaska, Kovalchuk',
  },
  CENTCOM: {
    aor: 'Middle East and Central Asia',
    focus: 'Iranian IRGC procurement and sanctions evasion, hawala money networks, Afghan opium/heroin supply chains, Gulf-based illicit finance, Hezbollah financial operations',
    actors: 'IRGC Quds Force, Hezbollah finance wing, Afghan opium networks, hawala brokers',
  },
  INDOPACOM: {
    aor: 'Indo-Pacific',
    focus: 'Chinese Triad activity, North Korean state-sponsored cybercrime and crypto theft, Southeast Asian trafficking corridors, scam compounds, fentanyl precursor supply chains from China',
    actors: '14K Triad, Bamboo Union, North Korean Lazarus Group, Cambodian/Myanmar scam operations',
  },
  NORTHCOM: {
    aor: 'North America',
    focus: 'Mexican cartel operations in the U.S. and at the border, fentanyl distribution networks, MS-13/domestic gang activity, cartel money laundering through U.S. financial system',
    actors: 'Sinaloa Cartel, CJNG, Zetas remnants, Gulf Cartel, MS-13',
  },
  SOUTHCOM: {
    aor: 'Latin America and Caribbean',
    focus: 'South American cartel and gang activity, cocaine production and trafficking, Venezuelan crime-state nexus, Caribbean drug routes, guerrilla-OCG links',
    actors: 'Tren de Aragua, FARC dissidents, PCC, Clan del Golfo, Maduro-linked networks',
  },
  AFRICOM: {
    aor: 'Africa',
    focus: 'West African cybercrime and fraud networks, Sahel smuggling corridors, natural resource trafficking (gold, diamonds, ivory), terror-OCG financing links',
    actors: 'Black Axe, MEND remnants, Sahelian smuggling networks, Wagner Group commercial operations',
  },
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

function formatItems(items, max = 15) {
  return items.slice(0, max).map((it, i) =>
    `${i+1}. [${it.source}] ${it.title}${it.desc ? ' — ' + it.desc.slice(0, 120) : ''}`
  ).join('\n') || '(no items)';
}

// ── Second-pass verification ──────────────────────────────────────────────────
async function verifyPost(rawSource, generatedPost, anthropicKey) {
  const aorLines = Object.entries(COCOM_OCG)
    .map(([k, v]) => `- ${k}: ${v.aor} — ${v.focus}`)
    .join('\n');

  const verifyPrompt = `You are a fact-checking editor for a military OSINT and organized crime dashboard.
Review the following TOC SITREP post and apply these rules strictly:

AOR RULES — each section must stay within its geographic and thematic scope:
${aorLines}

1. Remove any bullet that attributes activity to the wrong COCOM AOR (e.g. a cartel bullet in the EUCOM section, or a Russian OCG bullet in the SOUTHCOM section).

2. Every remaining bullet must be traceable to a specific headline or snippet in the source material. If a bullet cannot be matched to source material, delete it.

3. Remove any bullet that:
   - Names specific OCG actors, financial figures, or casualty numbers not present in source material
   - Contains causal language not directly from the source
   - Speculates about alliances, intent, or future operations not in source

4. If a section has fewer than 2 verified bullets, replace it with a SPOTLIGHT block using only the known-actor background listed in the source. Do NOT invent current operational claims.

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
  const dateStr = new Date().toISOString().slice(0, 10);
  const dateKey = `tocsitrep-${dateStr}`;

  try {
    const store    = getStore('sitrep-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`tocsitrep: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

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

  const eucomText     = formatItems(eucom);
  const centcomText   = formatItems(centcom);
  const indopacomText = formatItems(indopacom);
  const northcomText  = formatItems(northcom);
  const southcomText  = formatItems(southcom);
  const africomText   = formatItems(africom);

  const rawSource = [
    `EUCOM:\n${eucomText}`,
    `CENTCOM:\n${centcomText}`,
    `INDOPACOM:\n${indopacomText}`,
    `NORTHCOM:\n${northcomText}`,
    `SOUTHCOM:\n${southcomText}`,
    `AFRICOM:\n${africomText}`,
  ].join('\n\n');

  // Build AOR focus lines for the prompt
  const aorBlock = Object.entries(COCOM_OCG)
    .map(([k, v]) => `${k} (${v.aor}): ${v.focus}`)
    .join('\n');

  const prompt = `You are a transnational organized crime (TOC) analyst writing a daily briefing for a geopolitical awareness page.

AOR AND FOCUS PER SECTION — each section must stay within its geographic scope:
${aorBlock}

Given these news items from the last 24 hours organized by COCOM region:

EUCOM:
${eucomText}

CENTCOM:
${centcomText}

INDOPACOM:
${indopacomText}

NORTHCOM:
${northcomText}

SOUTHCOM:
${southcomText}

AFRICOM:
${africomText}

Write a post formatted exactly like this:

🕵️ TOC SITREP | ${dateStr} UTC

🔵 EUCOM
- [OCG/actor] — [one sentence, factual, terse]
- [OCG/actor] — [one sentence, factual, terse]

🟡 CENTCOM
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

FALLBACK RULE — if fewer than 2 real news items exist for a region, replace that region's bullets with a SPOTLIGHT block:

🔦 SPOTLIGHT | [REGION]
[OCG or figure name] — [3-4 sentences of background: structure, known operations, current threat posture. Draw from documented OSINT only. No speculation.]

Known actors for fallback reference:
${Object.entries(COCOM_OCG).map(([k, v]) => `${k}: ${v.actors}`).join('\n')}

⚠️ All reporting derived from open-source media. Unverified. For situational awareness only. | tocmonkey.com

#TOC #OSINT #OrganizedCrime #TOCMonkey

Rules:
- Each section MUST only use items from its own AOR source list. Do not pull cartel news into EUCOM or Russian OCG news into SOUTHCOM.
- Name the specific OCG or actor first on every bullet — never lead with a country name.
- Use only what is stated in the source headlines. Do not invent actors, quantities, or outcomes.
- No adjectives, no editorial, no speculation beyond documented reporting.
- Consolidate duplicate reports into one bullet. Max 4 bullets per region.
- FSB-OCG nexus is a first-class data point — flag it explicitly when documented in source.
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

  console.log('TOC SITREP DRAFT (pre-verification):\n', draftText);

  // ── Step 2: Verification ──────────────────────────────────────────────────
  let finalText = draftText;
  try {
    const verified = await verifyPost(rawSource, draftText, anthropicKey);
    if (verified) {
      finalText = verified;
      if (draftText !== finalText) {
        console.log('TOC SITREP VERIFIED (post-verification):\n', finalText);
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
    console.log(`TOC SITREP posted: ${postId}`);

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
    console.log('Generated brief:\n', finalText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: fbErr.message, brief: finalText }),
    };
  }
};
