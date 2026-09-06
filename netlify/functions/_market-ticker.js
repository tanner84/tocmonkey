const { getStore, getDeployStore } = require('@netlify/blobs');
const { generateText } = require('./_openai');

const STORE_NAME = 'market-ticker';
const STORE_KEY = 'latest';
const MIN_REFRESH_MS = 45 * 60 * 1000;
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const INSTRUMENTS = [
  { key:'WTI', symbol:'WTI', unit:'$/bbl', sourceType:'eia', seriesId:'PET.RWTC.D' },
  { key:'BRENT', symbol:'BRENT', unit:'$/bbl', sourceType:'eia', seriesId:'PET.RBRTE.D' },
  { key:'NAT_GAS', symbol:'NAT GAS', unit:'$/MMBtu', sourceType:'eia', seriesId:'NG.RNGWHHD.D' },
  { key:'GOLD', symbol:'GOLD', unit:'$/oz', sourceType:'web' },
  { key:'USD_RUB', symbol:'USD/RUB', unit:'', sourceType:'web' },
  { key:'USD_UAH', symbol:'USD/UAH', unit:'', sourceType:'web' },
  { key:'URANIUM', symbol:'URANIUM', unit:'$/lb', sourceType:'web' },
  { key:'COPPER', symbol:'COPPER', unit:'$/lb', sourceType:'web' },
  { key:'ITA', symbol:'DEFENSE ETF', unit:'ITA', sourceType:'web' },
  { key:'NASDAQ', symbol:'NASDAQ', unit:'', sourceType:'web' },
  { key:'SP500', symbol:'S&P 500', unit:'', sourceType:'web' },
  { key:'DOW', symbol:'DOW JONES', unit:'', sourceType:'web' },
  { key:'FTSE100', symbol:'FTSE 100', unit:'', sourceType:'web' },
  { key:'NIKKEI225', symbol:'NIKKEI 225', unit:'', sourceType:'web' },
];

const META = Object.fromEntries(INSTRUMENTS.map(item => [item.key, item]));

function env(name) {
  try { return globalThis.Netlify?.env?.get(name) || ''; } catch (_) { return ''; }
}

function deployContext() {
  try {
    return globalThis.Netlify?.context?.deploy?.context || env('CONTEXT') || '';
  } catch (_) {
    return '';
  }
}

function marketStore() {
  const context = deployContext();
  if (context && context !== 'production') return getDeployStore(STORE_NAME);
  return getStore(STORE_NAME, { consistency:'strong' });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeText(value, max = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch (_) {
    return '';
  }
}

function extractJson(text = '') {
  const raw = String(text).trim();
  try { return JSON.parse(raw); } catch (_) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in market research response');
  return JSON.parse(match[0]);
}

async function readCache() {
  try {
    const cached = await marketStore().get(STORE_KEY, { type:'json' });
    return cached && typeof cached === 'object' ? cached : null;
  } catch (_) {
    return null;
  }
}

async function writeCache(payload) {
  await marketStore().setJSON(STORE_KEY, payload);
}

function normalizeQuote(key, raw, defaults = {}) {
  const meta = META[key];
  if (!meta) return null;
  const price = num(raw?.price);
  const change = num(raw?.change);
  if (price === null || price <= 0 || change === null) return null;

  return {
    key,
    symbol: meta.symbol,
    unit: meta.unit,
    price,
    change,
    changePct: num(raw?.changePct),
    asOf: safeText(raw?.asOf || defaults.asOf || '', 80),
    source: safeText(raw?.source || defaults.source || '', 80),
    sourceUrl: validUrl(raw?.sourceUrl || defaults.sourceUrl || ''),
    provider: safeText(raw?.provider || defaults.provider || '', 40),
    verifiedAt: defaults.verifiedAt || new Date().toISOString(),
    status: 'verified',
    stale: false,
    live: true,
  };
}

async function fetchEiaQuote(meta) {
  const apiKey = env('EIA_API_KEY') || 'DEMO_KEY';
  const url = `https://api.eia.gov/v2/seriesid/${encodeURIComponent(meta.seriesId)}?api_key=${encodeURIComponent(apiKey)}&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=2`;
  const response = await fetch(url, { signal:AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error(`EIA ${meta.key} HTTP ${response.status}`);
  const json = await response.json();
  const rows = json?.response?.data || [];
  if (rows.length < 2) throw new Error(`EIA ${meta.key} returned insufficient rows`);

  const current = num(rows[0]?.value);
  const previous = num(rows[1]?.value);
  if (current === null || previous === null) throw new Error(`EIA ${meta.key} returned invalid values`);

  return normalizeQuote(meta.key, {
    price: current,
    change: current - previous,
    asOf: rows[0]?.period || '',
    source: 'U.S. EIA',
    sourceUrl: 'https://www.eia.gov/opendata/',
    provider: 'eia',
  });
}

async function fetchEiaQuotes() {
  const metas = INSTRUMENTS.filter(item => item.sourceType === 'eia');
  const settled = await Promise.allSettled(metas.map(fetchEiaQuote));
  const quotes = {};
  const errors = [];
  settled.forEach((result, index) => {
    const key = metas[index].key;
    if (result.status === 'fulfilled' && result.value) quotes[key] = result.value;
    else errors.push(`${key}: ${result.reason?.message || 'unknown EIA error'}`);
  });
  return { quotes, errors };
}

async function researchWebQuotes() {
  const prompt = `Use web search to verify the most recent available market value and same-session/day absolute change for the instruments below. This is for a public informational dashboard, not trading execution. Prefer current or last official close values from reputable market/exchange/financial reporting sources. Do not estimate, interpolate, or reuse example numbers. If you cannot verify both a price/level and its absolute daily change, omit that key.\n\nReturn ONLY raw JSON. Keys and required units:\nGOLD = gold spot or nearest widely reported benchmark in USD per troy ounce\nUSD_RUB = Russian rubles per 1 U.S. dollar\nUSD_UAH = Ukrainian hryvnia per 1 U.S. dollar\nURANIUM = uranium spot price in USD per pound\nCOPPER = copper price in USD per pound\nITA = iShares U.S. Aerospace & Defense ETF share price in USD\nNASDAQ = Nasdaq Composite index level\nSP500 = S&P 500 index level\nDOW = Dow Jones Industrial Average index level\nFTSE100 = FTSE 100 index level\nNIKKEI225 = Nikkei 225 index level\n\nFor every returned key use exactly this object shape:\n{"price":number,"change":number,"changePct":number|null,"asOf":"short date/time or market-state note","source":"source name","sourceUrl":"https://..."}\n\nImportant: change MUST be the absolute price/point change, not the percent change. A negative day must have a negative change. Use the most recent available session for each market even if that market is closed.`;

  const result = await generateText({
    prompt,
    model: env('OPENAI_RESEARCH_MODEL') || 'gpt-5.6-terra',
    maxOutputTokens: 1500,
    reasoningEffort: 'low',
    timeoutMs: 22000,
    retries: 0,
    tools: [{ type:'web_search' }],
  });

  const parsed = extractJson(result.text);
  const quotes = {};
  const rejected = [];
  for (const meta of INSTRUMENTS.filter(item => item.sourceType === 'web')) {
    const quote = normalizeQuote(meta.key, parsed?.[meta.key], { provider:'openai-web' });
    if (quote) quotes[meta.key] = quote;
    else rejected.push(meta.key);
  }
  return { quotes, rejected, model:result.model || null };
}

function previousByKey(cache) {
  const out = {};
  for (const item of cache?.items || []) {
    if (item?.key && META[item.key] && num(item.price) !== null && num(item.change) !== null) out[item.key] = item;
  }
  return out;
}

function staleCopy(item, nowIso) {
  if (!item) return null;
  return {
    ...item,
    symbol: META[item.key]?.symbol || item.symbol,
    unit: META[item.key]?.unit ?? item.unit,
    status: 'last_verified',
    stale: true,
    live: false,
    servedAt: nowIso,
  };
}

async function refreshMarketData({ force = false } = {}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const previous = await readCache();
  const previousAge = previous?.updatedAt ? now - Date.parse(previous.updatedAt) : Infinity;

  if (!force && previous && Number.isFinite(previousAge) && previousAge >= 0 && previousAge < MIN_REFRESH_MS) {
    return { ...previous, skipped:true, skipReason:'fresh-cache' };
  }

  const [eiaResult, webResult] = await Promise.allSettled([
    fetchEiaQuotes(),
    researchWebQuotes(),
  ]);

  const fresh = {};
  const errors = [];
  let model = null;

  if (eiaResult.status === 'fulfilled') {
    Object.assign(fresh, eiaResult.value.quotes);
    errors.push(...(eiaResult.value.errors || []));
  } else {
    errors.push(`EIA: ${eiaResult.reason?.message || 'refresh failed'}`);
  }

  if (webResult.status === 'fulfilled') {
    Object.assign(fresh, webResult.value.quotes);
    model = webResult.value.model || null;
    if (webResult.value.rejected?.length) errors.push(`Web unverified: ${webResult.value.rejected.join(', ')}`);
  } else {
    errors.push(`Web research: ${webResult.reason?.message || 'refresh failed'}`);
  }

  const old = previousByKey(previous);
  const items = [];
  let freshCount = 0;
  let staleCount = 0;

  for (const meta of INSTRUMENTS) {
    if (fresh[meta.key]) {
      items.push(fresh[meta.key]);
      freshCount++;
    } else if (old[meta.key]) {
      items.push(staleCopy(old[meta.key], nowIso));
      staleCount++;
    }
  }

  if (!items.length) throw new Error(`Market refresh produced no verified data${errors.length ? `: ${errors.join(' | ')}` : ''}`);

  const payload = {
    updatedAt: nowIso,
    model,
    items,
    coverage: {
      total: INSTRUMENTS.length,
      fresh: freshCount,
      lastVerified: staleCount,
      unavailable: INSTRUMENTS.length - items.length,
    },
    errors: errors.slice(0, 20),
  };

  await writeCache(payload);
  return payload;
}

async function getPublicTicker() {
  const cache = await readCache();
  if (cache?.items?.length) {
    const age = cache.updatedAt ? Date.now() - Date.parse(cache.updatedAt) : Infinity;
    const globallyStale = !Number.isFinite(age) || age > STALE_AFTER_MS;
    const items = cache.items
      .filter(item => META[item?.key] && num(item.price) !== null && num(item.change) !== null)
      .map(item => globallyStale ? staleCopy(item, new Date().toISOString()) : item);
    if (items.length) return { items, updatedAt:cache.updatedAt || null, coverage:cache.coverage || null, stale:globallyStale };
  }

  // One-time bootstrap if the Blob cache has never been populated. After this succeeds,
  // ordinary visitors only read the shared cache and never trigger market research.
  try {
    const warmed = await refreshMarketData();
    if (warmed?.items?.length) return { items:warmed.items, updatedAt:warmed.updatedAt || null, coverage:warmed.coverage || null, stale:false };
  } catch (error) {
    console.warn('Market cache bootstrap failed:', error.message);
  }

  // Last-resort bootstrap is official EIA data only. No invented values.
  const eia = await fetchEiaQuotes();
  return {
    items: Object.values(eia.quotes),
    updatedAt: new Date().toISOString(),
    coverage: { total:INSTRUMENTS.length, fresh:Object.keys(eia.quotes).length, lastVerified:0, unavailable:INSTRUMENTS.length - Object.keys(eia.quotes).length },
    stale:false,
  };
}

module.exports = {
  INSTRUMENTS,
  readCache,
  refreshMarketData,
  getPublicTicker,
};
