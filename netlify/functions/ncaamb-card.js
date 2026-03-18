// ─────────────────────────────────────────────────────────────────────────────
// NCAA Men's Basketball Score Card — Netlify Scheduled Function
// Schedule: daily at 02:00 UTC (set in netlify.toml)
//
// 1. Fetch today's CBB final scores via Claude web_search
// 2. Render a 1080x1080 score card image with @napi-rs/canvas
// 3. Deduplicate via Netlify Blobs (one post per calendar day)
// 4. POST to Facebook as photo (/photos endpoint)
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { getStore } = require('@netlify/blobs');

// Register bundled fonts — Lambda has no system fonts
(function registerFonts() {
  const fontDir = path.join(process.env.LAMBDA_TASK_ROOT || path.join(__dirname, '../..'), 'public/fonts');
  try {
    GlobalFonts.registerFromPath(path.join(fontDir, 'RobotoMono-Regular.ttf'), 'RobotoMono');
    GlobalFonts.registerFromPath(path.join(fontDir, 'RobotoMono-Bold.ttf'), 'RobotoMono');
  } catch(e) { console.warn('Font registration failed:', e.message); }
}());

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:       '#0a0f0a',
  bgAlt:    '#0d150d',
  border:   '#2d5a2d',
  accent:   '#00308F',
  winGreen: '#4dff4d',
  loseGreen:'#4a7a4a',
  dimGreen: '#2a7a2a',
  faintGreen:'#1a5a1a',
  sep:      '#1a2a1a',
  at:       '#3a6a3a',
};

// ── Fetch scores via Claude web_search ───────────────────────────────────────
async function fetchScores(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for college basketball scores today final results top 25. Return ONLY raw JSON no markdown no backticks: {"games": [{"away": "TEAM", "awayScore": 0, "awayRank": null, "home": "TEAM", "homeScore": 0, "homeRank": null, "status": "final", "ot": false}]} Prioritize ranked matchups first. Cap at 12 games.`,
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();

  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in score response');

  let parsed;
  try {
    const text = textBlock.text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(text);
  } catch(e) {
    throw new Error(`JSON parse failed: ${textBlock.text.slice(0, 300)}`);
  }

  return Array.isArray(parsed.games) ? parsed.games : [];
}

// ── Build OT label ─────────────────────────────────────────────────────────────
function otLabel(ot) {
  if (!ot || ot === false) return '';
  if (ot === true || ot === 'OT') return ' OT';
  if (String(ot).toUpperCase() === '2OT') return ' 2OT';
  return ` ${String(ot).toUpperCase()}`;
}

// ── Render 1080x1080 card ─────────────────────────────────────────────────────
async function buildCard(games, dateStr) {
  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Border ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Logo (160x160 at x=20 y=20) ─────────────────────────────────────────────
  try {
    const logoPath = (process.env.LAMBDA_TASK_ROOT || '.') + '/public/logo.png';
    const logo = await loadImage(logoPath);
    ctx.drawImage(logo, 20, 20, 160, 160);
  } catch(e) {
    // Fallback: dim green placeholder
    ctx.fillStyle = C.dimGreen;
    ctx.fillRect(20, 20, 160, 160);
    console.warn('Logo not found:', e.message);
  }

  // ── Sport label "CBB" ────────────────────────────────────────────────────────
  ctx.fillStyle = C.winGreen;
  ctx.font = 'bold 72px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText('CBB', W - 30, 105);

  // ── Date ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.dimGreen;
  ctx.font = '28px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 30, 150);

  // ── Accent bar (6px at y=200) ────────────────────────────────────────────────
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 200, W, 6);

  // ── Score rows ───────────────────────────────────────────────────────────────
  const ROW_H  = 42;
  const START_Y = 220;
  const MAX    = Math.min(games.length, 12);

  // Column anchors
  const COL = {
    awayRankR:  75,   // right-align away rank
    awayTeamL:  82,   // left-align away team
    awayScoreR: 505,  // right-align away score
    atCenter:   540,  // center "@"
    homeScoreL: 575,  // left-align home score
    homeTeamL:  700,  // left-align home team
    homeRankL:  975,  // left-align home rank
  };

  for (let i = 0; i < MAX; i++) {
    const g    = games[i];
    const rowY = START_Y + i * ROW_H;

    // Alternating background
    ctx.fillStyle = i % 2 === 0 ? C.bg : C.bgAlt;
    ctx.fillRect(0, rowY, W, ROW_H);

    // Thin separator line
    ctx.strokeStyle = C.sep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rowY + ROW_H - 1);
    ctx.lineTo(W, rowY + ROW_H - 1);
    ctx.stroke();

    const awayWon  = g.awayScore > g.homeScore;
    const homeWon  = g.homeScore > g.awayScore;
    const awayColor = awayWon ? C.winGreen : C.loseGreen;
    const homeColor = homeWon ? C.winGreen : C.loseGreen;
    const textY    = rowY + 28; // baseline ~2/3 down

    // ── Away rank ──────────────────────────────────────────────────────────────
    if (g.awayRank) {
      ctx.fillStyle = C.winGreen;
      ctx.font = 'bold 14px RobotoMono';
      ctx.textAlign = 'right';
      ctx.fillText(`(${g.awayRank})`, COL.awayRankR, textY);
    }

    // ── Away team ──────────────────────────────────────────────────────────────
    ctx.fillStyle = awayColor;
    ctx.font = `${awayWon ? 'bold ' : ''}18px RobotoMono`;
    ctx.textAlign = 'left';
    ctx.fillText(String(g.away || '').slice(0, 15), COL.awayTeamL, textY);

    // ── Away score ─────────────────────────────────────────────────────────────
    ctx.fillStyle = awayColor;
    ctx.font = `${awayWon ? 'bold ' : ''}22px RobotoMono`;
    ctx.textAlign = 'right';
    ctx.fillText(String(g.awayScore ?? ''), COL.awayScoreR, textY);

    // ── "@" separator ──────────────────────────────────────────────────────────
    ctx.fillStyle = C.at;
    ctx.font = '18px RobotoMono';
    ctx.textAlign = 'center';
    ctx.fillText('@', COL.atCenter, textY);

    // ── Home score + OT ────────────────────────────────────────────────────────
    ctx.fillStyle = homeColor;
    ctx.font = `${homeWon ? 'bold ' : ''}22px RobotoMono`;
    ctx.textAlign = 'left';
    ctx.fillText(String(g.homeScore ?? '') + otLabel(g.ot), COL.homeScoreL, textY);

    // ── Home team ──────────────────────────────────────────────────────────────
    ctx.fillStyle = homeColor;
    ctx.font = `${homeWon ? 'bold ' : ''}18px RobotoMono`;
    ctx.textAlign = 'left';
    ctx.fillText(String(g.home || '').slice(0, 15), COL.homeTeamL, textY);

    // ── Home rank ──────────────────────────────────────────────────────────────
    if (g.homeRank) {
      ctx.fillStyle = C.winGreen;
      ctx.font = 'bold 14px RobotoMono';
      ctx.textAlign = 'left';
      ctx.fillText(`(${g.homeRank})`, COL.homeRankL, textY);
    }
  }

  // ── Footer (y=1000 baseline) ──────────────────────────────────────────────
  ctx.fillStyle = C.faintGreen;
  ctx.font = '20px RobotoMono';
  ctx.textAlign = 'left';
  ctx.fillText('OPEN SOURCE · NOT VERIFIED', 30, 1040);

  ctx.fillStyle = C.dimGreen;
  ctx.font = '22px RobotoMono';
  ctx.textAlign = 'right';
  ctx.fillText('tocmonkey.com', W - 30, 1040);

  return canvas.toBuffer('image/png');
}

// ── Post photo to Facebook ────────────────────────────────────────────────────
async function postPhoto(imageBuffer, message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');

  const form = new FormData();
  form.append('source', new Blob([imageBuffer], { type: 'image/png' }), 'card.png');
  form.append('message', message);
  form.append('access_token', pageToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Facebook API ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).toUpperCase();
  const ymd     = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const slot    = now.getUTCHours() < 17 ? 'am' : 'pm'; // AM run ≤16:59 UTC, PM run 17+ UTC
  const dateKey = `${ymd}-${slot}`; // separate dedup per slot so both runs can post

  // ── Deduplication — skip if already posted this slot ───────────────────────
  try {
    const store    = getStore('ncaamb-card-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`ncaamb-card: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  // ── Fetch scores ────────────────────────────────────────────────────────────
  let games;
  try {
    games = await fetchScores(anthropicKey);
  } catch(e) {
    console.error('Score fetch failed:', e.message);
    return { statusCode: 500, body: `Score fetch failed: ${e.message}` };
  }

  const finalGames = games.filter(g =>
    String(g.status || '').toLowerCase().includes('final')
  );
  console.log(`ncaamb-card: ${finalGames.length} final games`);

  if (finalGames.length < 1) {
    console.log('ncaamb-card: no finals — skipping');
    return { statusCode: 200, body: `Only ${finalGames.length} finals — skipping` };
  }

  // ── Build card ──────────────────────────────────────────────────────────────
  let imageBuffer;
  try {
    imageBuffer = await buildCard(finalGames.slice(0, 12), dateStr);
    console.log(`ncaamb-card: canvas rendered (${imageBuffer.length} bytes)`);
  } catch(e) {
    console.error('Card render failed:', e.message);
    return { statusCode: 500, body: `Card render failed: ${e.message}` };
  }

  // ── Post to Facebook ────────────────────────────────────────────────────────
  const message = `[CBB] SCORES | ${dateStr}\n\ntocmonkey.com\n\n#CollegeBasketball #TOCMonkey`;
  try {
    const result = await postPhoto(imageBuffer, message);
    const postId = result.id || result.post_id || 'unknown';
    console.log(`ncaamb-card posted: ${postId}`);

    // Mark as posted in Blobs
    try {
      const store = getStore('ncaamb-card-dedup');
      await store.set(dateKey, postId);
    } catch(e) {
      console.warn('Blobs dedup write failed (non-fatal):', e.message);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: postId }) };
  } catch(e) {
    console.error('Facebook post failed:', e.message);
    return { statusCode: 500, body: `Facebook post failed: ${e.message}` };
  }
};
