// ─────────────────────────────────────────────────────────────────────────────
// Market Brief — Netlify Scheduled Function
// Schedule: weekdays at open bell (14:30 UTC / 9:30am ET) via netlify.toml
//           weekdays at close bell (21:00 UTC / 4:00pm ET) via netlify.toml
//
// 1. Fetch live prices: EIA (WTI, Brent, Nat Gas) + Alpha Vantage (7 stocks)
// 2. Generate geopolitical brief via Claude Haiku
// 3. POST to Facebook Page via Graph API
//
// Required env vars (Netlify dashboard → Environment Variables):
//   ALPHAVANTAGE_KEY         — already set
//   EIA_API_KEY              — already set
//   ANTHROPIC_API_KEY        — already set
//   FACEBOOK_PAGE_ID         — your Facebook Page numeric ID
//   FACEBOOK_PAGE_ACCESS_TOKEN — long-lived Page access token
// ─────────────────────────────────────────────────────────────────────────────

const EIA_SERIES = {
  WTI:     "PET.RWTC.D",
  BRENT:   "PET.RBRTE.D",
  NAT_GAS: "NG.RNGWHHD.D",
};

// ── EIA fetch (same pattern as ticker.js) ────────────────────────────────────
async function fetchEIA(seriesId) {
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${process.env.EIA_API_KEY}&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`EIA ${seriesId}: HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.response?.data || [];
  if (rows.length < 2) return null;
  const current = parseFloat(rows[0].value);
  const prev    = parseFloat(rows[1].value);
  const pct     = ((current - prev) / prev * 100);
  return { price: current, change: parseFloat((current - prev).toFixed(3)), pct: parseFloat(pct.toFixed(2)) };
}

// ── Alpha Vantage fetch (same pattern as ticker.js) ──────────────────────────
async function fetchAV(symbol) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${process.env.ALPHAVANTAGE_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const json = await res.json();
  const q = json["Global Quote"];
  if (!q || !q["05. price"]) return null;
  return {
    symbol,
    price:  parseFloat(q["05. price"]),
    change: parseFloat(q["09. change"]),
    pct:    parseFloat(q["10. change percent"]?.replace('%','') || '0'),
  };
}

// ── Format a price line ───────────────────────────────────────────────────────
function fmt(price, pct) {
  const sign = pct >= 0 ? '+' : '';
  return `$${price.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}

// ── Post to Facebook ──────────────────────────────────────────────────────────
async function postToFacebook(message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
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
  // Determine OPEN or CLOSE based on UTC hour (open = 13-15, close = 20-22)
  const utcHour = new Date().getUTCHours();
  const bell = (utcHour >= 13 && utcHour <= 15) ? 'OPEN' : 'CLOSE';
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).toUpperCase();

  // ── Fetch all prices concurrently ──────────────────────────────────────────
  const [wtiRes, brentRes, gasRes, aaplRes, msftRes, nvdaRes, googlRes, pfeRes, jnjRes, mrkRes] =
    await Promise.allSettled([
      fetchEIA(EIA_SERIES.WTI),
      fetchEIA(EIA_SERIES.BRENT),
      fetchEIA(EIA_SERIES.NAT_GAS),
      fetchAV('AAPL'),
      fetchAV('MSFT'),
      fetchAV('NVDA'),
      fetchAV('GOOGL'),
      fetchAV('PFE'),
      fetchAV('JNJ'),
      fetchAV('MRK'),
    ]);

  const wti   = wtiRes.status   === 'fulfilled' ? wtiRes.value   : { price: 78.42, pct: 0 };
  const brent = brentRes.status === 'fulfilled' ? brentRes.value : { price: 82.17, pct: 0 };
  const gas   = gasRes.status   === 'fulfilled' ? gasRes.value   : { price: 2.84,  pct: 0 };
  const aapl  = aaplRes.status  === 'fulfilled' ? aaplRes.value  : { symbol:'AAPL',  price: 171, pct: 0 };
  const msft  = msftRes.status  === 'fulfilled' ? msftRes.value  : { symbol:'MSFT',  price: 415, pct: 0 };
  const nvda  = nvdaRes.status  === 'fulfilled' ? nvdaRes.value  : { symbol:'NVDA',  price: 875, pct: 0 };
  const googl = googlRes.status === 'fulfilled' ? googlRes.value : { symbol:'GOOGL', price: 165, pct: 0 };
  const pfe   = pfeRes.status   === 'fulfilled' ? pfeRes.value   : { symbol:'PFE',   price: 28,  pct: 0 };
  const jnj   = jnjRes.status   === 'fulfilled' ? jnjRes.value   : { symbol:'JNJ',   price: 158, pct: 0 };
  const mrk   = mrkRes.status   === 'fulfilled' ? mrkRes.value   : { symbol:'MRK',   price: 127, pct: 0 };

  const techLine   = [aapl,msft,nvda,googl].map(s => `${s.symbol} ${fmt(s.price, s.pct)}`).join(' | ');
  const pharmaLine = [pfe,jnj,mrk].map(s => `${s.symbol} ${fmt(s.price, s.pct)}`).join(' | ');

  // ── Notable movers (biggest absolute % moves) ─────────────────────────────
  const allStocks = [aapl,msft,nvda,googl,pfe,jnj,mrk].filter(Boolean);
  const sorted = [...allStocks].sort((a,b) => Math.abs(b.pct) - Math.abs(a.pct));
  const notableStr = sorted.slice(0,4).map(s => `${s.symbol} ${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%`).join(' · ');

  // ── Build Claude prompt ───────────────────────────────────────────────────
  const prompt = `You are a geopolitical market analyst. Given these current prices:

Oil (WTI): ${fmt(wti.price, wti.pct)}
Oil (Brent): ${fmt(brent.price, brent.pct)}
Natural Gas: ${fmt(gas.price, gas.pct)}
Big Tech (AAPL/MSFT/NVDA/GOOGL): ${techLine}
Pharma (PFE/JNJ/MRK): ${pharmaLine}

Write a market brief formatted exactly like this:

📊 ${bell} BELL | ${dateStr}

[2-3 sentences connecting commodity movement to geopolitical context — oil to CENTCOM/EUCOM tensions, nat gas to European energy security, pharma to policy risk, tech to INDOPACOM/Taiwan tensions and chip supply chain]

Notable moves: ${notableStr}

#Markets #Commodities #TOCMonkey

Rules: Connect market moves to the geopolitical regions. Terse. Military intelligence analyst voice. End with: Not investment advice.
Output only the post text — no preamble, no explanation.`;

  // ── Call Claude Haiku ─────────────────────────────────────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };
  }

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
    // Log the generated brief even if FB post fails
    console.error('Facebook post failed:', fbErr.message);
    console.log('Generated brief:\n', briefText);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: fbErr.message, brief: briefText }),
    };
  }
};
