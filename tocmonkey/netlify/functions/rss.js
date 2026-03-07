// ─────────────────────────────────────────────────────────────────────────────
// RSS Feed Aggregator — fetches all configured sources and returns unified JSON
// Cached for 30 minutes to avoid hammering feeds
// ─────────────────────────────────────────────────────────────────────────────

const FEEDS = [
  {
    name:   "War on the Rocks",
    handle: "WARONTHEROCKS",
    url:    "https://warontherocks.com/feed/",
    color:  "amber",
  },
  {
    name:   "ISW",
    handle: "UNDERSTANDINGWAR",
    url:    "https://www.understandingwar.org/rss.xml",
    color:  "amber",
  },
  {
    name:   "Modern War Institute",
    handle: "MWI WESTPOINT",
    url:    "https://mwi.westpoint.edu/feed/",
    color:  "amber",
  },
  {
    name:   "Irregular Warfare Initiative",
    handle: "IRREGULARWARFARE",
    url:    "https://irregularwarfare.org/feed/",
    color:  "amber",
  },
  {
    name:   "The Green Notebook",
    handle: "GREENNOTEBOOK",
    url:    "https://thegreennotebook.com/feed/",
    color:  "amber",
  },
];

// Simple in-memory cache (survives warm function invocations)
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function parseAge(dateStr) {
  if (!dateStr) return "?";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  60) return `${mins}m`;
  if (hours <  24) return `${hours}h`;
  return `${days}d`;
}

function stripHtml(str) {
  return (str || "").replace(/<[^>]*>/g, "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}

function extractItems(xml, feed) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : "";
    };
    const title   = stripHtml(get("title"));
    const link    = get("link").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim()
                 || block.match(/<link>([^<]+)<\/link>/i)?.[1] || "";
    const pubDate = get("pubDate") || get("dc:date") || "";
    const desc    = stripHtml(get("description")).slice(0, 200);

    if (title && link) {
      items.push({
        source:       feed.name,
        sourceHandle: feed.handle,
        title,
        url:   link,
        age:   parseAge(pubDate),
        desc,
        pubDate,
      });
    }
  }
  return items;
}

exports.handler = async function(event, context) {
  // Return cache if fresh
  if (cache && (Date.now() - cacheTime) < CACHE_TTL) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" },
      body: JSON.stringify(cache),
    };
  }

  const results = [];

  await Promise.allSettled(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "TOCMonkey/1.0 RSS Reader" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const items = extractItems(xml, feed);
        results.push(...items.slice(0, 8)); // max 8 per source
      } catch (err) {
        console.error(`Feed error [${feed.name}]:`, err.message);
      }
    })
  );

  // Sort by recency (most recent first), fallback to order
  results.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  cache = results;
  cacheTime = Date.now();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" },
    body: JSON.stringify(results),
  };
};
