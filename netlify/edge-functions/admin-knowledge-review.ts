export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  // Keep the legacy static admin file accurate without rewriting the whole document.
  // The public ticker no longer depends on paid Metals API / Alpha Vantage plans.
  html = html.replace(
    '{ name:"Commodity Ticker", fn: ()=>fetch(\'/.netlify/functions/ticker\'),        envVars:["METALS_API_KEY","ALPHAVANTAGE_KEY","EIA_API_KEY"], docs:"metals-api.com + alphavantage.co + eia.gov" },',
    '{ name:"Market Ticker",    fn: ()=>fetch(\'/.netlify/functions/ticker\'),        envVars:["EIA_API_KEY","OPENAI_API_KEY"], docs:"EIA.gov + scheduled verified web cache — no paid stock-data API" },'
  );

  if (!html.includes('/enhancements/admin-knowledge-review.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/admin-knowledge-review.css">\n</head>');
  }
  if (!html.includes('/enhancements/admin-audience.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/admin-audience.css">\n</head>');
  }
  if (!html.includes('/enhancements/admin-ai-ops.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/admin-ai-ops.css">\n</head>');
  }
  if (!html.includes('/enhancements/admin-knowledge-review.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/admin-knowledge-review.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/admin-audience.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/admin-audience.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/admin-ai-ops.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/admin-ai-ops.js" defer></script>\n</body>');
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(html, { status:response.status, statusText:response.statusText, headers });
};
