function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async function() {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://tocmonkey.com';
  if (!adminPassword) {
    console.error('ticker-refresh scheduler: ADMIN_PASSWORD not configured');
    return json(500, { ok:false, error:'Market refresh dispatch unavailable' });
  }

  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/.netlify/functions/ticker-refresh-background`, {
      method:'POST',
      headers:{ 'x-admin-password':adminPassword },
      signal:AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Background dispatch HTTP ${response.status}`);
    return json(202, { ok:true, dispatched:true, provider:'EIA + verified web research cache' });
  } catch (error) {
    console.error('ticker-refresh dispatch failed:', error);
    return json(500, { ok:false, error:error.message || 'Market refresh dispatch failed' });
  }
};
