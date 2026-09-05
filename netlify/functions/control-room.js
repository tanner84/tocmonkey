const { getStore } = require('@netlify/blobs');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COCOMS = ['EUCOM', 'CENTCOM', 'INDOPACOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM'];

const REPORTS = [
  { id:'sigactbrief', name:'SIGACT Brief', schedule:'Every 4 hours', keyPrefix:'sigact' },
  { id:'sigactsummary', name:'24-Hour SIGACT Summary', schedule:'Daily · 14:15Z', keyPrefix:'sigactsummary' },
  { id:'tocsitrep', name:'TOC SITREP', schedule:'Daily · 18:00Z', keyPrefix:'tocsitrep' },
  { id:'maritimesitrep', name:'Maritime SITREP', schedule:'Daily · 01:00Z', keyPrefix:'maritime' },
  { id:'ocgbrief', name:'Organized Crime SITREP', schedule:'Six times daily', keyPrefix:'ocg' },
  { id:'adizbrief', name:'ADIZ Brief', schedule:'Daily · 07:00Z', keyPrefix:'adiz' },
  { id:'marketbrief', name:'Market Brief', schedule:'Weekdays · open/close', keyPrefix:null },
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

exports.handler = async function(event) {
  if (!authorized(event)) return json(401, { error:'Unauthorized' });
  if (event.httpMethod !== 'GET') return json(405, { error:'Method not allowed' });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  let dedup;
  let sitreps;
  try {
    dedup = getStore('sitrep-dedup');
    sitreps = getStore('sitrep-cache');
  } catch (error) {
    return json(200, { status:'DEGRADED', generatedAt:now.toISOString(), error:'Report storage unavailable', reports:[], sitreps:[] });
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
    sitrepRows.push({
      cocom,
      available:Boolean(cached?.text),
      generatedAt:cached?.ts ? new Date(cached.ts).toISOString() : null,
      ageMinutes:cached?.ts ? Math.max(0, Math.floor((Date.now() - cached.ts) / 60000)) : null
    });
  }

  const configured = {
    anthropic:Boolean(process.env.ANTHROPIC_API_KEY),
    facebook:Boolean(process.env.FACEBOOK_PAGE_ID && (process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN)),
    acled:Boolean(process.env.ACLED_EMAIL && process.env.ACLED_KEY)
  };
  const availableSitreps = sitrepRows.filter(row => row.available).length;
  const status = configured.anthropic && availableSitreps ? 'NOMINAL' : 'DEGRADED';

  return json(200, {
    status,
    generatedAt:now.toISOString(),
    reports:reportRows,
    sitreps:sitrepRows,
    configured,
    summary:{ availableSitreps, totalSitreps:COCOMS.length, reportsPostedToday:reportRows.filter(row => row.posted).length }
  });
};
