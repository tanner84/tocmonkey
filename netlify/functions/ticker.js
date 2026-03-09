// ─────────────────────────────────────────────────────────────────────────────
// Commodity Ticker — live prices
// Sources:
//   Oil (WTI/Brent): EIA.gov open API (free, no key required)
//   Metals + FX:     metals-api.com free tier (env: METALS_API_KEY)
//   Defense ETF:     Alpha Vantage free tier (env: ALPHAVANTAGE_KEY)
//   Natural Gas:     EIA.gov
// Cached 15 minutes — free tier rate limits
// ─────────────────────────────────────────────────────────────────────────────

let cache = null, cacheTime = 0;
const TTL = 15 * 60 * 1000;

// EIA series IDs
const EIA_SERIES = {
  WTI:     "PET.RWTC.D",   // WTI crude daily
  BRENT:   "PET.RBRTE.D",  // Brent crude daily
  NAT_GAS: "NG.RNGWHHD.D", // Henry Hub natural gas daily
};

async function fetchEIA(seriesId) {
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${process.env.EIA_API_KEY || "DEMO_KEY"}&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`EIA ${seriesId}: HTTP ${res.status}`);
  const json = await res.json();
  const rows = json?.response?.data || [];
  if (rows.length < 2) return null;
  const current = parseFloat(rows[0].value);
  const prev    = parseFloat(rows[1].value);
  return { price: current, change: parseFloat((current - prev).toFixed(3)) };
}

async function fetchMetals(symbols) {
  const key = process.env.METALS_API_KEY;
  if (!key) return null;
  // metals-api: base USD, get XAU (gold), XAG (silver), URANIUM not on metals-api
  // symbols like XAU, RUB, UAH as currency pairs
  const syms = symbols.join(',');
  const url = `https://metals-api.com/api/latest?access_key=${key}&base=USD&symbols=${syms}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Metals API: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`Metals API error: ${json.error?.info}`);
  return json.rates; // { XAU: 0.000427, RUB: 91.24, ... }
}

async function fetchAlphaVantage(symbol) {
  const key = process.env.ALPHAVANTAGE_KEY;
  if (!key) return null;
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const json = await res.json();
  const q = json["Global Quote"];
  if (!q || !q["05. price"]) return null;
  return {
    price:  parseFloat(q["05. price"]),
    change: parseFloat(q["09. change"]),
  };
}

// Fallback static prices if APIs fail
const FALLBACK = [
  { symbol:"WTI",         price:78.42,  change:+1.23,  unit:"$/bbl"   },
  { symbol:"BRENT",       price:82.17,  change:+0.89,  unit:"$/bbl"   },
  { symbol:"NAT GAS",     price:2.84,   change:-0.12,  unit:"$/MMBtu" },
  { symbol:"GOLD",        price:2341.5, change:+12.30, unit:"$/oz"    },
  { symbol:"USD/RUB",     price:91.24,  change:+0.44,  unit:""        },
  { symbol:"USD/UAH",     price:37.88,  change:-0.03,  unit:""        },
  { symbol:"URANIUM",     price:97.25,  change:+2.10,  unit:"$/lb"    },
  { symbol:"COPPER",      price:4.52,   change:-0.08,  unit:"$/lb"    },
  { symbol:"DEFENSE ETF", price:198.34, change:+3.11,  unit:"ITA"     },
  // Major stock indices fallbacks
  { symbol:"NASDAQ",      price:16000,  change:+100,   unit:""        },
  { symbol:"S&P 500",     price:5000,   change:+20,    unit:""        },
  { symbol:"DOW JONES",   price:38000,  change:+150,   unit:""        },
  { symbol:"FTSE 100",    price:7700,   change:+30,    unit:""        },
  { symbol:"NIKKEI 225",  price:39000,  change:+200,   unit:""        },
];

exports.handler = async function() {
  if (cache && Date.now() - cacheTime < TTL) {
    return { statusCode:200, headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=900"}, body:JSON.stringify(cache) };
  }

  const result = [...FALLBACK.map(f => ({ ...f }))]; // start with fallback, patch with live

  await Promise.allSettled([

    // ── OIL ──
    fetchEIA(EIA_SERIES.WTI).then(d => {
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "WTI");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    fetchEIA(EIA_SERIES.BRENT).then(d => {
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "BRENT");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    fetchEIA(EIA_SERIES.NAT_GAS).then(d => {
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "NAT GAS");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    // ── METALS + FX ──
    fetchMetals(["XAU","XCU","RUB","UAH"]).then(rates => {
      if (!rates) return;
      // Gold: metals-api returns how many XAU per 1 USD, invert for $/oz * 31.1035
      if (rates.XAU) {
        const pricePerOz = (1 / rates.XAU) * 31.1035;
        const idx = result.findIndex(r => r.symbol === "GOLD");
        if (idx >= 0) result[idx] = { ...result[idx], price: parseFloat(pricePerOz.toFixed(2)), live: true };
      }
      // Copper: XCU per USD (troy oz) — convert to $/lb: 1 troy oz = 0.0685 lb
      if (rates.XCU) {
        const pricePerLb = (1 / rates.XCU) / 14.583;
        const idx = result.findIndex(r => r.symbol === "COPPER");
        if (idx >= 0) result[idx] = { ...result[idx], price: parseFloat(pricePerLb.toFixed(3)), live: true };
      }
      if (rates.RUB) {
        const idx = result.findIndex(r => r.symbol === "USD/RUB");
        if (idx >= 0) result[idx] = { ...result[idx], price: parseFloat(rates.RUB.toFixed(2)), live: true };
      }
      if (rates.UAH) {
        const idx = result.findIndex(r => r.symbol === "USD/UAH");
        if (idx >= 0) result[idx] = { ...result[idx], price: parseFloat(rates.UAH.toFixed(2)), live: true };
      }
    }).catch(() => {}),

    // ── DEFENSE ETF (ITA) ──
    fetchAlphaVantage("ITA").then(d => {
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "DEFENSE ETF");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    // ── MAJOR STOCK INDICES ──
    fetchAlphaVantage("^IXIC").then(d => { // NASDAQ Composite
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "NASDAQ");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    fetchAlphaVantage("^GSPC").then(d => { // S&P 500
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "S&P 500");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    fetchAlphaVantage("^DJI").then(d => { // Dow Jones
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "DOW JONES");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    fetchAlphaVantage("^FTSE").then(d => { // FTSE 100
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "FTSE 100");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

    fetchAlphaVantage("^N225").then(d => { // Nikkei 225
      if (!d) return;
      const idx = result.findIndex(r => r.symbol === "NIKKEI 225");
      if (idx >= 0) result[idx] = { ...result[idx], price: d.price, change: d.change, live: true };
    }).catch(() => {}),

  ]);

  cache = result;
  cacheTime = Date.now();

  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json", "Cache-Control":"public,max-age=900" },
    body: JSON.stringify(result),
  };
};
