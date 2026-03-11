// ─────────────────────────────────────────────────────────────────────────────
// Telegram Bot API — fetches recent messages from public OSINT channels
// Requires TELEGRAM_BOT_TOKEN in Netlify environment variables
// Bot must be added as a member of each channel to read messages
// Cache: 15 minutes
// ─────────────────────────────────────────────────────────────────────────────

// OSINT Telegram channels — bot must be a member of each
const CHANNELS = [

  // ── EUCOM / Ukraine / Russia ─────────────────────────────────────────────
  { username: "rybar",               name: "Rybar",               cocom: "EUCOM",      type: "mil-blogger" },
  { username: "ukrpravda_news",      name: "Ukrainska Pravda",    cocom: "EUCOM",      type: "news" },
  { username: "kyivindependent",     name: "Kyiv Independent",    cocom: "EUCOM",      type: "news" },
  { username: "wartranslated",       name: "War Translated",      cocom: "EUCOM",      type: "osint" },
  { username: "milchronicles",       name: "Military Chronicles", cocom: "EUCOM",      type: "osint" },
  { username: "UkraineWorld",        name: "Ukraine World",       cocom: "EUCOM",      type: "news" },
  { username: "IntelSlava",          name: "Intel Slava Z",       cocom: "EUCOM",      type: "mil-blogger" },
  { username: "mod_russia_en",       name: "Russian MoD EN",      cocom: "EUCOM",      type: "official" },
  { username: "PoliticsWarMaps",     name: "Politics War & Maps", cocom: "EUCOM",      type: "osint" },
  { username: "DeepStateUA",         name: "DeepStateUA",         cocom: "EUCOM",      type: "osint" },

  // ── CENTCOM / Middle East ────────────────────────────────────────────────
  { username: "Middle_East_Spectator", name: "ME Spectator",      cocom: "CENTCOM",    type: "news" },
  { username: "zoneofconflict",      name: "Zone of Conflict",    cocom: "CENTCOM",    type: "osint" },
  { username: "YemenWarMap",         name: "Yemen War Map",       cocom: "CENTCOM",    type: "osint" },
  { username: "IraqiSecurityNews",   name: "Iraqi Security News", cocom: "CENTCOM",    type: "news" },
  { username: "iranintl",            name: "Iran International",  cocom: "CENTCOM",    type: "news" },

  // ── INDOPACOM ─────────────────────────────────────────────────────────────
  { username: "IndoPacificNews",     name: "Indo-Pacific News",   cocom: "INDOPACOM",  type: "news" },
  { username: "ChinaObservers",      name: "China Observers",     cocom: "INDOPACOM",  type: "osint" },
  { username: "NorthKoreaNews",      name: "NK News",             cocom: "INDOPACOM",  type: "news" },

  // ── AFRICOM ───────────────────────────────────────────────────────────────
  { username: "AfricaIntelFeed",     name: "Africa Intel",        cocom: "AFRICOM",    type: "osint" },
  { username: "SahelWatch",          name: "Sahel Watch",         cocom: "AFRICOM",    type: "osint" },
  { username: "SudanUprising",       name: "Sudan Updates",       cocom: "AFRICOM",    type: "news" },

  // ── SOUTHCOM ──────────────────────────────────────────────────────────────
  { username: "LatAmSecurityWatch",  name: "LatAm Security",      cocom: "SOUTHCOM",   type: "osint" },
  { username: "NarcoNewsBot",        name: "Narco News",          cocom: "SOUTHCOM",   type: "news" },

  // ── NORTHCOM / Arctic ─────────────────────────────────────────────────────
  { username: "ArcticSecurityNews",  name: "Arctic Security",     cocom: "NORTHCOM",   type: "news" },

];

// In-memory cache
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_AGE_HOURS = 96;
const MAX_PER_CHANNEL = 5;

function parseAge(unixTs) {
  if (!unixTs) return null;
  const diffMs = Date.now() - (unixTs * 1000);
  const mins  = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days  = Math.floor(diffMs / 86400000);
  if (hours > MAX_AGE_HOURS) return null; // too old — drop it
  if (mins < 60)  return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function stripMarkdown(text) {
  return (text || "")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/__?([^_]+)__?/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, "")
    .trim();
}

async function fetchChannel(token, channel) {
  try {
    // getUpdates approach requires bot to be in channel
    // Use getChatHistory via getUpdates offset trick
    const url = `https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0`;
    // Better: use forwardMessages or channel posts via getChat
    // Most reliable for channels: use the channel_post update type

    // Actually for channels we use: get recent channel posts
    const histUrl = `https://api.telegram.org/bot${token}/getChatHistory`;

    // Telegram Bot API doesn't have getChatHistory for channels directly
    // We use getUpdates and filter channel_post, or use the channel's message endpoint
    // Best approach: fetch via https://api.telegram.org/bot{token}/getUpdates
    // filtered for channel_post from @channelname

    // For public channels, we can use the MTProto API or tdlib
    // But for simplicity with Bot API: bot must be admin, use forwardMessages

    // PRACTICAL approach: use the channel's public preview via t.me/s/
    const previewUrl = `https://t.me/s/${channel.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(previewUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TOCMonkey/1.0)" }
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const html = await res.text();

    // Parse message blocks from t.me/s/ preview HTML
    const messages = [];
    const msgRegex = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const timeRegex = /<time[^>]+datetime="([^"]+)"/i;
    const linkRegex = /<a[^>]+href="([^"]+t\.me\/[^"]+)"[^>]*>/i;

    // Get all message blocks
    const blockRegex = /<div class="tgme_widget_message_wrap[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi;
    const allBlocks = html.match(blockRegex) || [];

    for (const block of allBlocks.slice(-MAX_PER_CHANNEL * 2)) {
      // Extract text
      const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (!textMatch) continue;
      const rawText = textMatch[1]
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
      if (!rawText || rawText.length < 20) continue;

      // Extract datetime
      const timeMatch = block.match(/<time[^>]+datetime="([^"]+)"/i);
      const dt = timeMatch ? new Date(timeMatch[1]) : null;
      const unixTs = dt ? Math.floor(dt.getTime() / 1000) : null;
      const age = parseAge(unixTs);
      if (!age) continue; // too old

      // Extract message link
      const linkMatch = block.match(/href="(https:\/\/t\.me\/[^"]+\/\d+)"/i);
      const msgUrl = linkMatch ? linkMatch[1] : `https://t.me/${channel.username}`;

      messages.push({
        source:       channel.name,
        sourceHandle: channel.username.toUpperCase(),
        cocom:        channel.cocom,
        type:         channel.type,
        title:        rawText.slice(0, 280),
        url:          msgUrl,
        age,
        pubDate:      dt ? dt.toISOString() : "",
        isTelegram:   true,
      });

      if (messages.length >= MAX_PER_CHANNEL) break;
    }

    return messages;

  } catch(e) {
    return [];
  }
}

export default async (req) => {
  const TELEGRAM_TOKEN = Netlify.env.get('TELEGRAM_BOT_TOKEN');

  if (!TELEGRAM_TOKEN) {
    return new Response(JSON.stringify({
      error: "TELEGRAM_BOT_TOKEN not configured",
      items: []
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // Return cache if fresh
  if (cache && (Date.now() - cacheTime) < CACHE_TTL) {
    return new Response(JSON.stringify(cache), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=900" }
    });
  }

  // Parse optional COCOM filter
  const url = new URL(req.url);
  const filterCocom = url.searchParams.get("cocom")?.toUpperCase() || null;
  const selectedChannels = filterCocom
    ? CHANNELS.filter(c => c.cocom === filterCocom)
    : CHANNELS;

  // Fetch all channels concurrently in batches of 10
  const results = [];
  const batches = [];
  for (let i = 0; i < selectedChannels.length; i += 10) {
    batches.push(selectedChannels.slice(i, i + 10));
  }
  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(ch => fetchChannel(TELEGRAM_TOKEN, ch))
    );
    batchResults.forEach(items => results.push(...items));
  }

  // Sort by date, most recent first
  results.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  // Dedupe by content
  const seen = new Set();
  const deduped = results.filter(r => {
    const k = r.title.slice(0, 60).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  cache = deduped;
  cacheTime = Date.now();

  return new Response(JSON.stringify(deduped), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=900" }
  });
};
