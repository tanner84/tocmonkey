// ─────────────────────────────────────────────────────────────────────────────
// ACLED Conflict Zones — pulls recent events and scores intensity per zone
// Requires: ACLED_EMAIL + ACLED_KEY env vars (free at acleddata.com)
// Cached 6 hours — ACLED updates weekly, no need to hammer
// ─────────────────────────────────────────────────────────────────────────────

let cache = null, cacheTime = 0;
const TTL = 6 * 60 * 60 * 1000; // 6 hours

// Zone definitions — bounding boxes for ACLED queries
// Each zone has a lat/lng center + search radius, and an id matching the frontend
const ZONES = [
  // EUCOM
  { id:1,  name:"Ukraine — Donetsk Front",    lat:48.1, lng:37.8, r:1.5,  cocom:"EUCOM"     },
  { id:2,  name:"Ukraine — Zaporizhzhia",     lat:47.5, lng:35.4, r:1.5,  cocom:"EUCOM"     },
  { id:3,  name:"Black Sea",                  lat:43.5, lng:32.0, r:3.0,  cocom:"EUCOM"     },
  { id:4,  name:"Kaliningrad",                lat:54.7, lng:20.5, r:1.0,  cocom:"EUCOM"     },
  // CENTCOM
  { id:10, name:"Red Sea / Bab-el-Mandeb",    lat:14.5, lng:42.5, r:4.0,  cocom:"CENTCOM"   },
  { id:11, name:"Gaza Strip",                 lat:31.4, lng:34.4, r:0.5,  cocom:"CENTCOM"   },
  { id:12, name:"Yemen",                      lat:15.5, lng:44.2, r:4.0,  cocom:"CENTCOM"   },
  { id:13, name:"Syria (NE)",                 lat:36.8, lng:40.5, r:2.0,  cocom:"CENTCOM"   },
  { id:14, name:"Iraq",                       lat:33.3, lng:44.4, r:2.0,  cocom:"CENTCOM"   },
  // AFRICOM
  { id:30, name:"Sudan — El Fasher",          lat:13.6, lng:25.3, r:2.5,  cocom:"AFRICOM"   },
  { id:31, name:"Sahel — Mali/Burkina/Niger", lat:16.0, lng:1.0,  r:6.0,  cocom:"AFRICOM"   },
  { id:32, name:"Somalia / HOA",              lat:5.5,  lng:45.3, r:3.0,  cocom:"AFRICOM"   },
  { id:33, name:"Libya",                      lat:27.0, lng:18.0, r:4.0,  cocom:"AFRICOM"   },
  // SOUTHCOM
  { id:40, name:"Haiti",                      lat:18.9, lng:-72.3,r:0.8,  cocom:"SOUTHCOM"  },
  { id:41, name:"Venezuela",                  lat:8.0,  lng:-66.0,r:3.0,  cocom:"SOUTHCOM"  },
];

// Score event count → intensity label
function scoreIntensity(count30days, fatalCount) {
  // Weighted: fatalities count more than events
  const score = count30days + (fatalCount * 0.5);
  if (score > 50)  return "HIGH";
  if (score > 10)  return "MED";
  return "LOW";
}

// Get OAuth Bearer token
let oauthToken = null, oauthExpiry = 0;
async function getOAuthToken(email, password) {
  if (oauthToken && Date.now() < oauthExpiry) return oauthToken;
  const body = new URLSearchParams({ username:email, password, grant_type:"password", client_id:"acled" });
  const res = await fetch("https://acleddata.com/oauth/token", {
    method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body: body.toString(), signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ACLED OAuth failed: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("ACLED OAuth: no access_token");
  oauthToken  = json.access_token;
  oauthExpiry = Date.now() + (json.expires_in - 300) * 1000;
  return oauthToken;
}

// ACLED API query — new endpoint + Bearer auth
async function fetchZoneEvents(zone, token) {
  const since = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
  const today = new Date().toISOString().slice(0,10);
  const params = new URLSearchParams({
    event_date:`${since}|${today}`, event_date_where:"BETWEEN",
    latitude:`${(zone.lat-zone.r).toFixed(2)}|${(zone.lat+zone.r).toFixed(2)}`, latitude_where:"BETWEEN",
    longitude:`${(zone.lng-zone.r).toFixed(2)}|${(zone.lng+zone.r).toFixed(2)}`, longitude_where:"BETWEEN",
    fields:"event_id_cnty|event_date|event_type|fatalities|latitude|longitude|location",
    limit:"500", page:"1", _format:"json",
  });
  const res = await fetch(`https://acleddata.com/api/acled/read?${params}`, {
    headers:{"Authorization":`Bearer ${token}`,"Accept":"application/json"},
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ACLED HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data || json.results || []);
}


exports.handler = async function() {
  if (cache && Date.now() - cacheTime < TTL) {
    return { statusCode:200, headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=21600"}, body:JSON.stringify(cache) };
  }

  const email = process.env.ACLED_EMAIL;
  const key   = process.env.ACLED_KEY; // your ACLED account password or access key

  if (!email || !key) {
    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ zones:[], configured:false, message:"Set ACLED_EMAIL and ACLED_KEY in Netlify env vars." }),
    };
  }

  // Get OAuth token first
  let token;
  try {
    token = await getOAuthToken(email, key);
  } catch(e) {
    return {
      statusCode: 200,
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ zones:[], configured:false, message:`ACLED OAuth failed: ${e.message}` }),
    };
  }

  const zoneResults = [];

  // Fetch in batches to avoid overwhelming ACLED free tier
  for (const zone of ZONES) {
    try {
      const events    = await fetchZoneEvents(zone, token);
      const total     = events.length;
      const fatalities= events.reduce((s, e) => s + (parseInt(e.fatalities) || 0), 0);
      const intensity = scoreIntensity(total, fatalities);

      // Get most recent event types for context
      const eventTypes = [...new Set(events.slice(0,10).map(e => e.event_type))].slice(0,3);

      zoneResults.push({
        id:         zone.id,
        cocom:      zone.cocom,
        events30d:  total,
        fatalities30d: fatalities,
        intensity,
        eventTypes,
        lastUpdated: new Date().toISOString(),
      });

      // Small delay between requests to be kind to ACLED's servers
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`ACLED error for zone ${zone.id} (${zone.name}):`, err.message);
      // Don't fail the whole batch — just skip this zone
    }
  }

  const result = { zones: zoneResults, configured: true, fetchedAt: new Date().toISOString() };
  cache = result;
  cacheTime = Date.now();

  return {
    statusCode: 200,
    headers: { "Content-Type":"application/json", "Cache-Control":"public,max-age=21600" },
    body: JSON.stringify(result),
  };
};
