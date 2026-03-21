// ─────────────────────────────────────────────────────────────────────────────
// OCG Brief — Netlify Scheduled Function
// Schedule: 0 2,6,10,15,19,23 * * * (midpoints between SIGACT posts)
//
// UTC hour → COCOM:
//   02 → EUCOM      06 → CENTCOM     10 → INDOPACOM
//   15 → AFRICOM    19 → SOUTHCOM    23 → NORTHCOM
//
// 1. web_search for organized crime SIGACTs in COCOM AOR (Claude Sonnet)
// 2. Second-pass verification (Claude Haiku)
// 3. POST to Facebook Page
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const { getStore } = require('@netlify/blobs');

const OCG_COCOM = {
  2:  { cocom: 'EUCOM',     full: 'U.S. European Command',     aor: 'Europe and Eurasia', regions: 'Balkans, Eastern Europe, Caucasus, Western Europe' },
  6:  { cocom: 'CENTCOM',   full: 'U.S. Central Command',      aor: 'Middle East and Central Asia', regions: 'Afghanistan, Iran, Iraq, Syria, Central Asia, Arabian Peninsula' },
  10: { cocom: 'INDOPACOM', full: 'U.S. Indo-Pacific Command',  aor: 'Indo-Pacific', regions: 'Southeast Asia, South Asia, East Asia, Pacific Islands' },
  15: { cocom: 'AFRICOM',   full: 'U.S. Africa Command',        aor: 'Africa', regions: 'Sahel, Horn of Africa, West Africa, Central Africa, East Africa' },
  19: { cocom: 'SOUTHCOM',  full: 'U.S. Southern Command',      aor: 'Latin America and Caribbean', regions: 'Mexico, Central America, Colombia, Venezuela, Caribbean, Brazil',
       sources: [
         // Intelligence & Security
         'https://insightcrime.org', 'https://www.latinnews.com', 'https://southernpulse.com',
         'https://latinamericasecurityreport.com',
         // Military & Defense
         'https://www.zona-militar.com/en/', 'https://www.infodefensa.com', 'https://military.einnews.com/region/south-america',
         // Investigative / Crime
         'https://ojo-publico.com',
         // Regional News
         'https://en.mercopress.com', 'https://www.reuters.com/world/americas/', 'https://apnews.com/hub/latin-america',
         // Country-specific
         'https://g1.globo.com', 'https://www.lanacion.com.ar', 'https://www.eltiempo.com', 'https://www.semana.com',
         'https://runrun.es', 'https://efectococuyo.com', 'https://www.primicias.ec',
         'https://www.paginasiete.bo', 'https://www.animalpolitico.com', 'https://www.milenio.com',
         // Think Tanks & Analysis
         'https://igarape.org.br', 'https://www.cfr.org/global-conflict-tracker',
         'https://www.verdadabierta.com', 'https://www.connectas.org',
       ],
  },
  23: { cocom: 'NORTHCOM',  full: 'U.S. Northern Command',      aor: 'North America', regions: 'United States, Canada, Mexico border, Arctic' },
};

function getCocom(utcHour) {
  return OCG_COCOM[utcHour] || OCG_COCOM[3];
}

// ── Fetch OCG SIGACTs via Claude web_search ───────────────────────────────────
async function fetchOCGSigacts(cocomInfo, timestamp, anthropicKey) {
  const { cocom, full, aor, regions, sources } = cocomInfo;

  const sourceBlock = sources && sources.length
    ? `\nPriority sources to search (check these first):\n${sources.map(s => `- ${s}`).join('\n')}\n`
    : '';

  const prompt = `Search for the latest organized crime and transnational criminal organization (OCG/TCO) activity in the ${full} (${cocom}) area of responsibility: ${aor}.
Focus on: ${regions}.
${sourceBlock}
Look for recent news (past 24-48 hours) on:
- Drug trafficking operations and seizures
- Human trafficking and smuggling networks
- Gang and cartel activity, violence, or territorial shifts
- Money laundering, sanctions evasion, illicit finance
- Cybercrime linked to criminal organizations
- Arms trafficking
- Corruption, organized crime-linked arrests, or government crackdowns

Write an ORGANIZED CRIME SITUATION REPORT post formatted exactly like this:

🟠 ORGANIZED CRIME SITREP | ${cocom} | ${timestamp} UTC

- [Country/Region] — [one sentence, factual, terse]
- [Country/Region] — [one sentence, factual, terse]
(3-6 items max)

⚠️ DISCLAIMER: All reporting is derived from open-source media. Not verified by primary sources. For situational awareness only.

#OSINT #OrganizedCrime #TransnationalCrime #${cocom} #TOCMonkey

Rules: No speculation. No editorial. Locations first. Only verified or reported facts from search results.
If no relevant organized crime activity found in the past 48 hours, respond with only: SKIP
Output only the post text — no preamble, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(40000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();

  // Collect search result snippets for verification pass
  const searchSnippets = [];
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'tool_result' || block.type === 'tool_use') continue;
      if (block.type === 'web_search_tool_result') {
        // Collect search results for verification
        if (Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r.title || r.snippet) {
              searchSnippets.push(`[${r.title || ''}] ${r.snippet || ''}`);
            }
          }
        }
      }
    }
  }

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  return { draft: textBlock.text.trim(), sources: searchSnippets.join('\n') };
}

// ── Second-pass verification ───────────────────────────────────────────────────
async function verifyPost(sources, draft, cocomInfo, anthropicKey) {
  const prompt = `You are a fact-checking editor for a military OSINT dashboard covering organized crime (OCG/TCO) activity.

Review this OCG SIGACT post and apply these rules strictly:

1. Every bullet must describe actual reported criminal activity — drug seizures, arrests, cartel/gang incidents, trafficking operations, etc. Remove any bullet that is vague or speculative.

2. Remove any bullet that:
   - Invents casualty numbers, quantities, or unit names not in the source
   - Attributes actions to named groups without source support
   - Contains causal language not directly from the source
   - Speculates about intent, alliances, or future operations

3. Keep only items clearly within the ${cocomInfo.full} (${cocomInfo.cocom}) AOR: ${cocomInfo.aor}.

4. If fewer than 2 bullets remain after review, respond with only: SKIP

5. Return the corrected post only. No commentary, no explanation.

SOURCE SNIPPETS FROM WEB SEARCH:
${sources || '(none available)'}

POST TO VERIFY:
${draft}`;

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

  if (!res.ok) throw new Error(`Verify API error: ${res.status}`);
  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || null;
}

// ── Post to Facebook ───────────────────────────────────────────────────────────
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
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const utcHour   = new Date().getUTCHours();
  const cocomInfo = getCocom(utcHour);
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const dateKey   = `ocg-${cocomInfo.cocom}-${new Date().toISOString().slice(0,10)}`;

  console.log(`ocgbrief: hour=${utcHour} → ${cocomInfo.cocom}`);

  // ── Dedup — one post per COCOM per day ────────────────────────────────────
  try {
    const store    = getStore('sitrep-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`ocgbrief ${cocomInfo.cocom}: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  // ── Fetch draft via web_search ─────────────────────────────────────────────
  let draft, sources;
  try {
    ({ draft, sources } = await fetchOCGSigacts(cocomInfo, timestamp, anthropicKey));
  } catch(e) {
    console.error('OCG fetch failed:', e.message);
    return { statusCode: 500, body: `OCG fetch failed: ${e.message}` };
  }

  if (!draft || draft === 'SKIP') {
    console.log(`ocgbrief ${cocomInfo.cocom}: no relevant activity — skipping`);
    return { statusCode: 200, body: `Skipped ${cocomInfo.cocom} — no relevant OCG activity` };
  }

  console.log(`ocgbrief ${cocomInfo.cocom} DRAFT:\n`, draft);

  // ── Verification pass ──────────────────────────────────────────────────────
  let finalText = draft;
  try {
    const verified = await verifyPost(sources, draft, cocomInfo, anthropicKey);
    if (verified && verified !== 'SKIP') {
      if (draft !== verified) console.log('⚠️ Verification made changes.');
      else console.log('✓ Verification: no changes.');
      finalText = verified;
    } else if (verified === 'SKIP') {
      console.log(`ocgbrief ${cocomInfo.cocom}: verification rejected all bullets — skipping`);
      return { statusCode: 200, body: `Skipped ${cocomInfo.cocom} — failed verification` };
    } else {
      console.warn('Verification returned empty — using draft.');
    }
  } catch(e) {
    console.error('Verification failed — using draft:', e.message);
  }

  // ── Post to Facebook ───────────────────────────────────────────────────────
  try {
    const fbResult = await postToFacebook(finalText);
    const postId   = fbResult.id || fbResult.post_id || 'unknown';
    console.log(`ocgbrief ${cocomInfo.cocom} posted: ${postId}`);

    try {
      const store = getStore('sitrep-dedup');
      await store.set(dateKey, postId);
    } catch(e) {
      console.warn('Blobs dedup write failed (non-fatal):', e.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, cocom: cocomInfo.cocom, fb_post_id: postId }),
    };
  } catch(e) {
    console.error('Facebook post failed:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, cocom: cocomInfo.cocom, error: e.message, brief: finalText }),
    };
  }
};
