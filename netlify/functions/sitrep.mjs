import { getStore } from "@netlify/blobs";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RETRIES  = 3;

export default async (req) => {
  const ANTHROPIC_KEY = Netlify.env.get('ANTHROPIC_API_KEY');

  if (!ANTHROPIC_KEY) {
    return json({ text: 'SITREP UNAVAILABLE\n\nAPI key not configured. Contact admin.' });
  }

  let body;
  try { body = await req.json(); }
  catch(e) { return new Response('Bad JSON', { status: 400 }); }

  const { cocomId = 'UNKNOWN', cocomFull = 'Unknown Command', zones = [], feedItems = [], forceRefresh = false } = body;
  const cacheKey = `sitrep-${cocomId}`;

  // ── Check Netlify Blobs cache (skip if forceRefresh) ─────────────────────
  try {
    const store = getStore('sitrep-cache');
    const cached = await store.get(cacheKey, { type: 'json' });
    if (!forceRefresh && cached && cached.text && cached.ts && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      // Return cached sitrep with age indicator
      const ageMin = Math.floor((Date.now() - cached.ts) / 60000);
      const text = cached.text + `\n\n// cached · ${ageMin}m ago`;
      return json({ text, cached: true });
    }
  } catch(e) {
    // Blobs unavailable — continue to generate fresh
  }

  // ── Build prompt ─────────────────────────────────────────────────────────
  const zonesText = zones.slice(0,10).map(z =>
    `${z.name} (${z.type}): ${z.intensity} intensity`
  ).join('\n');

  const rssItems   = feedItems.filter(p => p.isRSS && p.url);
  const osintItems = feedItems.filter(p => !p.isRSS);

  const rssText = rssItems.slice(0,5).map(p =>
    `[RSS] ${p.dname || p.src}: "${(p.text || '').slice(0,120)}" — ${p.url}`
  ).join('\n');

  const osintText = osintItems.slice(0,6).map(p =>
    `[OSINT] ${p.dname || p.src}: ${(p.text || '').slice(0,150)}`
  ).join('\n');

  const prompt = `You are a military intelligence analyst. Write a brief SITREP for ${cocomFull} (${cocomId}).

CONFLICT ZONES:
${zonesText || 'No zone data'}

RSS ARTICLES (these have source URLs):
${rssText || 'None'}

OSINT SOCIAL FEED:
${osintText || 'None'}

Write exactly these 4 sections:
SITUATION — 2-3 sentences on overall AOR status
KEY ACTIVITY — 3-4 bullet points (use • prefix) of notable events
INDICATORS — 2 sentences on trends or warning indicators
ASSESSMENT — 1-2 sentence bottom line

Then if any RSS articles above were relevant to your analysis, add:
SOURCES
• [Article title from above] | [exact URL from above]

Only include sources if you actually used RSS articles. Copy URLs exactly. Start with SITUATION.`;

  // ── Call Anthropic API with retry on 529 ─────────────────────────────────
  let lastErr = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) await sleep((attempt - 1) * 1500);

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 650,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (resp.status === 529 || resp.status === 503) {
        lastErr = `API overloaded (${resp.status}) — attempt ${attempt}/${MAX_RETRIES}`;
        continue;
      }

      if (resp.status === 401 || resp.status === 403) {
        return json({ text: `SITREP UNAVAILABLE\n\nAPI key invalid or expired.\nUpdate ANTHROPIC_API_KEY in Netlify environment variables.` });
      }

      if (!resp.ok) {
        lastErr = `HTTP ${resp.status}`;
        continue;
      }

      const data = await resp.json();
      const text = data?.content?.[0]?.text || 'No response generated.';

      // ── Cache successful result in Netlify Blobs ─────────────────────────
      try {
        const store = getStore('sitrep-cache');
        await store.setJSON(cacheKey, { text, ts: Date.now(), cocomId });
      } catch(e) {
        // Cache write failed — non-fatal, still return the result
      }

      return json({ text });

    } catch(e) {
      lastErr = e.message;
      continue;
    }
  }

  // ── All retries exhausted — try to return stale cache if available ────────
  try {
    const store = getStore('sitrep-cache');
    const stale = await store.get(cacheKey, { type: 'json' });
    if (stale?.text) {
      const ageMin = Math.floor((Date.now() - stale.ts) / 60000);
      return json({
        text: stale.text + `\n\n// stale cache · ${ageMin}m old · ${lastErr || 'API error'}, retry soon`,
        cached: true, stale: true
      });
    }
  } catch(e) {}

  // ── Nothing available — clean error message ───────────────────────────────
  return json({
    text: `SITREP — ${cocomId}\n\n// API servers temporarily overloaded.\n// Click the tab again in a moment to retry.\n\n— ${lastErr}`
  });
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
