// ─────────────────────────────────────────────────────────────────────────────
// OSINT Feed — live posts from tracked accounts
// Sources: Bluesky AT Protocol API + Nitter RSS fallback
// Cached 5 minutes. Accounts tagged by primary AOR for frontend filtering.
// ─────────────────────────────────────────────────────────────────────────────

let cache = null, cacheTime = 0;
const TTL = 5 * 60 * 1000;

// ── BLUESKY ACCOUNTS (most reliable — free AT Protocol API) ───────────────────
const BLUESKY_ACCOUNTS = [
  // EUCOM / Russia-Ukraine
  { bsky:"ralee85.bsky.social",          xHandle:"@RALee85",          dname:"Rob Lee",              verified:true,  aor:["EUCOM"] },
  { bsky:"jominiw.bsky.social",          xHandle:"@JominiW",          dname:"Jomini of the West",   verified:true,  aor:["EUCOM","CENTCOM","INDOPACOM"] },
  { bsky:"geoconf.bsky.social",          xHandle:"@GeoConfirmed",     dname:"GeoConfirmed",         verified:true,  aor:["EUCOM","CENTCOM","AFRICOM"] },
  { bsky:"conflictsinfo.bsky.social",    xHandle:"@Conflicts",        dname:"Conflicts",            verified:true,  aor:["AFRICOM","CENTCOM","SOUTHCOM","EUCOM"] },
  { bsky:"mickryan.bsky.social",         xHandle:"@WarintheFuture",   dname:"Mick Ryan",            verified:true,  aor:["EUCOM","INDOPACOM"] },
  // INDOPACOM
  { bsky:"anpanda.bsky.social",          xHandle:"@nktpnd",           dname:"Ankit Panda",          verified:true,  aor:["INDOPACOM"] },
  // CENTCOM / Middle East
  { bsky:"warmatters.bsky.social",       xHandle:"@WarMatters",       dname:"War on the Rocks",     verified:true,  aor:["CENTCOM","EUCOM","INDOPACOM","AFRICOM"] },
];

// ── NITTER / X ACCOUNTS ───────────────────────────────────────────────────────
const NITTER_INSTANCES = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.cz",
];

const X_ACCOUNTS = [
  // ── EUCOM ────────────────────────────────────────────────
  { handle:"IntelCrab",        dname:"Intel Crab",              verified:true,  aor:["EUCOM","CENTCOM","AFRICOM"] },
  { handle:"OSINTdefender",    dname:"OSINT Defender",          verified:true,  aor:["EUCOM","CENTCOM","INDOPACOM"] },
  { handle:"RALee85",          dname:"Rob Lee",                 verified:true,  aor:["EUCOM"] },
  { handle:"Tatarigami_UA",    dname:"Tatarigami",              verified:true,  aor:["EUCOM"] },
  { handle:"CalibreObscura",   dname:"Calibre Obscura",         verified:true,  aor:["EUCOM","CENTCOM"] },
  { handle:"WarMonitor",       dname:"War Monitor",             verified:false, aor:["EUCOM","CENTCOM","AFRICOM"] },
  { handle:"christogrozev",    dname:"Christo Grozev",          verified:true,  aor:["EUCOM"] },
  { handle:"IAPonomarenko",    dname:"Illia Ponomarenko",       verified:true,  aor:["EUCOM"] },
  { handle:"DaraMassicot",     dname:"Dara Massicot",           verified:true,  aor:["EUCOM"] },
  // ── CENTCOM / Middle East ────────────────────────────────
  { handle:"JominiW",          dname:"Jomini of the West",      verified:true,  aor:["EUCOM","CENTCOM","INDOPACOM"] },
  { handle:"MT_Anderson",      dname:"MT Anderson",             verified:false, aor:["CENTCOM","NORTHCOM"] },
  { handle:"ELINTNews",        dname:"ELINT News",              verified:false, aor:["CENTCOM","EUCOM","INDOPACOM"] },
  { handle:"MaziarMotamedi",   dname:"Maziar Motamedi",         verified:true,  aor:["CENTCOM"] },
  { handle:"IranIntl_En",      dname:"Iran International",      verified:true,  aor:["CENTCOM"] },
  { handle:"michaelkofman",    dname:"Michael Kofman",          verified:true,  aor:["EUCOM","CENTCOM"] },
  // ── INDOPACOM ────────────────────────────────────────────
  { handle:"AndrewSErickson",  dname:"Andrew Erickson",         verified:true,  aor:["INDOPACOM"] },
  { handle:"OKMastro",         dname:"Oriana Skylar Mastro",    verified:true,  aor:["INDOPACOM"] },
  { handle:"nktpnd",           dname:"Ankit Panda",             verified:true,  aor:["INDOPACOM"] },
  { handle:"IanEastAsianSec",  dname:"Ian Easton",              verified:true,  aor:["INDOPACOM"] },
  { handle:"deptofdefense",    dname:"Dept of Defense",         verified:true,  aor:["INDOPACOM","EUCOM","CENTCOM","NORTHCOM"] },
  // ── AFRICOM ──────────────────────────────────────────────
  { handle:"Africa_OSINTme",   dname:"Africa OSINT",            verified:false, aor:["AFRICOM"] },
  { handle:"SudanWarMonitor",  dname:"Sudan War Monitor",       verified:false, aor:["AFRICOM"] },
  { handle:"Conflicts",        dname:"Conflicts",               verified:false, aor:["AFRICOM","CENTCOM","SOUTHCOM"] },
  { handle:"CrisisGroupHorn",  dname:"Crisis Group Horn",       verified:true,  aor:["AFRICOM"] },
  // ── SOUTHCOM ─────────────────────────────────────────────
  { handle:"InSightCrime",     dname:"InSight Crime",           verified:true,  aor:["SOUTHCOM"] },
  { handle:"PatricioMarini",   dname:"Patricio Marini",         verified:false, aor:["SOUTHCOM"] },
  { handle:"VenezuelaOSINT",   dname:"Venezuela OSINT",         verified:false, aor:["SOUTHCOM"] },
  // ── NORTHCOM ─────────────────────────────────────────────
  { handle:"NoradNorthcom",    dname:"NORAD/NORTHCOM",          verified:true,  aor:["NORTHCOM"] },
  { handle:"ArcticToday",      dname:"Arctic Today",            verified:true,  aor:["NORTHCOM","EUCOM"] },
];

function parseAge(dateStr) {
  if (!dateStr) return "?";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 60)  return `${m}m`;
  if (h < 24)  return `${h}h`;
  return `${d}d`;
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
}

async function fetchBluesky(account) {
  const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${account.bsky}&limit=8`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Bluesky ${account.bsky}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.feed || []).slice(0, 5).map(item => ({
    src:      account.xHandle,
    handle:   account.xHandle.replace("@",""),
    dname:    account.dname,
    text:     item.post?.record?.text || "",
    time:     parseAge(item.post?.indexedAt),
    pubDate:  item.post?.indexedAt,
    likes:    item.post?.likeCount || 0,
    rts:      item.post?.repostCount || 0,
    replies:  item.post?.replyCount || 0,
    verified: account.verified,
    url:      `https://bsky.app/profile/${account.bsky}/post/${item.post?.uri?.split("/").pop()}`,
    source:   "bluesky",
    aor:      account.aor,
  }));
}

async function fetchNitter(account) {
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${account.handle}/rss`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "TOCMonkey/1.0" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = [];
      const rx = /<item>([\s\S]*?)<\/item>/gi;
      let m;
      while ((m = rx.exec(xml)) !== null && items.length < 5) {
        const block = m[1];
        const get = tag => {
          const r = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"))
                 || block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
          return r ? r[1].trim() : "";
        };
        const text    = stripHtml(get("title"));
        const pubDate = get("pubDate") || "";
        if (text && text.length > 10) {
          items.push({
            src:      `@${account.handle}`,
            handle:   account.handle,
            dname:    account.dname,
            text,
            time:     parseAge(pubDate),
            pubDate,
            likes:    0, rts: 0, replies: 0,
            verified: account.verified,
            url:      `https://x.com/${account.handle}`,
            source:   "nitter",
            aor:      account.aor,
          });
        }
      }
      if (items.length) return items;
    } catch (e) { /* try next */ }
  }
  return [];
}

exports.handler = async function() {
  if (cache && Date.now() - cacheTime < TTL) {
    return { statusCode:200, headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=300"}, body:JSON.stringify(cache) };
  }

  const posts = [];

  await Promise.allSettled(
    BLUESKY_ACCOUNTS.map(acc =>
      fetchBluesky(acc).then(items => posts.push(...items)).catch(() => {})
    )
  );

  for (const acc of X_ACCOUNTS) {
    try {
      const items = await fetchNitter(acc);
      posts.push(...items);
    } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }

  const seen = new Set();
  const deduped = posts.filter(p => {
    const key = p.text.slice(0, 60).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  cache = deduped;
  cacheTime = Date.now();

  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json", "Cache-Control":"public,max-age=300" },
    body: JSON.stringify(deduped),
  };
};
