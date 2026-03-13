// ─────────────────────────────────────────────────────────────────────────────
// RSS Feed Aggregator — 100+ sources, COCOM-tagged, 30min cache
// ─────────────────────────────────────────────────────────────────────────────

const FEEDS = [
  { name:"Small Wars Journal", handle:"SMALLWARS", cocom:"ALL", color:"amber", url:"https://smallwarsjournal.com/rss.xml" },

  // ── GLOBAL / MULTI-COCOM ────────────────────────────────────────────────
  { name:"Reuters World",           handle:"REUTERS",          cocom:"ALL",       color:"green",  url:"https://feeds.reuters.com/Reuters/worldNews" },
  { name:"AP World News",           handle:"AP",               cocom:"ALL",       color:"green",  url:"https://rsshub.app/apnews/topics/apf-intlnews" },
  { name:"BBC World",               handle:"BBC",              cocom:"ALL",       color:"green",  url:"http://feeds.bbci.co.uk/news/world/rss.xml" },
  { name:"Al Jazeera English",      handle:"ALJAZEERA",        cocom:"ALL",       color:"green",  url:"https://www.aljazeera.com/xml/rss/all.xml" },
  { name:"The Economist",           handle:"ECONOMIST",        cocom:"ALL",       color:"amber",  url:"https://www.economist.com/international/rss.xml" },
  { name:"Foreign Policy",          handle:"FOREIGNPOLICY",    cocom:"ALL",       color:"amber",  url:"https://foreignpolicy.com/feed/" },
  { name:"Foreign Affairs",         handle:"FOREIGNAFFAIRS",   cocom:"ALL",       color:"amber",  url:"https://www.foreignaffairs.com/rss.xml" },
  { name:"Defense One",             handle:"DEFENSEONE",       cocom:"ALL",       color:"amber",  url:"https://www.defenseone.com/rss/all/" },
  { name:"Breaking Defense",        handle:"BREAKINGDEFENSE",  cocom:"ALL",       color:"amber",  url:"https://breakingdefense.com/feed/" },
  { name:"Military Times",          handle:"MILITARYTIMES",    cocom:"ALL",       color:"amber",  url:"https://www.militarytimes.com/arc/outboundfeeds/rss/" },
  { name:"The Intercept",           handle:"THEINTERCEPT",     cocom:"ALL",       color:"amber",  url:"https://theintercept.com/feed/?rss" },
  { name:"ProPublica",              handle:"PROPUBLICA",       cocom:"ALL",       color:"amber",  url:"https://www.propublica.org/feeds/propublica/main" },
  { name:"r/CredibleDefense",       handle:"CREDIBLEDEFENSE",  cocom:"ALL",       color:"mute",   url:"https://www.reddit.com/r/CredibleDefense/.rss" },
  { name:"r/geopolitics",           handle:"GEOPOLITICS_R",    cocom:"ALL",       color:"mute",   url:"https://www.reddit.com/r/geopolitics/.rss" },
  { name:"r/worldnews",             handle:"WORLDNEWS_R",      cocom:"ALL",       color:"mute",   url:"https://www.reddit.com/r/worldnews/.rss" },

  // ── ANALYSIS / THINK TANKS ──────────────────────────────────────────────
  { name:"War on the Rocks",        handle:"WARONTHEROCKS",    cocom:"ALL",       color:"amber",  url:"https://warontherocks.com/feed/" },
  { name:"ISW",                     handle:"UNDERSTANDINGWAR", cocom:"EUCOM",     color:"amber",  url:"https://www.understandingwar.org/rss.xml" },
  { name:"Modern War Institute",    handle:"MWI",              cocom:"ALL",       color:"amber",  url:"https://mwi.westpoint.edu/feed/" },
  { name:"Irregular Warfare Init.", handle:"IWI",              cocom:"ALL",       color:"amber",  url:"https://irregularwarfare.org/feed/" },
  { name:"RAND Defense",            handle:"RAND",             cocom:"ALL",       color:"amber",  url:"https://www.rand.org/topics/military-strategy.xml" },
  { name:"CSIS",                    handle:"CSIS",             cocom:"ALL",       color:"amber",  url:"https://www.csis.org/rss.xml" },
  { name:"Lawfare",                 handle:"LAWFARE",          cocom:"ALL",       color:"amber",  url:"https://www.lawfaremedia.org/feed" },
  { name:"Carnegie Endowment",      handle:"CARNEGIE",         cocom:"ALL",       color:"amber",  url:"https://carnegieendowment.org/rss/solr/articles" },
  { name:"Bellingcat",              handle:"BELLINGCAT",       cocom:"ALL",       color:"amber",  url:"https://www.bellingcat.com/feed/" },
  { name:"ACLED Blog",              handle:"ACLED",            cocom:"ALL",       color:"amber",  url:"https://acleddata.com/feed/" },
  { name:"Crisis Group",            handle:"CRISISGROUP",      cocom:"ALL",       color:"amber",  url:"https://www.crisisgroup.org/rss.xml" },
  { name:"Stimson Center",          handle:"STIMSON",          cocom:"ALL",       color:"amber",  url:"https://www.stimson.org/feed/" },
  { name:"The Green Notebook",      handle:"GREENNOTEBOOK",    cocom:"ALL",       color:"amber",  url:"https://thegreennotebook.com/feed/" },

  // ── EUCOM — Europe / Russia / Ukraine ───────────────────────────────────
  { name:"Kyiv Independent",        handle:"KYIVINDEPENDENT",  cocom:"EUCOM",     color:"green",  url:"https://kyivindependent.com/feed/" },
  { name:"Ukrainska Pravda EN",     handle:"UKRPRAVDA",        cocom:"EUCOM",     color:"green",  url:"https://www.pravda.com.ua/eng/rss/" },
  { name:"Meduza (Russia EN)",      handle:"MEDUZA",           cocom:"EUCOM",     color:"green",  url:"https://meduza.io/rss/en/all" },
  { name:"The Moscow Times",        handle:"MOSCOWTIMES",      cocom:"EUCOM",     color:"green",  url:"https://www.themoscowtimes.com/rss/news" },
  { name:"Politico Europe",         handle:"POLITICO_EU",      cocom:"EUCOM",     color:"green",  url:"https://www.politico.eu/feed/" },
  { name:"Deutsche Welle",          handle:"DW",               cocom:"EUCOM",     color:"green",  url:"https://rss.dw.com/rdf/rss-en-all" },
  { name:"RFE/RL",                  handle:"RFERL",            cocom:"EUCOM",     color:"green",  url:"https://www.rferl.org/api/zpqousuiur" },
  { name:"EUobserver",              handle:"EUOBSERVER",       cocom:"EUCOM",     color:"green",  url:"https://euobserver.com/rss.xml" },
  { name:"RUSI",                    handle:"RUSI",             cocom:"EUCOM",     color:"amber",  url:"https://rusi.org/rss.xml" },
  { name:"IISS",                    handle:"IISS",             cocom:"EUCOM",     color:"amber",  url:"https://www.iiss.org/rss" },
  { name:"r/ukraine",               handle:"UKRAINE_R",        cocom:"EUCOM",     color:"mute",   url:"https://www.reddit.com/r/ukraine/.rss" },
  { name:"r/UkrainianConflict",     handle:"UKRCONFLICT_R",    cocom:"EUCOM",     color:"mute",   url:"https://www.reddit.com/r/UkrainianConflict/.rss" },

  // ── CENTCOM — Middle East / Central Asia ─────────────────────────────────
  { name:"Times of Israel",         handle:"TIMESOFISRAEL",    cocom:"CENTCOM",   color:"green",  url:"https://www.timesofisrael.com/feed/" },
  { name:"Haaretz",                 handle:"HAARETZ",          cocom:"CENTCOM",   color:"green",  url:"https://www.haaretz.com/cmlink/1.628752" },
  { name:"Jerusalem Post",          handle:"JPOST",            cocom:"CENTCOM",   color:"green",  url:"https://www.jpost.com/rss/rssfeedsfrontpage.aspx" },
  { name:"Iran International",      handle:"IRANINTL",         cocom:"CENTCOM",   color:"green",  url:"https://www.iranintl.com/en/rss" },
  { name:"Al-Monitor",              handle:"ALMONITOR",        cocom:"CENTCOM",   color:"green",  url:"https://www.al-monitor.com/rss" },
  { name:"Middle East Eye",         handle:"MEE",              cocom:"CENTCOM",   color:"green",  url:"https://www.middleeasteye.net/rss" },
  { name:"Arab News",               handle:"ARABNEWS",         cocom:"CENTCOM",   color:"green",  url:"https://www.arabnews.com/rss.xml" },
  { name:"Daily Sabah (Turkey)",    handle:"DAILYSABAH",       cocom:"CENTCOM",   color:"green",  url:"https://www.dailysabah.com/rssFeed/push_notifications" },
  { name:"Jordan Times",            handle:"JORDANTIMES",      cocom:"CENTCOM",   color:"green",  url:"https://jordantimes.com/rss/feed" },
  { name:"RFE/RL MENA",             handle:"RFERL_MENA",       cocom:"CENTCOM",   color:"green",  url:"https://www.rferl.org/api/zrqousuiur" },
  { name:"Washington Institute",    handle:"WINEP",            cocom:"CENTCOM",   color:"amber",  url:"https://www.washingtoninstitute.org/rss.xml" },
  { name:"r/IsraelPalestine",       handle:"ISRAELPAL_R",      cocom:"CENTCOM",   color:"mute",   url:"https://www.reddit.com/r/IsraelPalestine/.rss" },
  { name:"r/iran",                  handle:"IRAN_R",           cocom:"CENTCOM",   color:"mute",   url:"https://www.reddit.com/r/iran/.rss" },
  { name:"r/Yemen",                 handle:"YEMEN_R",          cocom:"CENTCOM",   color:"mute",   url:"https://www.reddit.com/r/Yemen/.rss" },

  // ── INDOPACOM — Indo-Pacific ──────────────────────────────────────────────
  { name:"South China Morning Post",handle:"SCMP",             cocom:"INDOPACOM", color:"green",  url:"https://www.scmp.com/rss/91/feed" },
  { name:"Nikkei Asia",             handle:"NIKKEI",           cocom:"INDOPACOM", color:"green",  url:"https://asia.nikkei.com/rss/feed/nar" },
  { name:"The Diplomat",            handle:"THEDIPLOMAT",      cocom:"INDOPACOM", color:"green",  url:"https://thediplomat.com/feed/" },
  { name:"Asia Times",              handle:"ASIATIMES",        cocom:"INDOPACOM", color:"green",  url:"https://asiatimes.com/feed/" },
  { name:"Korea Herald",            handle:"KOREAHERALD",      cocom:"INDOPACOM", color:"green",  url:"http://www.koreaherald.com/rss/020100000000.xml" },
  { name:"Yonhap News",             handle:"YONHAP",           cocom:"INDOPACOM", color:"green",  url:"https://en.yna.co.kr/RSS/news.xml" },
  { name:"Taiwan News",             handle:"TAIWANNEWS",       cocom:"INDOPACOM", color:"green",  url:"https://www.taiwannews.com.tw/rss" },
  { name:"Straits Times",           handle:"STRAITSTIMES",     cocom:"INDOPACOM", color:"green",  url:"https://www.straitstimes.com/news/world/rss.xml" },
  { name:"ABC Australia",           handle:"ABCAUSTRALIA",     cocom:"INDOPACOM", color:"green",  url:"https://www.abc.net.au/news/feed/51120/rss.xml" },
  { name:"RNZ Pacific",             handle:"RNZPACIFIC",       cocom:"INDOPACOM", color:"green",  url:"https://www.rnz.co.nz/rss/pacific.xml" },
  { name:"Philippine Daily Inq.",   handle:"INQUIRER",         cocom:"INDOPACOM", color:"green",  url:"https://www.inquirer.net/fullfeed" },
  { name:"Japan Times",              handle:"JAPANTIMES",       cocom:"INDOPACOM", color:"green",  url:"https://www.japantimes.co.jp/feed/" },
  { name:"Hindustan Times",         handle:"HTIMES",           cocom:"INDOPACOM", color:"green",  url:"https://www.hindustantimes.com/feeds/rss/world/rssfeed.xml" },
  { name:"Jakarta Post",            handle:"JAKARTAPOST",      cocom:"INDOPACOM", color:"green",  url:"https://www.thejakartapost.com/feed" },
  { name:"Channel News Asia",       handle:"CNA",              cocom:"INDOPACOM", color:"green",  url:"https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml" },
  { name:"VOA Asia",                handle:"VOA_ASIA",         cocom:"INDOPACOM", color:"green",  url:"https://www.voanews.com/api/Zpomqgogq?_format=rss" },
  { name:"ASPI Strategist",         handle:"ASPI",             cocom:"INDOPACOM", color:"amber",  url:"https://www.aspistrategist.org.au/feed/" },
  { name:"38 North (DPRK)",         handle:"38NORTH",          cocom:"INDOPACOM", color:"amber",  url:"https://www.38north.org/feed/" },
  { name:"AMTI (S. China Sea)",     handle:"AMTI",             cocom:"INDOPACOM", color:"amber",  url:"https://amti.csis.org/feed/" },
  { name:"r/Sino",                  handle:"SINO_R",           cocom:"INDOPACOM", color:"mute",   url:"https://www.reddit.com/r/Sino/.rss" },
  { name:"r/NorthKoreaNews",        handle:"DPRK_R",           cocom:"INDOPACOM", color:"mute",   url:"https://www.reddit.com/r/NorthKoreaNews/.rss" },
  { name:"r/taiwan",                handle:"TAIWAN_R",         cocom:"INDOPACOM", color:"mute",   url:"https://www.reddit.com/r/taiwan/.rss" },

  // ── AFRICOM — Africa ──────────────────────────────────────────────────────
  { name:"BBC Africa",              handle:"BBCAFRICA",        cocom:"AFRICOM",   color:"green",  url:"http://feeds.bbci.co.uk/news/world/africa/rss.xml" },
  { name:"Al Jazeera Africa",       handle:"AJ_AFRICA",        cocom:"AFRICOM",   color:"green",  url:"https://www.aljazeera.com/xml/rss/africa.xml" },
  { name:"The East African",        handle:"EASTAFRICAN",      cocom:"AFRICOM",   color:"green",  url:"https://www.theeastafrican.co.ke/feed" },
  { name:"Daily Nation (Kenya)",    handle:"DAILYNATION",      cocom:"AFRICOM",   color:"green",  url:"https://nation.africa/kenya/rss.xml" },
  { name:"The Guardian Nigeria",    handle:"GUARDIANNIG",      cocom:"AFRICOM",   color:"green",  url:"https://guardian.ng/feed/" },
  { name:"AllAfrica",               handle:"ALLAFRICA",        cocom:"AFRICOM",   color:"green",  url:"https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf" },
  { name:"Africa Report",           handle:"AFRICAREPORT",     cocom:"AFRICOM",   color:"green",  url:"https://www.theafricareport.com/feed/" },
  { name:"Jeune Afrique",           handle:"JEUNEAFRIQUE",     cocom:"AFRICOM",   color:"green",  url:"https://www.jeuneafrique.com/feed/" },
  { name:"RFI Africa EN",           handle:"RFI_AFRICA",       cocom:"AFRICOM",   color:"green",  url:"https://www.rfi.fr/en/rss" },
  { name:"Sudan Tribune",           handle:"SUDANTRIBUNE",     cocom:"AFRICOM",   color:"green",  url:"https://sudantribune.com/feed" },
  { name:"r/africa",                handle:"AFRICA_R",         cocom:"AFRICOM",   color:"mute",   url:"https://www.reddit.com/r/africa/.rss" },
  { name:"r/Sudan",                 handle:"SUDAN_R",          cocom:"AFRICOM",   color:"mute",   url:"https://www.reddit.com/r/Sudan/.rss" },

  // ── SOUTHCOM — Latin America / Caribbean ─────────────────────────────────
  { name:"InSight Crime",           handle:"INSIGHTCRIME",     cocom:"SOUTHCOM",  color:"green",  url:"https://insightcrime.org/feed/" },
  { name:"Merco Press",             handle:"MERCOPRESS",       cocom:"SOUTHCOM",  color:"green",  url:"https://en.mercopress.com/rss" },
  { name:"El País English",         handle:"ELPAIS_EN",        cocom:"SOUTHCOM",  color:"green",  url:"https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada" },
  { name:"Brazil Reports",          handle:"BRAZILREPORTS",    cocom:"SOUTHCOM",  color:"green",  url:"https://brazilreports.com/feed/" },
  { name:"Colombia Reports",        handle:"COLOMBIAREPORTS",  cocom:"SOUTHCOM",  color:"green",  url:"https://colombiareports.com/feed/" },
  { name:"Haiti Libre",             handle:"HAITILIBRE",       cocom:"SOUTHCOM",  color:"green",  url:"https://www.haitilibre.com/en/rss-haiti.xml" },
  { name:"NACLA (LatAm Analysis)",  handle:"NACLA",            cocom:"SOUTHCOM",  color:"amber",  url:"https://nacla.org/rss.xml" },
  { name:"r/latinamerica",          handle:"LATAM_R",          cocom:"SOUTHCOM",  color:"mute",   url:"https://www.reddit.com/r/latinamerica/.rss" },
  { name:"r/mexico",                handle:"MEXICO_R",         cocom:"SOUTHCOM",  color:"mute",   url:"https://www.reddit.com/r/mexico/.rss" },
  { name:"r/vzla",                  handle:"VZLA_R",           cocom:"SOUTHCOM",  color:"mute",   url:"https://www.reddit.com/r/vzla/.rss" },

  // ── NORTHCOM — North America / Arctic / Domestic US ─────────────────────
  { name:"NPR World",               handle:"NPR",              cocom:"NORTHCOM",  color:"green",  url:"https://feeds.npr.org/1004/rss.xml" },
  { name:"PBS NewsHour",            handle:"PBSNEWSHOUR",      cocom:"NORTHCOM",  color:"green",  url:"https://www.pbs.org/newshour/feeds/rss/nation" },
  { name:"The Hill — National Sec.",handle:"THEHILL",          cocom:"NORTHCOM",  color:"green",  url:"https://thehill.com/rss/syndicator/19109/feed/" },
  { name:"DOD News",                handle:"DODnews",          cocom:"NORTHCOM",  color:"amber",  url:"https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10" },
  { name:"Homeland Security News",  handle:"HSTODAY",          cocom:"NORTHCOM",  color:"amber",  url:"https://www.hstoday.us/feed/" },
  { name:"Just Security",           handle:"JUSTSECURITY",     cocom:"NORTHCOM",  color:"amber",  url:"https://www.justsecurity.org/feed/" },
  { name:"Mexico News Daily",       handle:"MEXICONEWS",       cocom:"NORTHCOM",  color:"green",  url:"https://mexiconewsdaily.com/feed/" },
  { name:"InSight Crime",           handle:"INSIGHTCRIME_N",   cocom:"NORTHCOM",  color:"green",  url:"https://insightcrime.org/feed/" },
  { name:"CBC News",                handle:"CBC",              cocom:"NORTHCOM",  color:"green",  url:"https://www.cbc.ca/cmlink/rss-world" },
  { name:"Globe and Mail",          handle:"GLOBEMAIL",        cocom:"NORTHCOM",  color:"green",  url:"https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/" },
  { name:"Arctic Today",            handle:"ARCTICTODAY",      cocom:"NORTHCOM",  color:"green",  url:"https://www.arctictoday.com/feed/" },
  { name:"High North News",         handle:"HIGHNORTHNEWS",    cocom:"NORTHCOM",  color:"green",  url:"https://www.highnorthnews.com/en/rss.xml" },
  { name:"r/canada",                handle:"CANADA_R",         cocom:"NORTHCOM",  color:"mute",   url:"https://www.reddit.com/r/canada/.rss" },
  { name:"r/USMilitary",            handle:"USMIL_R",          cocom:"NORTHCOM",  color:"mute",   url:"https://www.reddit.com/r/USMilitary/.rss" },

];

// Per-COCOM in-memory cache (survives warm function invocations)
const cache = {};
const cacheTime = {};
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
    const pubDate = get("pubDate") || get("dc:date") || get("published") || "";
    const desc    = stripHtml(get("description") || get("summary")).slice(0, 200);

    if (title && link) {
      items.push({
        source:       feed.name,
        sourceHandle: feed.handle,
        cocom:        feed.cocom,
        color:        feed.color || "green",
        title,
        url:          link,
        desc,
        age:          parseAge(pubDate),
        pubDate,
      });
    }
  }
  return items.slice(0, 5); // max 5 per feed
}

async function fetchFeed(feed) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "TOCMonkey/1.0 RSS Reader" }
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const xml = await res.text();
    return extractItems(xml, feed);
  } catch(e) {
    return [];
  }
}

export default async (req) => {
  // Parse optional COCOM filter from query string
  const url = new URL(req.url);
  const filterCocom = url.searchParams.get("cocom")?.toUpperCase() || "ALL";
  const cacheKey = filterCocom;

  // Return per-COCOM cached result if fresh
  if (cache[cacheKey] && (Date.now() - (cacheTime[cacheKey] || 0)) < CACHE_TTL) {
    return new Response(JSON.stringify(cache[cacheKey]), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" }
    });
  }

  // Select feeds: ALL feeds + COCOM-specific feeds matching filter
  const selectedFeeds = filterCocom === "ALL"
    ? FEEDS
    : FEEDS.filter(f => f.cocom === "ALL" || f.cocom === filterCocom);

  // Fetch all feeds concurrently, cap at 40 parallel to avoid timeouts
  const results = [];
  const chunks = [];
  for (let i = 0; i < selectedFeeds.length; i += 40) {
    chunks.push(selectedFeeds.slice(i, i + 40));
  }
  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(fetchFeed));
    chunkResults.forEach(items => results.push(...items));
  }

  // Sort by pubDate descending (most recent first)
  results.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  // Dedupe by title
  const seen = new Set();
  const deduped = results.filter(r => {
    const k = r.title.slice(0, 60).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  cache[cacheKey] = deduped;
  cacheTime[cacheKey] = Date.now();

  return new Response(JSON.stringify(deduped), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" }
  });
};
