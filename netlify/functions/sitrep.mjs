export default async (req) => {
  const ANTHROPIC_KEY = Netlify.env.get('ANTHROPIC_API_KEY');

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({
      text: 'SITREP UNAVAILABLE\n\nAPI key not configured. Contact admin.'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  let body;
  try { body = await req.json(); }
  catch(e) { return new Response('Bad JSON', { status: 400 }); }

  const { cocomId = 'UNKNOWN', cocomFull = 'Unknown Command', zones = [], feedItems = [] } = body;

  const zonesText = zones.slice(0,10).map(z =>
    `${z.name} (${z.type}): ${z.intensity} intensity`
  ).join('\n');

  const rssItems  = feedItems.filter(p => p.isRSS && p.url);
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

  // Retry up to 3 times with backoff on 529 overloaded
  const MAX_RETRIES = 3;
  let lastErr = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, (attempt - 1) * 1200));
      }

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 650,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (resp.status === 529 || resp.status === 503) {
        lastErr = resp.status === 529 ? 'API overloaded' : 'API unavailable';
        continue;
      }

      if (resp.status === 401 || resp.status === 403) {
        return new Response(JSON.stringify({
          text: `SITREP UNAVAILABLE\n\nAPI key invalid or expired. Update ANTHROPIC_API_KEY in Netlify environment variables.`
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (!resp.ok) {
        lastErr = `HTTP ${resp.status}`;
        continue;
      }

      const data = await resp.json();
      const text = data?.content?.[0]?.text || 'No response generated.';

      return new Response(JSON.stringify({ text }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });

    } catch(e) {
      lastErr = e.message;
      continue;
    }
  }

  // All retries exhausted — clean readable message
  return new Response(JSON.stringify({
    text: `SITREP — ${cocomId}\n\n// API servers temporarily overloaded.\n// Click tab again to retry.\n\n— ${lastErr}`
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
