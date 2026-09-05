const { getStore } = require('@netlify/blobs');
const CONFIG = require('../../enhancements/audience-config.json');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function authorized(event) {
  return Boolean(ADMIN_PASSWORD) && event.headers['x-admin-password'] === ADMIN_PASSWORD;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'private, no-store'
    },
    body: JSON.stringify(body)
  };
}

function emptyMetrics() {
  return { totalClicks:0, bySource:{}, byCocom:{}, byDay:{}, firstSeenAt:null, lastClickAt:null };
}

function sumLastDays(byDay, days) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffKey = cutoff.toISOString().slice(0,10);
  return Object.entries(byDay || {}).reduce((sum,[day,count]) => day >= cutoffKey ? sum + Number(count || 0) : sum, 0);
}

function sortedEntries(object = {}) {
  return Object.entries(object)
    .map(([key,value]) => ({ key, count:Number(value || 0) }))
    .sort((a,b) => b.count - a.count || a.key.localeCompare(b.key));
}

exports.handler = async function(event) {
  if (!authorized(event)) return json(401, { error:'Unauthorized' });
  if (event.httpMethod !== 'GET') return json(405, { error:'Method not allowed' });

  let metrics = emptyMetrics();
  try {
    const store = getStore('audience-growth');
    const stored = await store.get('subscribe-clicks', { type:'json' });
    if (stored && typeof stored === 'object') metrics = { ...metrics, ...stored };
  } catch (_) {}

  return json(200, {
    generatedAt: new Date().toISOString(),
    newsletterName: CONFIG.newsletterName,
    substack: CONFIG.substack,
    note: 'These are first-party TOC Monkey outbound subscribe clicks, not Substack subscriber totals.',
    clicks: {
      allTime: Number(metrics.totalClicks || 0),
      last7Days: sumLastDays(metrics.byDay, 7),
      last30Days: sumLastDays(metrics.byDay, 30),
      firstSeenAt: metrics.firstSeenAt || null,
      lastClickAt: metrics.lastClickAt || null,
      bySource: sortedEntries(metrics.bySource),
      byCocom: sortedEntries(metrics.byCocom),
      byDay: Object.entries(metrics.byDay || {}).sort(([a],[b]) => a.localeCompare(b)).map(([day,count]) => ({ day, count:Number(count || 0) }))
    }
  });
};
