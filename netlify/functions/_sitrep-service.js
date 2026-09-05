const { getStore } = require('@netlify/blobs');
const { generateText, DEFAULT_MODEL } = require('./_openai');

const COMMANDS = {
  EUCOM: 'U.S. European Command',
  CENTCOM: 'U.S. Central Command',
  INDOPACOM: 'U.S. Indo-Pacific Command',
  AFRICOM: 'U.S. Africa Command',
  SOUTHCOM: 'U.S. Southern Command',
  NORTHCOM: 'U.S. Northern Command',
};
const COCOMS = Object.keys(COMMANDS);
const STORE_NAME = 'sitrep-cache';
const CURRENT_MS = 6 * 60 * 60 * 1000;
const AGING_MS = 12 * 60 * 60 * 1000;
const EXPIRED_MS = 24 * 60 * 60 * 1000;

function displayName(id) {
  return id === 'INDOPACOM' ? 'PACOM' : id;
}

function normalizeCocom(value = '') {
  const id = String(value).toUpperCase().trim();
  if (id === 'PACOM') return 'INDOPACOM';
  return COCOMS.includes(id) ? id : null;
}

function ageState(ts) {
  if (!ts) return { state:'MISSING', ageMinutes:null };
  const ageMs = Math.max(0, Date.now() - Number(ts));
  const ageMinutes = Math.floor(ageMs / 60000);
  if (ageMs < CURRENT_MS) return { state:'CURRENT', ageMinutes };
  if (ageMs < AGING_MS) return { state:'AGING', ageMinutes };
  if (ageMs < EXPIRED_MS) return { state:'DELAYED', ageMinutes };
  return { state:'EXPIRED', ageMinutes };
}

function compactItem(item) {
  const title = String(item?.title || item?.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const summary = String(item?.desc || item?.description || item?.summary || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  const url = String(item?.link || item?.url || '').trim();
  const source = String(item?.source || item?.sourceName || item?.dname || item?.src || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const pubDate = item?.pubDate || item?.isoDate || item?.date || item?.published || null;
  return { title, summary, url, source, pubDate };
}

function usefulItems(items = []) {
  const seen = new Set();
  return items
    .map(compactItem)
    .filter(item => item.title)
    .filter(item => {
      const key = `${item.title}|${item.url}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 14);
}

async function fetchRSS(cocomId, siteUrl) {
  const response = await fetch(`${siteUrl}/.netlify/functions/rss?cocom=${encodeURIComponent(cocomId)}`, {
    headers: { 'User-Agent':'TOCMonkey-SITREPGenerator/2.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`RSS ${cocomId} HTTP ${response.status}`);
  const data = await response.json();
  return usefulItems(Array.isArray(data) ? data : []);
}

function sourceOnlyText(cocomId, items = [], generatedAt = new Date().toISOString()) {
  const label = displayName(cocomId);
  const list = usefulItems(items).slice(0, 6);
  const bullets = list.length
    ? list.map(item => `• ${item.title}${item.source ? ` — ${item.source}` : ''}${item.url ? `\n  ${item.url}` : ''}`).join('\n')
    : '• No fresh source items are currently available.';
  return `SITREP — ${label}\n\nSITUATION\nAI assessment is temporarily unavailable. TOC Monkey is showing current open-source reporting instead of presenting expired analysis as current.\n\nLATEST REPORTING\n${bullets}\n\nINDICATORS\nSource reporting remains live. No AI-derived trend assessment is being asserted in this fallback product.\n\nASSESSMENT\nAutomated assessment pending the next successful backend generation.\n\n// SOURCE-ONLY FALLBACK · ${generatedAt.slice(0,16).replace('T',' ')}Z`;
}

function buildPrompt(cocomId, items) {
  const commandName = COMMANDS[cocomId];
  const sourceText = usefulItems(items).slice(0, 12).map((item, i) => {
    return `${i+1}. ${item.source ? `[${item.source}] ` : ''}${item.title}${item.summary ? ` — ${item.summary}` : ''}${item.url ? ` | ${item.url}` : ''}`;
  }).join('\n');

  return `You are writing a concise open-source situational awareness SITREP for ${commandName} (${displayName(cocomId)}).\n\nUse ONLY the source material below for current-event claims. Do not invent events, capabilities, casualty figures, intent, or attribution. If evidence is thin, say so. Keep the tone analytical and non-sensational.\n\nSOURCE MATERIAL:\n${sourceText || '(No fresh source items available)'}\n\nWrite exactly these sections:\nSITUATION — 2-3 sentences on the overall AOR picture supported by the sources.\nKEY ACTIVITY — 3-5 bullets beginning with •, prioritizing consequential developments.\nINDICATORS — 2 sentences on observable trends or warning indicators; distinguish evidence from uncertainty.\nASSESSMENT — 1-2 sentence bottom line.\nSOURCES — include up to 5 source-title and URL lines for items actually used.\n\nDo not mention model names, API providers, billing, or internal system errors. Start with SITUATION.`;
}

async function readCached(cocomId) {
  const store = getStore(STORE_NAME);
  return await store.get(`sitrep-${cocomId}`, { type:'json' });
}

async function writeCached(cocomId, payload) {
  const store = getStore(STORE_NAME);
  await store.setJSON(`sitrep-${cocomId}`, payload);
  return payload;
}

async function generateCocom(cocomId, { siteUrl, force = false, source = 'scheduled' } = {}) {
  cocomId = normalizeCocom(cocomId);
  if (!cocomId) throw new Error('Invalid COCOM');
  const existing = await readCached(cocomId).catch(() => null);
  const freshness = ageState(existing?.ts);
  if (!force && freshness.state === 'CURRENT') {
    return { skipped:true, reason:'current', report:existing };
  }

  const resolvedSiteUrl = String(siteUrl || process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');
  let items = [];
  let rssError = null;
  try {
    items = await fetchRSS(cocomId, resolvedSiteUrl);
  } catch (error) {
    rssError = error.message;
  }

  const now = new Date();
  const base = {
    cocomId,
    displayName:displayName(cocomId),
    generatedAt:now.toISOString(),
    ts:now.getTime(),
    source,
    sourceItemCount:items.length,
    sources:items.slice(0, 8),
  };

  if (items.length) {
    try {
      const result = await generateText({
        prompt:buildPrompt(cocomId, items),
        model:process.env.OPENAI_SITREP_MODEL || DEFAULT_MODEL,
        maxOutputTokens:850,
        reasoningEffort:'low',
        retries:2,
      });
      const report = {
        ...base,
        text:result.text,
        status:'CURRENT',
        mode:'AI',
        provider:'openai',
        model:result.model,
        usage:result.usage || null,
      };
      await writeCached(cocomId, report);
      return { skipped:false, report };
    } catch (error) {
      const fallback = {
        ...base,
        text:sourceOnlyText(cocomId, items, now.toISOString()),
        status:'SOURCE_ONLY',
        mode:'SOURCE_ONLY',
        provider:'openai',
        model:process.env.OPENAI_SITREP_MODEL || DEFAULT_MODEL,
        generationError:String(error.message || error).slice(0,240),
      };
      await writeCached(cocomId, fallback);
      return { skipped:false, report:fallback, degraded:true };
    }
  }

  // If RSS is unavailable, do not overwrite a still-usable report. Preserve the
  // last known good product and report the failed generation to the caller.
  if (existing?.text && ageState(existing.ts).state !== 'EXPIRED') {
    return { skipped:true, reason:'rss-unavailable-preserved', report:existing, degraded:true, error:rssError };
  }

  const fallback = {
    ...base,
    text:sourceOnlyText(cocomId, [], now.toISOString()),
    status:'SOURCE_ONLY',
    mode:'SOURCE_ONLY',
    provider:'openai',
    model:process.env.OPENAI_SITREP_MODEL || DEFAULT_MODEL,
    generationError:rssError || 'No source items available',
  };
  await writeCached(cocomId, fallback);
  return { skipped:false, report:fallback, degraded:true };
}

async function generateAll(options = {}) {
  const results = [];
  for (const cocomId of COCOMS) {
    try {
      const result = await generateCocom(cocomId, options);
      results.push({ cocomId, ok:true, ...result });
    } catch (error) {
      results.push({ cocomId, ok:false, error:String(error.message || error).slice(0,240) });
    }
  }
  return results;
}

module.exports = {
  COMMANDS,
  COCOMS,
  STORE_NAME,
  CURRENT_MS,
  AGING_MS,
  EXPIRED_MS,
  normalizeCocom,
  displayName,
  ageState,
  usefulItems,
  sourceOnlyText,
  readCached,
  generateCocom,
  generateAll,
};
