// ─────────────────────────────────────────────────────────────────────────────
// F1 Race Results Card — TEST FUNCTION (no dedup, always posts)
//
// Text rendering approach: opentype.js converts TTF → SVG <path> data.
// sharp converts SVG → JPEG. No renderer font loading required.
// ─────────────────────────────────────────────────────────────────────────────

const fs       = require('fs');
const path     = require('path');
const opentype = require('opentype.js');
const sharp    = require('sharp');

const FONT_DIR = path.join(
  process.env.LAMBDA_TASK_ROOT || path.join(__dirname, '../..'),
  'public/fonts'
);

// ── Font loading (pure JS, uses fs.readFileSync — confirmed works on Lambda) ──
let _reg, _bold;
function fonts() {
  if (!_reg) {
    const regBuf  = fs.readFileSync(path.join(FONT_DIR, 'RobotoMono-Regular.ttf'));
    const boldBuf = fs.readFileSync(path.join(FONT_DIR, 'RobotoMono-Bold.ttf'));
    _reg  = opentype.parse(regBuf.buffer);
    _bold = opentype.parse(boldBuf.buffer);
    console.log('f1-card-test: fonts loaded via opentype.js');
  }
  return { reg: _reg, bold: _bold };
}

// ── Render text as SVG <path> — no renderer font support needed ───────────────
function txt(str, x, y, size, color, bold = false, align = 'left') {
  const s = String(str || '');
  if (!s) return '';
  const font = bold ? fonts().bold : fonts().reg;
  let startX = x;
  if (align === 'right')  startX = x - font.getAdvanceWidth(s, size);
  if (align === 'center') startX = x - font.getAdvanceWidth(s, size) / 2;
  const p = font.getPath(s, startX, y, size);
  p.fill = color;
  return p.toSVG(1);
}

// ── Build 1080×1080 SVG card ──────────────────────────────────────────────────
function buildSVG(data) {
  const W = 1080, H = 1080;
  const MEDAL = ['', '#FFD700', '#C0C0C0', '#CD7F32'];
  const results = Array.isArray(data.results) ? data.results.slice(0, 3) : [];

  const rows = results.map((r, i) => {
    const pos     = r.pos || (i + 1);
    const color   = MEDAL[pos] || '#FFFFFF';
    const rowY    = 240 + i * 220;
    const timeStr = pos === 1 ? (r.time || '') : (r.gap || '');
    return `
  <rect x="20" y="${rowY}" width="1040" height="204" fill="#111111"/>
  <rect x="20" y="${rowY}" width="8"    height="204" fill="${color}"/>
  ${txt(`P${pos}`,    50,   rowY + 100, 80, color,     true)}
  ${txt(r.driver,    200,   rowY + 75,  42, '#FFFFFF',  true)}
  ${txt(r.team,      200,   rowY + 118, 28, '#888888',  false)}
  ${txt(timeStr,    1030,   rowY + 100, 32, color,      true, 'right')}`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>
  <rect x="0" y="0" width="${W}" height="8" fill="#E8002D"/>

  ${txt('F1',                              40,   120, 96, '#E8002D',  true)}
  ${txt('RACE RESULTS',                    40,   165, 36, '#FFFFFF',  true)}
  ${txt((data.race||'').toUpperCase(),   1040,   100, 28, '#FFFFFF',  true,  'right')}
  ${txt(data.circuit,                    1040,   134, 22, '#888888',  false, 'right')}
  ${txt(data.date,                       1040,   164, 22, '#888888',  false, 'right')}

  <rect x="0" y="200" width="${W}" height="4" fill="#E8002D"/>

  ${rows}

  <rect x="0" y="1040" width="${W}" height="4" fill="#E8002D"/>
  ${txt('OPEN SOURCE · NOT VERIFIED',      40,  1068, 20, '#444444',  false)}
  ${txt('tocmonkey.com',                 1040,  1068, 20, '#888888',  false, 'right')}
</svg>`;
}

// ── Fetch F1 results via Claude web_search ────────────────────────────────────
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
        content: `Search for the most recent Formula 1 Grand Prix race results. Return ONLY a raw JSON object, no markdown, no explanation:
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

  const match = textBlock.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${textBlock.text.slice(0, 120)}`);
  return JSON.parse(match[0]);
}

// ── Post JPEG to Facebook ─────────────────────────────────────────────────────
async function postPhoto(imageBuffer, message) {
  const pageId    = process.env.FACEBOOK_PAGE_ID;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN;
  if (!pageId || !pageToken) throw new Error('Facebook env vars not set');

  const form = new FormData();
  form.append('source', new Blob([imageBuffer], { type: 'image/jpeg' }), 'card.jpg');
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

  let data;
  try {
    data = await fetchResults(anthropicKey);
    console.log('f1-card-test: fetched', data.race, data.date);
  } catch(e) {
    console.error('f1-card-test fetch failed:', e.message);
    return { statusCode: 500, body: `Fetch failed: ${e.message}` };
  }

  let imageBuffer;
  try {
    const svg = buildSVG(data);
    imageBuffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
    console.log(`f1-card-test: rendered ${imageBuffer.length} bytes`);
  } catch(e) {
    console.error('f1-card-test render failed:', e.message);
    return { statusCode: 500, body: `Render failed: ${e.message}` };
  }

  const message = `[F1] ${data.race || 'RACE RESULTS'} | ${data.date || ''}\n\ntocmonkey.com\n\n#F1 #Formula1 #TOCMonkey`;

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
