export default async (req) => {
  const ANTHROPIC_KEY = Netlify.env.get('ANTHROPIC_API_KEY');

  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await req.json(); }
  catch(e) { return new Response('Bad JSON', { status: 400 }); }

  const { cocomId = 'UNKNOWN', cocomFull = 'Unknown Command', zones = [], feedItems = [] } = body;

  const zonesText = zones.slice(0,10).map(z =>
    `${z.name} (${z.type}): ${z.intensity} intensity`
  ).join('\n');

  // Separate RSS (has URLs) from OSINT (usually no URLs)
  const rssItems = feedItems.filter(p => p.isRSS && p.url);
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

  try {
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

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `API error ${resp.status}: ${err.slice(0,200)}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text || 'No response';

    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
