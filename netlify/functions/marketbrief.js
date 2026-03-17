// ─────────────────────────────────────────────────────────────────────────────
// Market Brief — Netlify Scheduled Function
// Schedule: weekdays at open bell (13:30 UTC / 9:30am EDT) via netlify.toml
//           weekdays at close bell (20:30 UTC / 4:30pm EDT) via netlify.toml
//
// 1. Fetch live prices via Claude web_search tool
// 2. Generate geopolitical brief via Claude Haiku
// 3. POST to Facebook Page via Graph API
//
// Required env vars (Netlify dashboard → Environment Variables):
//   ANTHROPIC_API_KEY        — already set
//   FACEBOOK_PAGE_ID         — your Facebook Page numeric ID
//   FACEBOOK_PAGE_ACCESS_TOKEN — long-lived Page access token
// ─────────────────────────────────────────────────────────────────────────────

// ── Format a price line ───────────────────────────────────────────────────────
function fmt(price, pct) {
  const sign = pct >= 0 ? '+' : '';
  return `$${price.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}

// ── Post to Facebook ──────────────────────────────────────────────────────────
async function postToFacebook(message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');

  const url = `https://graph.facebook.com/v19.0/${pageId}/feed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: pageToken }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook API ${res.status}: ${err}`);
  }
  return await res.json();
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  // Determine OPEN or CLOSE based on UTC hour
  const utcHour = new Date().getUTCHours();
  const bell = (utcHour >= 13 && utcHour <= 15) ? 'OPEN' : 'CLOSE';
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).toUpperCase();

  // ── Fetch live prices via Claude web_search ───────────────────────────────
  const priceResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Search for today's most recent prices for: WTI crude oil, Brent crude,
      natural gas, AAPL, MSFT, NVDA, GOOGL, PFE, JNJ, MRK.
      Return ONLY raw JSON with no markdown, no backticks, no preamble, no commentary.
      Use this exact format:
      {"WTI": {"price": 94.46, "change": -5.28}, "AAPL": {"price": 227.50, "change": 1.24}}
      If you cannot find a current price for a ticker, omit that key entirely.
      All change values are daily percent change.`
      }]
    })
  });

  const priceData = await priceResponse.json();

  // Extract text content from response, handling tool_use blocks
  const textBlock = priceData.content && priceData.content.find(block => block.type === "text");
  if (!textBlock) {
    console.error("No text block in price response:", JSON.stringify(priceData.content));
    return { statusCode: 500, body: 'No text block in price response' };
  }

  let prices;
  try {
    prices = JSON.parse(textBlock.text.trim());
  } catch (err) {
    console.error("Price JSON parse failed. Raw response:", textBlock.text);
    return { statusCode: 500, body: 'Price JSON parse failed' };
  }

  // Validate — skip any ticker returning 0 or null
  const validated = Object.fromEntries(
    Object.entries(prices).filter(([_, v]) => v.price && v.price !== 0)
  );

  if (Object.keys(validated).length < 3) {
    console.error("Insufficient price data returned:", validated);
    return { statusCode: 500, body: 'Insufficient price data' };
  }

  // ── Build price strings for prompt ───────────────────────────────────────
  const g = (key, fallbackPrice) => validated[key] || { price: fallbackPrice, change: 0 };

  const wti   = g('WTI',     78.42);
  const brent = g('BRENT',   82.17);
  const gas   = g('NAT_GAS', 2.84);

  const stocks = ['AAPL','MSFT','NVDA','GOOGL','PFE','JNJ','MRK']
    .map(sym => ({ symbol: sym, ...(validated[sym] || null) }))
    .filter(s => s.price);

  const techStocks   = stocks.filter(s => ['AAPL','MSFT','NVDA','GOOGL'].includes(s.symbol));
  const pharmaStocks = stocks.filter(s => ['PFE','JNJ','MRK'].includes(s.symbol));

  const techLine   = techStocks.map(s => `${s.symbol} ${fmt(s.price, s.change)}`).join(' | ');
  const pharmaLine = pharmaStocks.map(s => `${s.symbol} ${fmt(s.price, s.change)}`).join(' | ');

  const sorted = [...stocks].sort((a,b) => Math.abs(b.change) - Math.abs(a.change));
  const notableStr = sorted.slice(0,4).map(s => `${s.symbol} ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%`).join(' · ');

  // ── Build Claude prompt ───────────────────────────────────────────────────
  const prompt = `You are a geopolitical market analyst. Given these current prices:

Oil (WTI): ${fmt(wti.price, wti.change)}
Oil (Brent): ${fmt(brent.price, brent.change)}
Natural Gas: ${fmt(gas.price, gas.change)}
Big Tech (AAPL/MSFT/NVDA/GOOGL): ${techLine || 'unavailable'}
Pharma (PFE/JNJ/MRK): ${pharmaLine || 'unavailable'}

Write a market brief formatted exactly like this:

📊 ${bell} BELL | ${dateStr}

[2-3 sentences connecting commodity movement to geopolitical context — oil to CENTCOM/EUCOM tensions, nat gas to European energy security, pharma to policy risk, tech to INDOPACOM/Taiwan tensions and chip supply chain]

Notable moves: ${notableStr || 'n/a'}

#Markets #Commodities #TOCMonkey

Rules: Connect market moves to the geopolitical regions. Terse. Military intelligence analyst voice. End with: Not investment advice.
Output only the post text — no preamble, no explanation.`;

  // ── Call Claude Haiku for the brief ───────────────────────────────────────
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!aiRes.ok) {
    return { statusCode: 500, body: `Claude API error: ${aiRes.status}` };
  }

  const aiData = await aiRes.json();
  const briefText = aiData?.content?.[0]?.text;
  if (!briefText) {
    return { statusCode: 500, body: 'No content from Claude' };
  }

  // ── Post to Facebook ──────────────────────────────────────────────────────
  try {
    const fbResult = await postToFacebook(briefText);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fb_post_id: fbResult.id, bell, brief: briefText }),
    };
  } catch (fbErr) {
    console.error('Facebook post failed:', fbErr.message);
    console.log('Generated brief:\n', briefText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: fbErr.message, brief: briefText }),
    };
  }
};
