// NHL Scores — pulls verified final scores from ESPN API, posts logo + text to Facebook
const { getStore } = require('@netlify/blobs');

// Returns yesterday's date in YYYYMMDD — last night's games
function getYesterdayYMD() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchScores() {
  const ymd = getYesterdayYMD();
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${ymd}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ESPN API ${res.status}`);
  const data = await res.json();

  const games = [];
  for (const event of (data.events || [])) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    // Validation: only include games ESPN marks as completed/final
    if (!comp.status?.type?.completed) continue;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeScore = parseInt(home.score, 10);
    const awayScore = parseInt(away.score, 10);
    if (isNaN(homeScore) || isNaN(awayScore)) continue;

    // OT detection: shortDetail is "Final/OT", "Final/SO", etc.
    const detail = comp.status.type.shortDetail || '';
    const ot = detail.includes('/') ? detail.split('/')[1] : false;

    games.push({
      away: away.team.displayName,
      awayScore,
      home: home.team.displayName,
      homeScore,
      ot,
    });
  }
  return games;
}

async function postToFacebook(message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://tocmonkey.com/logo.png', message, access_token: pageToken }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return await res.json();
}

exports.handler = async () => {
  const now     = new Date();
  const dateStr = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
    .toUpperCase();
  const dateKey = `nhl-${now.toISOString().slice(0, 10)}`;

  try {
    const store = getStore('sports-card-dedup');
    if (await store.get(dateKey)) {
      console.log(`nhl-card: already posted ${dateKey}`);
      return { statusCode: 200, body: 'Already posted' };
    }
  } catch(e) { console.warn('dedup check failed:', e.message); }

  let games;
  try {
    games = await fetchScores();
    console.log(`nhl-card: fetched ${games.length} completed games`);
  } catch(e) {
    console.error('nhl-card fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  if (games.length < 1) {
    console.log('nhl-card: no completed games found — skipping');
    return { statusCode: 200, body: 'No games' };
  }

  const lines = games.map(g => {
    const ot      = g.ot ? ` (${g.ot})` : '';
    const winner  = g.awayScore > g.homeScore ? '>' : ' ';
    const winner2 = g.homeScore > g.awayScore ? '<' : ' ';
    return `${winner} ${g.away} ${g.awayScore}  —  ${g.home} ${g.homeScore} ${winner2}${ot}`.trim();
  });

  const message = `🏒 [NHL] SCORES | ${dateStr}\n\n${lines.join('\n')}\n\ntocmonkey.com\n\n#NHL #Hockey #TOCMonkey`;

  try {
    const result = await postToFacebook(message);
    console.log('nhl-card posted:', result.id);
    try { await getStore('sports-card-dedup').set(dateKey, result.id); } catch(e) {}
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: result.id }) };
  } catch(e) {
    console.error('nhl-card post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
