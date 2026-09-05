import { getStore } from '@netlify/blobs';

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

function env(name) {
  try { return Netlify.env.get(name) || process.env[name] || ''; }
  catch (_) { return process.env[name] || ''; }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type':'application/json', 'Cache-Control':'private, no-store' },
  });
}

function authorized(req) {
  const password = env('ADMIN_PASSWORD');
  return Boolean(password) && req.headers.get('x-admin-password') === password;
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

export default async (req) => {
  if (!authorized(req)) return json(401, { error:'Unauthorized' });
  if (req.method !== 'GET') return json(405, { error:'Method not allowed' });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const openaiConfigured = Boolean(env('OPENAI_API_KEY'));
  const configured = {
    openai:openaiConfigured,
    anthropic:openaiConfigured,
    facebook:Boolean(env('FACEBOOK_PAGE_ID') && (env('FACEBOOK_PAGE_ACCESS_TOKEN') || env('FACEBOOK_ACCESS_TOKEN'))),
    acled:Boolean(env('ACLED_EMAIL') && env('ACLED_KEY')),
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
      aiProvider:{ name:'OpenAI', configured:openaiConfigured, defaultModel:env('OPENAI_MODEL') || 'gpt-5.6-luna' },
      error:'Report storage unavailable',
      reports:REPORTS.map((report) => ({
        ...report,
        posted:false,
        completed:0,
        expected:(report.keyPrefix === 'sigact' || report.keyPrefix === 'ocg') ? 6 : 1,
      })),
      sitreps:COCOMS.map((cocom) => ({
        cocom,
        displayName:cocom === 'INDOPACOM' ? 'PACOM' : cocom,
        available:false,
        generatedAt:null,
        ageMinutes:null,
        freshness:'MISSING',
        mode:null,
        provider:null,
        model:null,
        sourceItemCount:0,
      })),
      configured,
      summary:{ availableSitreps:0, currentSitreps:0, totalSitreps:COCOMS.length, reportsPostedToday:0 },
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
    reportRows.push({
      ...report,
      posted,
      completed,
      expected:(report.keyPrefix === 'sigact' || report.keyPrefix === 'ocg') ? 6 : 1,
    });
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

  const availableSitreps = sitrepRows.filter((row) => row.available).length;
  const currentSitreps = sitrepRows.filter((row) => row.freshness === 'CURRENT').length;
  const status = openaiConfigured && currentSitreps >= 4 ? 'NOMINAL' : (availableSitreps ? 'DEGRADED' : 'OFFLINE');

  return json(200, {
    status,
    generatedAt:now.toISOString(),
    aiProvider:{
      name:'OpenAI',
      configured:openaiConfigured,
      defaultModel:env('OPENAI_MODEL') || 'gpt-5.6-luna',
      sitrepModel:env('OPENAI_SITREP_MODEL') || env('OPENAI_MODEL') || 'gpt-5.6-luna',
    },
    reports:reportRows,
    sitreps:sitrepRows,
    configured,
    summary:{
      availableSitreps,
      currentSitreps,
      totalSitreps:COCOMS.length,
      reportsPostedToday:reportRows.filter((row) => row.posted).length,
    },
  });
};
