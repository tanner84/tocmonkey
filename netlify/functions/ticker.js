// Public market ticker endpoint.
//
// Data policy:
// - Energy comes from the free U.S. EIA API.
// - Other market values come from a scheduled, server-side verified web-research cache.
// - Visitors never trigger paid market research.
// - There are no hard-coded price fallbacks. If a value cannot be verified, it is omitted
//   until a verified value exists; previously verified values are explicitly marked stale.

const { getPublicTicker } = require('./_market-ticker');

let memoryCache = null;
let memoryCacheAt = 0;
const MEMORY_TTL_MS = 5 * 60 * 1000;

exports.handler = async function() {
  try {
    if (memoryCache && Date.now() - memoryCacheAt < MEMORY_TTL_MS) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type':'application/json; charset=utf-8',
          'Cache-Control':'public, max-age=300, stale-while-revalidate=300',
          'X-Market-Data-State': memoryCache.stale ? 'last-verified' : 'verified',
        },
        body: JSON.stringify(memoryCache.items),
      };
    }

    const data = await getPublicTicker();
    memoryCache = data;
    memoryCacheAt = Date.now();

    return {
      statusCode: 200,
      headers: {
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'public, max-age=300, stale-while-revalidate=300',
        'X-Market-Data-State': data.stale ? 'last-verified' : 'verified',
        'X-Market-Data-As-Of': data.updatedAt || '',
      },
      body: JSON.stringify(data.items),
    };
  } catch (error) {
    console.error('ticker read failed:', error);
    return {
      statusCode: 503,
      headers: {
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store',
        'X-Market-Data-State':'unavailable',
      },
      body: JSON.stringify([]),
    };
  }
};
