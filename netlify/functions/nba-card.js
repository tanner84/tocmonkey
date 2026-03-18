// ─────────────────────────────────────────────────────────────────────────────
// NBA Score Card — Netlify Scheduled Function
// Schedule: daily at 11:30 UTC (7:30am ET) — captures previous night's finals
//
// 1. Fetch NBA scores via Claude web_search
// 2. Render 1080x1080 score card with @napi-rs/canvas
// 3. Deduplicate via Netlify Blobs
// 4. POST to Facebook as photo
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   FACEBOOK_PAGE_ID
//   FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getStore } = require('@netlify/blobs');

const C = {
  bg:        '#080f18',
  bgAlt:     '#0a1220',
  border:    '#1a2a4a',
  accent:    '#C9082A',   // NBA red
  winWhite:  '#ffffff',
  loseGray:  '#3a4a6a',
  dimBlue:   '#2a3a5a',
  faintBlue: '#1a2a3a',
  sep:       '#111a2a',
  at:        '#2a3a5a',
  label:     '#C9082A',
};

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
        content: `Search for last night's NBA basketball final scores.
Return ONLY raw JSON no markdown no backticks:
{"games": [{"away": "TEAM ABBREVIATION", "awayScore": 0, "home": "TEAM ABBREVIATION", "homeScore": 0, "status": "final", "ot": false}]}
Use standard 3-letter team abbreviations (LAL, BOS, GSW, etc). Prioritize playoff games first. Cap at 12 games.
If no games found return {"games": []}`,
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  let parsed;
  try {
    const text = textBlock.text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(text);
  } catch(e) {
    throw new Error(`JSON parse failed: ${textBlock.text.slice(0, 300)}`);
  }

  return Array.isArray(parsed.games) ? parsed.games : [];
}

function otLabel(ot) {
  if (!ot || ot === false) return '';
  if (ot === true || ot === 'OT') return ' OT';
  if (String(ot).toUpperCase() === '2OT') return ' 2OT';
  if (String(ot).toUpperCase() === '3OT') return ' 3OT';
  return ` ${String(ot).toUpperCase()}`;
}

async function buildCard(games, dateStr) {
  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Logo
  try {
    const logo = await loadImage((process.env.LAMBDA_TASK_ROOT || '.') + '/public/logo.png');
    ctx.drawImage(logo, 20, 20, 160, 160);
  } catch(e) {
    ctx.fillStyle = C.dimBlue;
    ctx.fillRect(20, 20, 160, 160);
  }

  // Sport label
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 72px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('NBA', W - 30, 105);

  // Date
  ctx.fillStyle = C.dimBlue;
  ctx.font = '28px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 30, 150);

  // Accent bar
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 200, W, 6);

  // Score rows
  const ROW_H  = 42;
  const START_Y = 220;
  const MAX    = Math.min(games.length, 12);

  const COL = {
    awayTeamL:  30,
    awayScoreR: 505,
    atCenter:   540,
    homeScoreL: 575,
    homeTeamR:  1050,
  };

  for (let i = 0; i < MAX; i++) {
    const g    = games[i];
    const rowY = START_Y + i * ROW_H;

    ctx.fillStyle = i % 2 === 0 ? C.bg : C.bgAlt;
    ctx.fillRect(0, rowY, W, ROW_H);

    ctx.strokeStyle = C.sep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rowY + ROW_H - 1);
    ctx.lineTo(W, rowY + ROW_H - 1);
    ctx.stroke();

    const awayWon   = g.awayScore > g.homeScore;
    const homeWon   = g.homeScore > g.awayScore;
    const awayColor = awayWon ? C.winWhite : C.loseGray;
    const homeColor = homeWon ? C.winWhite : C.loseGray;
    const textY     = rowY + 28;

    // Away team
    ctx.fillStyle = awayColor;
    ctx.font = `${awayWon ? 'bold ' : ''}20px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(String(g.away || '').slice(0, 12), COL.awayTeamL, textY);

    // Away score
    ctx.fillStyle = awayColor;
    ctx.font = `${awayWon ? 'bold ' : ''}22px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(String(g.awayScore ?? ''), COL.awayScoreR, textY);

    // "@"
    ctx.fillStyle = C.at;
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('@', COL.atCenter, textY);

    // Home score + OT
    ctx.fillStyle = homeColor;
    ctx.font = `${homeWon ? 'bold ' : ''}22px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(String(g.homeScore ?? '') + otLabel(g.ot), COL.homeScoreL, textY);

    // Home team
    ctx.fillStyle = homeColor;
    ctx.font = `${homeWon ? 'bold ' : ''}20px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(String(g.home || '').slice(0, 12), COL.homeTeamR, textY);
  }

  // Footer
  ctx.fillStyle = C.faintBlue;
  ctx.font = '20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('OPEN SOURCE · NOT VERIFIED', 30, 1040);

  ctx.fillStyle = C.dimBlue;
  ctx.font = '22px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('tocmonkey.com', W - 30, 1040);

  return canvas.toBuffer('image/png');
}

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

exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).toUpperCase();
  const dateKey = `nba-${now.toISOString().slice(0, 10)}`;

  try {
    const store    = getStore('sports-card-dedup');
    const existing = await store.get(dateKey);
    if (existing) {
      console.log(`nba-card: already posted for ${dateKey} — skipping`);
      return { statusCode: 200, body: `Already posted for ${dateKey}` };
    }
  } catch(e) {
    console.warn('Blobs dedup check failed (non-fatal):', e.message);
  }

  let games;
  try {
    games = await fetchScores(anthropicKey);
  } catch(e) {
    console.error('Score fetch failed:', e.message);
    return { statusCode: 500, body: `Score fetch failed: ${e.message}` };
  }

  const finalGames = games.filter(g => String(g.status || '').toLowerCase().includes('final'));
  console.log(`nba-card: ${finalGames.length} final games`);

  if (finalGames.length < 1) {
    console.log('nba-card: no finals — skipping');
    return { statusCode: 200, body: `Only ${finalGames.length} finals — skipping` };
  }

  let imageBuffer;
  try {
    imageBuffer = await buildCard(finalGames.slice(0, 12), dateStr);
    console.log(`nba-card: rendered (${imageBuffer.length} bytes)`);
  } catch(e) {
    console.error('Card render failed:', e.message);
    return { statusCode: 500, body: `Card render failed: ${e.message}` };
  }

  const message = `[NBA] SCORES | ${dateStr}\n\ntocmonkey.com\n\n#NBA #Basketball #TOCMonkey`;
  try {
    const result = await postPhoto(imageBuffer, message);
    const postId = result.id || result.post_id || 'unknown';
    console.log(`nba-card posted: ${postId}`);

    try {
      const store = getStore('sports-card-dedup');
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
