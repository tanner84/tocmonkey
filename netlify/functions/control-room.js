const { getStore } = require('@netlify/blobs');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COCOMS = ['EUCOM', 'CENTCOM', 'INDOPACOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM'];
const CURRENT_MIN = 360;
const AGING_MIN = 720;
const EXPIRED_MIN = 1440;

const REPORTS = [
  { id:'sigactbrief', name:'SIGACT Brief', schedule:'Every 4 hours', keyPrefix:'sigact' },
  { id:'sigactsummary', name:'24-Hour SIGACT Summary', schedule:'Daily · 14:15Z', keyPrefix:'sigactsummary' },
  { id:'tocsitrep', name:'TOC SITREP', schedule:'Daily · 18:00Z', keyPrefix:'tocsitrep' },
  { id:'maritimesitrep', name:'Maritime SITREP', schedule:'Daily · 01:00Z', keyPrefix:'maritime' },
  { id:'ocgbrief', name:'Organized Crime SITREP', schedule:'Six times daily', keyPrefix:'ocg' },
  { id:'adizbrief', name:'ADIZ Brief', schedule:'Daily · 07:00Z', keyPrefix:'adiz' },
  { id:'marketbrief', name:'Market Brief', schedule:'Weekdays · open/close', keyPrefix:null },
  { id:'cocom-sitrep', name:'COCOM Map SITREPs', schedule:'Every 4 hours', keyPrefix:null },
];

function json(statusCode, body) {
  return { statusCode, headers:{ 'Content-Type':'application/json', 'Cache-Control':'private, no-store' }, body:JSON.stringify(body) };
}

function authorized(event) {
  return Boolean(ADMIN_PASSWORD) && event.headers['x-admin-password'] === ADMIN_PASSWORD;
}

async function safeGet(store, key) {
  try { return await store.get(key); } catch (_) { return null; }
}

function freshness(ageMinutes) {
  if (ageMinutes == null) return 'MISSING';
  if (ageMinutes < CURRENT_MIN) return 'CURRENT';
  if (ageMinutes < AGING_MIN) return 'AGING';
  if (ageMinutes < EXPIRED_MIN) return 'DELAYED';
  return 'EXPIRED';
}

exports.handler = async function(event) {
  if (!authorized(event)) return json(401, { error:'Unauthorized' });
  if (event.httpMethod !== 'GET') return json(405, { error:'Method not allowed' });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const configured = {
    openai:openaiConfigured,
    // Temporary compatibility alias for the existing monolithic admin UI.
    // It still renders the generic `AI ✓` service indicator without requiring
    // a direct rewrite of admin.html.
    anthropic:openaiConfigured,
    facebook:Boolean(process.env.FACEBOOK_PAGE_ID && (process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN)),
    acled:Boolean(process.env.ACLED_EMAIL && process.env.ACLED_KEY)
  };
  let dedup;
  let sitreps;
  try {
    dedup = getStore('sitrep-dedup');
    sitreps = getStore('sitrep-cache');
  } catch (error) {
    return json(200, {
      status:'DEGRADED',
      generatedAt:now.toISOString(),
      aiProvider:{ name:'OpenAI', configured:openaiConfigured, defaultModel:process.env.OPENAI_MODEL || 'gpt-5.6-luna' },
      error:'Report storage unavailable',
      reports:REPORTS.map(report => ({
        ...report,
        posted:false,
        completed:0,
        expected:(report.keyPrefix === 'sigact' || report.keyPrefix === 'ocg') ? 6 : 1
      })),
      sitreps:COCOMS.map(cocom => ({ cocom, displayName:cocom === 'INDOPACOM' ? 'PACOM' : cocom, available:false, generatedAt:null, ageMinutes:null, freshness:'MISSING' })),
      configured,
      summary:{ availableSitreps:0, currentSitreps:0, totalSitreps:COCOMS.length, reportsPostedToday:0 }
    });
  }

  const reportRows = [];
  for (const report of REPORTS) {
    let posted = false;
    let completed = 0;
    if (report.keyPrefix === 'sigact' || report.keyPrefix === 'ocg') {
      for (const cocom of COCOMS) {
        if (await safeGet(dedup, `${report.keyPrefix}-${cocom}-${date}`)) completed++;
      }
      posted = completed > 0;
    } else if (report.keyPrefix) {
      posted = Boolean(await safeGet(dedup, `${report.keyPrefix}-${date}`));
      completed = posted ? 1 : 0;
    }
    reportRows.push({ ...report, posted, completed, expected:(report.keyPrefix === 'sigact' || report.keyPrefix === 'ocg') ? 6 : 1 });
  }

  const sitrepRows = [];
  for (const cocom of COCOMS) {
    let cached = null;
    try { cached = await sitreps.get(`sitrep-${cocom}`, { type:'json' }); } catch (_) {}
    const generatedAt = cached?.generatedAt || (cached?.ts ? new Date(cached.ts).toISOString() : null);
    const ageMinutes = cached?.ts ? Math.max(0, Math.floor((Date.now() - cached.ts) / 60000)) : null;
    sitrepRows.push({
      cocom,
      displayName:cocom === 'INDOPACOM' ? 'PACOM' : cocom,
      available:Boolean(cached?.text),
      generatedAt,
      ageMinutes,
      freshness:freshness(ageMinutes),
      mode:cached?.mode || null,
      provider:cached?.provider || null,
      model:cached?.model || null,
      sourceItemCount:cached?.sourceItemCount || 0,
      lastGenerationError:cached?.generationError || null,
    });
  }

  const availableSitreps = sitrepRows.filter(row => row.available).length;
  const currentSitreps = sitrepRows.filter(row => row.freshness === 'CURRENT').length;
  const status = openaiConfigured && currentSitreps >= 4 ? 'NOMINAL' : (availableSitreps ? 'DEGRADED' : 'OFFLINE');

  return json(200, {
    status,
    generatedAt:now.toISOString(),
    aiProvider:{
      name:'OpenAI',
      configured:openaiConfigured,
      defaultModel:process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      sitrepModel:process.env.OPENAI_SITREP_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-luna'
    },
    reports:reportRows,
    sitreps:sitrepRows,
    configured,
    summary:{ availableSitreps, currentSitreps, totalSitreps:COCOMS.length, reportsPostedToday:reportRows.filter(row => row.posted).length }
  });
};
