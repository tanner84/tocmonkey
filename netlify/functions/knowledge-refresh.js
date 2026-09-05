const { getStore } = require('@netlify/blobs');

const COMMANDS = {
  EUCOM: require('../../enhancements/knowledge/EUCOM.json'),
  CENTCOM: require('../../enhancements/knowledge/CENTCOM.json'),
  INDOPACOM: require('../../enhancements/knowledge/INDOPACOM.json'),
  AFRICOM: require('../../enhancements/knowledge/AFRICOM.json'),
  SOUTHCOM: require('../../enhancements/knowledge/SOUTHCOM.json'),
  NORTHCOM: require('../../enhancements/knowledge/NORTHCOM.json')
};

const MAX_SIGNALS_PER_ACTOR = 5;
const SIGNAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesKeyword(text, keyword) {
  const k = normalize(keyword);
  if (!k) return false;
  if (/^[a-z0-9]{2,5}$/.test(k)) {
    return new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?=\\s|$)`, 'i').test(text);
  }
  return text.includes(k);
}

function itemDate(item) {
  const raw = item.pubDate || item.isoDate || item.date || item.published || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function itemCommandMatches(item, commandId) {
  const c = String(item.cocom || item.aor || 'ALL').toUpperCase();
  return !c || c === 'ALL' || c === commandId || (commandId === 'INDOPACOM' && c === 'PACOM');
}

function compactSignal(item) {
  const title = String(item.title || item.text || '').trim().slice(0, 240);
  const summary = String(item.desc || item.description || item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  const url = String(item.link || item.url || '').trim();
  const source = String(item.source || item.sourceName || item.name || item.handle || item.sourceHandle || '').trim().slice(0, 80);
  return {
    title,
    summary,
    url,
    source,
    pubDate: item.pubDate || item.isoDate || item.date || item.published || '',
    cocom: item.cocom || item.aor || 'ALL'
  };
}

async function fetchRss() {
  const base = (process.env.DEPLOY_PRIME_URL || process.env.URL || 'https://tocmonkey.com').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${base}/.netlify/functions/rss`, {
      headers: { 'User-Agent': 'TOCMonkey-KnowledgeRefresh/1.0' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`RSS endpoint returned ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = async function() {
  const store = getStore('cocom-knowledge-runtime');

  try {
    const existing = await store.get('latest', { type: 'json' });
    const age = existing?.generatedAt ? Date.now() - Date.parse(existing.generatedAt) : Infinity;
    if (age < MIN_REFRESH_INTERVAL_MS) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, generatedAt: existing.generatedAt }) };
    }
  } catch (_) {}

  const items = await fetchRss();
  const now = Date.now();
  const recent = items.filter(item => {
    const ts = itemDate(item);
    return !ts || now - ts <= SIGNAL_MAX_AGE_MS;
  });

  const actors = {};
  let matchedSignals = 0;

  for (const [commandId, command] of Object.entries(COMMANDS)) {
    const commandItems = recent.filter(item => itemCommandMatches(item, commandId));
    for (const actor of command.actors || []) {
      const keywords = [actor.name, ...(actor.keywords || [])].filter(Boolean);
      const matches = commandItems
        .map(item => ({ item, text: normalize(`${item.title || item.text || ''} ${item.desc || item.description || item.summary || ''}`) }))
        .filter(({ text }) => keywords.some(keyword => matchesKeyword(text, keyword)))
        .sort((a, b) => itemDate(b.item) - itemDate(a.item))
        .slice(0, MAX_SIGNALS_PER_ACTOR)
        .map(({ item }) => compactSignal(item))
        .filter(signal => signal.title && signal.url);

      if (matches.length) {
        actors[`${commandId}:${actor.id}`] = matches;
        matchedSignals += matches.length;
      }
    }
  }

  const runtime = {
    generatedAt: new Date().toISOString(),
    source: 'TOC Monkey RSS aggregator',
    sourceItemCount: items.length,
    recentItemCount: recent.length,
    matchedSignals,
    actors
  };

  await store.setJSON('latest', runtime);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      generatedAt: runtime.generatedAt,
      sourceItemCount: runtime.sourceItemCount,
      recentItemCount: runtime.recentItemCount,
      matchedSignals: runtime.matchedSignals,
      actorCount: Object.keys(runtime.actors).length
    })
  };
};
