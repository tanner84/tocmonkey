const { getStore } = require('@netlify/blobs');
const CONFIG = require('../../enhancements/audience-config.json');

function clean(value, fallback = 'unknown') {
  const text = String(value || fallback).toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return text.slice(0, 64) || fallback;
}

function normalizeCocom(value = '') {
  const raw = String(value || '').toUpperCase().trim();
  if (raw === 'INDOPACOM') return 'PACOM';
  return ['EUCOM','CENTCOM','PACOM','AFRICOM','SOUTHCOM','NORTHCOM'].includes(raw) ? raw : '';
}

function emptyMetrics() {
  return {
    version: 1,
    totalClicks: 0,
    bySource: {},
    byCocom: {},
    byDay: {},
    firstSeenAt: null,
    lastClickAt: null
  };
}

function pruneDays(byDay, keep = 180) {
  const entries = Object.entries(byDay || {}).sort(([a],[b]) => b.localeCompare(a)).slice(0, keep);
  return Object.fromEntries(entries);
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { 'Cache-Control':'no-store' }, body:'Method not allowed' };
  }

  const source = clean(event.queryStringParameters?.source || 'website');
  const cocom = normalizeCocom(event.queryStringParameters?.cocom || '');
  const content = clean(event.queryStringParameters?.content || '', '');
  const now = new Date();
  const day = now.toISOString().slice(0, 10);

  try {
    const store = getStore('audience-growth');
    let metrics = null;
    try { metrics = await store.get('subscribe-clicks', { type:'json' }); } catch (_) {}
    if (!metrics || typeof metrics !== 'object') metrics = emptyMetrics();

    metrics.totalClicks = Number(metrics.totalClicks || 0) + 1;
    metrics.bySource = metrics.bySource || {};
    metrics.bySource[source] = Number(metrics.bySource[source] || 0) + 1;
    metrics.byCocom = metrics.byCocom || {};
    if (cocom) metrics.byCocom[cocom] = Number(metrics.byCocom[cocom] || 0) + 1;
    metrics.byDay = metrics.byDay || {};
    metrics.byDay[day] = Number(metrics.byDay[day] || 0) + 1;
    metrics.byDay = pruneDays(metrics.byDay);
    metrics.firstSeenAt = metrics.firstSeenAt || now.toISOString();
    metrics.lastClickAt = now.toISOString();

    await store.setJSON('subscribe-clicks', metrics);
  } catch (error) {
    console.warn('Audience metric write failed:', error?.message || error);
  }

  const destination = new URL(CONFIG.substack.profileUrl);
  destination.searchParams.set('utm_source', CONFIG.campaign.utmSource);
  destination.searchParams.set('utm_medium', CONFIG.campaign.utmMedium);
  destination.searchParams.set('utm_campaign', CONFIG.campaign.utmCampaign);
  const attribution = [source, cocom ? cocom.toLowerCase() : '', content].filter(Boolean).join('-');
  if (attribution) destination.searchParams.set('utm_content', attribution);

  return {
    statusCode: 302,
    headers: {
      Location: destination.toString(),
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    },
    body: ''
  };
};
