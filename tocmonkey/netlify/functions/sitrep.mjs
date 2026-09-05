import { getStore } from "@netlify/blobs";

// Deprecated nested copy retained for repo compatibility. Mirrors the deployed
// root public SITREP endpoint: read-only distribution, never paid AI generation.
const COCOMS = new Set(['EUCOM', 'CENTCOM', 'INDOPACOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM']);
const CURRENT_MS = 6 * 60 * 60 * 1000;
const AGING_MS = 12 * 60 * 60 * 1000;
const EXPIRED_MS = 24 * 60 * 60 * 1000;

function normalizeCocom(value='') {
  const id = String(value).toUpperCase().trim();
  if (id === 'PACOM') return 'INDOPACOM';
  return COCOMS.has(id) ? id : null;
}
function displayName(id) { return id === 'INDOPACOM' ? 'PACOM' : id; }
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
  const items = feedItems.map(item => ({
    title:String(item?.title || item?.text || '').replace(/\s+/g,' ').trim().slice(0,220),
    source:String(item?.dname || item?.source || item?.src || '').replace(/\s+/g,' ').trim().slice(0,80),
    url:String(item?.url || item?.link || '').trim(),
  })).filter(item => item.title).slice(0,6);
  const bullets = items.length ? items.map(item => `• ${item.title}${item.source ? ` — ${item.source}` : ''}${item.url ? `\n  ${item.url}` : ''}`).join('\n') : '• Live source feed is temporarily unavailable.';
  const stamp = new Date().toISOString().slice(0,16).replace('T',' ');
  return `SITREP — ${displayName(cocomId)}\n\nSITUATION\nAI assessment is temporarily unavailable. TOC Monkey is showing current source reporting rather than expired analysis.\n\nLATEST REPORTING\n${bullets}\n\nASSESSMENT\nAutomated assessment pending the next successful backend generation.\n\n// SOURCE-ONLY FALLBACK · ${stamp}Z`;
}
function annotatedText(cached,state) {
  const stamp = cached?.generatedAt || (cached?.ts ? new Date(cached.ts).toISOString() : null);
  const time = stamp ? stamp.slice(0,16).replace('T',' ') + 'Z' : 'UNKNOWN';
  if (state.state === 'CURRENT') return `${cached.text}\n\n// CURRENT · UPDATED ${time}`;
  if (state.state === 'AGING') return `${cached.text}\n\n// AGING · LAST UPDATED ${time}`;
  if (state.state === 'DELAYED') return `${cached.text}\n\n// UPDATE DELAYED · LAST VALID REPORT ${time}`;
  return cached.text;
}
export default async (req) => {
  let body = {};
  if (req.method !== 'GET') { try { body = await req.json(); } catch (_) {} }
  const url = new URL(req.url);
  const cocomId = normalizeCocom(body.cocomId || body.cocom || url.searchParams.get('cocom') || '');
  if (!cocomId) return new Response(JSON.stringify({error:'Invalid COCOM'}),{status:400,headers:{'Content-Type':'application/json'}});
  let cached = null;
  try { cached = await getStore('sitrep-cache').get(`sitrep-${cocomId}`,{type:'json'}); } catch (_) {}
  const state = freshness(cached?.ts);
  if (cached?.text && state.state !== 'EXPIRED') return json({text:annotatedText(cached,state),cached:true,stale:state.state!=='CURRENT',freshness:state.state,ageMinutes:state.ageMinutes,generatedAt:cached.generatedAt || (cached.ts ? new Date(cached.ts).toISOString() : null),mode:cached.mode || 'AI',provider:cached.provider || null});
  return json({text:feedFallback(cocomId,Array.isArray(body.feedItems)?body.feedItems:[]),cached:false,stale:true,freshness:'SOURCE_ONLY',ageMinutes:state.ageMinutes,generatedAt:new Date().toISOString(),mode:'SOURCE_ONLY'});
};
function json(obj){return new Response(JSON.stringify(obj),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});}
export const config={rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['domain','ip']}};
