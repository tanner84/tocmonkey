import { getStore } from "@netlify/blobs";

// Public SITREP endpoint: read-only distribution layer.
// Public traffic never triggers a paid AI request. Fresh reports are produced
// by sitrep-generate (scheduled) or sitrep-regenerate (authenticated admin).
const COCOMS = new Set(['EUCOM', 'CENTCOM', 'INDOPACOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM']);
const CURRENT_MS = 6 * 60 * 60 * 1000;
const AGING_MS = 12 * 60 * 60 * 1000;
const EXPIRED_MS = 24 * 60 * 60 * 1000;

function normalizeCocom(value='') {
  const id = String(value).toUpperCase().trim();
  if (id === 'PACOM') return 'INDOPACOM';
  return COCOMS.has(id) ? id : null;
}

function displayName(id) {
  return id === 'INDOPACOM' ? 'PACOM' : id;
}

function freshness(ts) {
  if (!ts) return { state:'MISSING', ageMinutes:null };
  const ageMs = Math.max(0, Date.now() - Number(ts));
  const ageMinutes = Math.floor(ageMs / 60000);
  if (ageMs < CURRENT_MS) return { state:'CURRENT', ageMinutes };
  if (ageMs < AGING_MS) return { state:'AGING', ageMinutes };
  if (ageMs < EXPIRED_MS) return { state:'DELAYED', ageMinutes };
  return { state:'EXPIRED', ageMinutes };
}

function feedFallback(cocomId, feedItems=[]) {
  const seen = new Set();
  const items = feedItems.map(item => ({
    title:String(item?.title || item?.text || '').replace(/\s+/g,' ').trim().slice(0,220),
    source:String(item?.dname || item?.source || item?.src || '').replace(/\s+/g,' ').trim().slice(0,80),
    url:String(item?.url || item?.link || '').trim(),
  })).filter(item => item.title).filter(item => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0,6);

  const bullets = items.length
    ? items.map(item => `• ${item.title}${item.source ? ` — ${item.source}` : ''}${item.url ? `\n  ${item.url}` : ''}`).join('\n')
    : '• Live source feed is temporarily unavailable.';
  const stamp = new Date().toISOString().slice(0,16).replace('T',' ');
  return `SITREP — ${displayName(cocomId)}\n\nSITUATION\nAI assessment is temporarily unavailable. TOC Monkey is showing current source reporting rather than presenting expired analysis as current.\n\nLATEST REPORTING\n${bullets}\n\nINDICATORS\nNo AI-derived trend assessment is being asserted in this fallback product.\n\nASSESSMENT\nAutomated assessment pending the next successful backend generation.\n\n// SOURCE-ONLY FALLBACK · ${stamp}Z`;
}

function annotatedText(cached, state) {
  const stamp = cached?.generatedAt || (cached?.ts ? new Date(cached.ts).toISOString() : null);
  const time = stamp ? stamp.slice(0,16).replace('T',' ') + 'Z' : 'UNKNOWN';
  if (state.state === 'CURRENT') return `${cached.text}\n\n// CURRENT · UPDATED ${time}`;
  if (state.state === 'AGING') return `${cached.text}\n\n// AGING · LAST UPDATED ${time}`;
  if (state.state === 'DELAYED') return `${cached.text}\n\n// UPDATE DELAYED · LAST VALID REPORT ${time}`;
  return cached.text;
}

export default async (req) => {
  let body = {};
  if (req.method !== 'GET') {
    try { body = await req.json(); } catch (_) { body = {}; }
  }
  const url = new URL(req.url);
  const cocomId = normalizeCocom(body.cocomId || body.cocom || url.searchParams.get('cocom') || '');
  if (!cocomId) {
    return new Response(JSON.stringify({ error:'Invalid COCOM' }), {
      status:400,
      headers:{ 'Content-Type':'application/json' }
    });
  }

  let cached = null;
  try {
    const store = getStore('sitrep-cache');
    cached = await store.get(`sitrep-${cocomId}`, { type:'json' });
  } catch (_) {}

  const state = freshness(cached?.ts);
  if (cached?.text && state.state !== 'EXPIRED') {
    return json({
      text:annotatedText(cached, state),
      cached:true,
      stale:state.state !== 'CURRENT',
      freshness:state.state,
      ageMinutes:state.ageMinutes,
      generatedAt:cached.generatedAt || (cached.ts ? new Date(cached.ts).toISOString() : null),
      mode:cached.mode || 'AI',
      provider:cached.provider || null,
    });
  }

  // Never expose provider/billing failures to visitors and never present a
  // >24h analysis as current. Use current page feed data as a deterministic
  // source-only fallback until the backend generator succeeds.
  return json({
    text:feedFallback(cocomId, Array.isArray(body.feedItems) ? body.feedItems : []),
    cached:false,
    stale:true,
    freshness:'SOURCE_ONLY',
    ageMinutes:state.ageMinutes,
    generatedAt:new Date().toISOString(),
    mode:'SOURCE_ONLY',
  });
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status:200,
    headers:{
      'Content-Type':'application/json',
      'Cache-Control':'private, no-store'
    }
  });
}

export const config = {
  rateLimit:{
    windowLimit:60,
    windowSize:60,
    aggregateBy:['domain','ip']
  }
};
