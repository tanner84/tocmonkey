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
const REQUIRED_MARKET_KEYS = ['NASDAQ','SP500','DOW','FTSE100','NIKKEI225'];
const WEB_DESCRIPTIONS = {
  GOLD: 'gold spot or nearest widely reported benchmark in USD per troy ounce',
  USD_RUB: 'Russian rubles per 1 U.S. dollar',
  USD_UAH: 'Ukrainian hryvnia per 1 U.S. dollar',
  URANIUM: 'uranium spot price in USD per pound',
  COPPER: 'copper price in USD per pound',
  ITA: 'iShares U.S. Aerospace & Defense ETF share price in USD',
  NASDAQ: 'Nasdaq Composite index level',
  SP500: 'S&P 500 index level',
  DOW: 'Dow Jones Industrial Average index level',
  FTSE100: 'FTSE 100 index level',
  NIKKEI225: 'Nikkei 225 index level',
};
const WEB_BATCHES = [
  { name:'indices', keys:['NASDAQ','SP500','DOW','FTSE100','NIKKEI225'] },
  { name:'macro', keys:['GOLD','USD_RUB','USD_UAH','URANIUM','COPPER','ITA'] },
];

function env(name) {
  try {
    return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
  } catch (_) {
    return process.env[name] || '';
  }
}

function deployContext() {
  try {
    return globalThis.Netlify?.context?.deploy?.context || env('CONTEXT') || '';
  } catch (_) {
    return env('CONTEXT') || '';
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

async function researchWebQuoteBatch(batch) {
  const requested = batch.keys.map(key => `${key} = ${WEB_DESCRIPTIONS[key]}`).join('\n');
  const prompt = `Use web search to verify the most recent available market value and same-session/day absolute change for the instruments below. This is for a public informational dashboard, not trading execution. Prefer current or last official close values from reputable market, exchange, government, issuer or major financial-reporting sources. Do not estimate, interpolate, substitute a proxy for an index, or reuse example numbers. If you cannot verify both a price/level and its absolute daily change, omit that key.\n\nReturn ONLY raw JSON with only the requested keys.\n${requested}\n\nFor every returned key use exactly this object shape:\n{"price":number,"change":number,"changePct":number|null,"asOf":"short date/time or market-state note","source":"source name","sourceUrl":"https://..."}\n\nImportant: change MUST be the absolute price/point change, not the percent change. A negative day must have a negative change. Use the most recent available session for each market even if that market is closed.`;

  const result = await generateText({
    prompt,
    model: env('OPENAI_RESEARCH_MODEL') || 'gpt-5.6-terra',
    maxOutputTokens: 900,
    reasoningEffort: 'low',
    timeoutMs: 45000,
    retries: 1,
    tools: [{ type:'web_search' }],
  });

  const parsed = extractJson(result.text);
  const quotes = {};
  const rejected = [];
  for (const key of batch.keys) {
    const quote = normalizeQuote(key, parsed?.[key], { provider:'openai-web' });
    if (quote) quotes[key] = quote;
    else rejected.push(key);
  }
  return { quotes, rejected, model:result.model || null };
}

async function researchWebQuotes() {
  const settled = await Promise.allSettled(WEB_BATCHES.map(researchWebQuoteBatch));
  const quotes = {};
  const rejected = [];
  const errors = [];
  const models = new Set();

  settled.forEach((result, index) => {
    const batch = WEB_BATCHES[index];
    if (result.status === 'fulfilled') {
      Object.assign(quotes, result.value.quotes || {});
      rejected.push(...(result.value.rejected || []));
      if (result.value.model) models.add(result.value.model);
      return;
    }
    rejected.push(...batch.keys);
    errors.push(`${batch.name}: ${result.reason?.message || 'web research failed'}`);
  });

  return {
    quotes,
    rejected:[...new Set(rejected)],
    errors,
    model:models.size ? [...models].join(', ') : null,
  };
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

function coverageHealth(items = []) {
  const present = new Set(items.map(item => item?.key).filter(key => META[key]));
  const missingRequired = REQUIRED_MARKET_KEYS.filter(key => !present.has(key));
  return {
    degraded: missingRequired.length > 0,
    missingRequired,
  };
}

function cacheIsDegraded(cache) {
  if (!cache?.items?.length) return true;
  const health = coverageHealth(cache.items);
  return health.degraded;
}

async function refreshMarketData({ force = false } = {}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const previous = await readCache();
  const previousAge = previous?.updatedAt ? now - Date.parse(previous.updatedAt) : Infinity;

  if (!force && previous && !cacheIsDegraded(previous) && Number.isFinite(previousAge) && previousAge >= 0 && previousAge < MIN_REFRESH_MS) {
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
    errors.push(...(webResult.value.errors || []));
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

  const health = coverageHealth(items);
  const payload = {
    updatedAt: nowIso,
    model,
    items,
    coverage: {
      total: INSTRUMENTS.length,
      fresh: freshCount,
      lastVerified: staleCount,
      unavailable: INSTRUMENTS.length - items.length,
      degraded: health.degraded,
      missingRequired: health.missingRequired,
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

  try {
    const warmed = await refreshMarketData();
    if (warmed?.items?.length) return { items:warmed.items, updatedAt:warmed.updatedAt || null, coverage:warmed.coverage || null, stale:false };
  } catch (error) {
    console.warn('Market cache bootstrap failed:', error.message);
  }

  const eia = await fetchEiaQuotes();
  const items = Object.values(eia.quotes);
  const health = coverageHealth(items);
  return {
    items,
    updatedAt: new Date().toISOString(),
    coverage: {
      total:INSTRUMENTS.length,
      fresh:items.length,
      lastVerified:0,
      unavailable:INSTRUMENTS.length - items.length,
      degraded:health.degraded,
      missingRequired:health.missingRequired,
    },
    stale:false,
  };
}

module.exports = {
  INSTRUMENTS,
  readCache,
  refreshMarketData,
  getPublicTicker,
};
