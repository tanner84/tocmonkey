// ─────────────────────────────────────────────────────────────────────────────
// F1 Race Results Card — TEST FUNCTION (no dedup, always posts)
//
// Fetches last week's F1 race top 3, renders a 1080x1080 podium card.
// Trigger manually via Netlify dashboard or schedule below.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { getStore } = require('@netlify/blobs');

// ── Font registration ─────────────────────────────────────────────────────────
(function registerFonts() {
  const fontDir = path.join(process.env.LAMBDA_TASK_ROOT || path.join(__dirname, '../..'), 'public/fonts');
  try {
    const regBuf  = fs.readFileSync(path.join(fontDir, 'RobotoMono-Regular.ttf'));
    const boldBuf = fs.readFileSync(path.join(fontDir, 'RobotoMono-Bold.ttf'));
    const r1 = GlobalFonts.register(regBuf);
    const r2 = GlobalFonts.register(boldBuf);
    const families = GlobalFonts.getFamilies();
    console.log(`f1-card-test fonts: r1=${r1} r2=${r2} families=${JSON.stringify(families)}`);
    // Create alias so ctx.font can use 'RobotoMono' without spaces
    if (families && families.length > 0) {
      const actual = families[0].family || families[0];
      GlobalFonts.setAlias(actual, 'RobotoMono');
      console.log(`f1-card-test alias set: "${actual}" -> "RobotoMono"`);
    }
  } catch(e) {
    console.error('f1-card-test font registration failed:', e.message, '| dir:', fontDir);
  }
}());

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0a0a0a',
  bgRow:   '#111111',
  red:     '#E8002D',
  gold:    '#FFD700',
  silver:  '#C0C0C0',
  bronze:  '#CD7F32',
  white:   '#FFFFFF',
  dim:     '#888888',
  faint:   '#444444',
};

const MEDAL = ['', C.gold, C.silver, C.bronze];
const POS_LABEL = ['', 'P1', 'P2', 'P3'];

// ── Fetch last week's F1 results via Claude web_search ───────────────────────
async function fetchResults(anthropicKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the most recent Formula 1 Grand Prix race results. Return ONLY raw JSON, no markdown, no backticks:
{"race":"Grand Prix Name","circuit":"Circuit Name","date":"Mon DD, YYYY","results":[{"pos":1,"driver":"Full Name","team":"Team Name","time":"H:MM:SS.mmm","gap":null},{"pos":2,"driver":"Full Name","team":"Team Name","time":null,"gap":"+X.XXXs"},{"pos":3,"driver":"Full Name","team":"Team Name","time":null,"gap":"+X.XXXs"}]}`,
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }
  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  const text = textBlock.text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(text);
}

// ── Render 1080x1080 podium card ──────────────────────────────────────────────
function buildCard(data) {
  const W = 1080, H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Top red bar
  ctx.fillStyle = C.red;
  ctx.fillRect(0, 0, W, 8);

  // ── "F1" label ───────────────────────────────────────────────────────────────
  ctx.fillStyle = C.red;
  ctx.font = "bold 96px RobotoMono";
  ctx.textAlign = 'left';
  ctx.fillText('F1', 40, 120);

  // ── "RACE RESULTS" label ──────────────────────────────────────────────────────
  ctx.fillStyle = C.white;
  ctx.font = "bold 36px RobotoMono";
  ctx.textAlign = 'left';
  ctx.fillText('RACE RESULTS', 40, 165);

  // ── Race name (right side) ────────────────────────────────────────────────────
  ctx.fillStyle = C.white;
  ctx.font = "bold 28px RobotoMono";
  ctx.textAlign = 'right';
  const raceName = String(data.race || '').toUpperCase();
  ctx.fillText(raceName, W - 40, 100);

  // ── Circuit + date ────────────────────────────────────────────────────────────
  ctx.fillStyle = C.dim;
  ctx.font = "22px RobotoMono";
  ctx.textAlign = 'right';
  ctx.fillText(String(data.circuit || ''), W - 40, 132);

  ctx.fillStyle = C.dim;
  ctx.font = "22px RobotoMono";
  ctx.textAlign = 'right';
  ctx.fillText(String(data.date || ''), W - 40, 162);

  // ── Divider ───────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.red;
  ctx.fillRect(0, 200, W, 4);

  // ── Podium rows ───────────────────────────────────────────────────────────────
  const results = Array.isArray(data.results) ? data.results.slice(0, 3) : [];

  const ROW_START = 240;
  const ROW_H     = 220;

  results.forEach((r, i) => {
    const pos     = r.pos || (i + 1);
    const color   = MEDAL[pos] || C.white;
    const rowY    = ROW_START + i * ROW_H;

    // Row background
    ctx.fillStyle = C.bgRow;
    ctx.fillRect(20, rowY, W - 40, ROW_H - 16);

    // Left accent strip in medal color
    ctx.fillStyle = color;
    ctx.fillRect(20, rowY, 8, ROW_H - 16);

    // Position label
    ctx.fillStyle = color;
    ctx.font = "bold 80px RobotoMono";
    ctx.textAlign = 'left';
    ctx.fillText(POS_LABEL[pos] || `P${pos}`, 50, rowY + 95);

    // Driver name
    ctx.fillStyle = C.white;
    ctx.font = "bold 42px RobotoMono";
    ctx.textAlign = 'left';
    ctx.fillText(String(r.driver || ''), 200, rowY + 68);

    // Team name
    ctx.fillStyle = C.dim;
    ctx.font = "28px RobotoMono";
    ctx.textAlign = 'left';
    ctx.fillText(String(r.team || ''), 200, rowY + 110);

    // Time / gap
    const timeStr = pos === 1 ? (r.time || '') : (r.gap || '');
    ctx.fillStyle = color;
    ctx.font = "bold 32px RobotoMono";
    ctx.textAlign = 'right';
    ctx.fillText(String(timeStr), W - 50, rowY + 90);
  });

  // ── Bottom divider ────────────────────────────────────────────────────────────
  ctx.fillStyle = C.red;
  ctx.fillRect(0, 1040, W, 4);

  // ── Footer ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.faint;
  ctx.font = "20px RobotoMono";
  ctx.textAlign = 'left';
  ctx.fillText('OPEN SOURCE · NOT VERIFIED', 40, 1068);

  ctx.fillStyle = C.dim;
  ctx.font = "20px RobotoMono";
  ctx.textAlign = 'right';
  ctx.fillText('tocmonkey.com', W - 40, 1068);

  return canvas.toBuffer('image/png');
}

// ── Post to Facebook ──────────────────────────────────────────────────────────
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

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' };

  // Fetch results
  let data;
  try {
    data = await fetchResults(anthropicKey);
    console.log('f1-card-test: fetched', data.race, data.date);
  } catch(e) {
    console.error('f1-card-test fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  // Render
  let imageBuffer;
  try {
    imageBuffer = buildCard(data);
    console.log(`f1-card-test: rendered (${imageBuffer.length} bytes)`);
  } catch(e) {
    console.error('f1-card-test render failed:', e.message);
    return { statusCode: 500, body: `Render failed: ${e.message}` };
  }

  // Post
  const dateStr = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  }).toUpperCase();
  const message = `[F1] ${data.race || 'RACE RESULTS'} | ${data.date || dateStr}\n\ntocmonkey.com\n\n#F1 #Formula1 #TOCMonkey`;

  try {
    const result = await postPhoto(imageBuffer, message);
    const postId = result.id || result.post_id || 'unknown';
    console.log('f1-card-test posted:', postId);
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: postId, race: data.race }) };
  } catch(e) {
    console.error('f1-card-test post failed:', e.message);
    return { statusCode: 500, body: `Post failed: ${e.message}` };
  }
};
