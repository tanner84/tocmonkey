// ─────────────────────────────────────────────────────────────────────────────
// Confidence Scorer - Calculates reliability scores
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_RELIABILITY = {
  'Reuters': 95,
  'AP News': 95,
  'BBC': 90,
  'DoD News': 100,
  'State Dept': 100,
  'White House': 100,
  'Defense News': 85,
  'USNI News': 85,
  'ISW': 85,
  'Bellingcat': 80,
  'War on the Rocks': 80,
  'Military.com': 75,
  'The War Zone': 75,
  'H I Sutton': 85,
  'reddit': 50,
  'telegram': 55,
  'twitter': 60,
  'bluesky': 60,
  'unknown': 50
};

function calculateConfidence(params = {}) {
  const {
    source = 'unknown',
    platform = 'unknown',
    recency = null
  } = params;

  // Source reliability
  let score = SOURCE_RELIABILITY[source] || SOURCE_RELIABILITY[platform] || 50;

  // Recency bonus (last 2 hours = +10, last 24h = +5)
  if (recency) {
    const now = Date.now();
    const postTime = new Date(recency).getTime();
    const diff = now - postTime;
    if (diff < 2 * 3600 * 1000) score += 10;
    else if (diff < 24 * 3600 * 1000) score += 5;
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));
  return score;
}

module.exports = { calculateConfidence };
