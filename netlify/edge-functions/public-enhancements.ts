export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  // Bust the legacy 8-hour browser/CDN cache key for the market ticker.
  // The new ticker backend serves only verified or last-verified values; using a
  // versioned URL prevents browsers from reusing the old placeholder response.
  html = html.replace(
    "fetch('/.netlify/functions/ticker')",
    "fetch('/.netlify/functions/ticker?v=verified-market-v2', { cache:'no-store' })"
  );

  if (!html.includes('/enhancements/public-overrides.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/public-overrides.css">\n</head>');
  }
  if (!html.includes('/enhancements/public-map-hotfix.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/public-map-hotfix.css">\n</head>');
  }
  if (!html.includes('/enhancements/audience-growth.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/audience-growth.css">\n</head>');
  }
  if (!html.includes('/enhancements/cocom-feed-polish.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/cocom-feed-polish.css">\n</head>');
  }
  if (!html.includes('/enhancements/mobile-polish.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/mobile-polish.css">\n</head>');
  }
  if (!html.includes('/enhancements/task-org-parity.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/task-org-parity.css">\n</head>');
  }
  if (!html.includes('/enhancements/toc-tv.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/enhancements/toc-tv.css">\n</head>');
  }
  if (!html.includes('/enhancements/public-enhancements.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/public-enhancements.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/task-org-scale.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/task-org-scale.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/task-org-parity.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/task-org-parity.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/toc-tv.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/toc-tv.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/public-map-hotfix.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/public-map-hotfix.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/audience-growth.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/audience-growth.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/cocom-feed-polish.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/cocom-feed-polish.js" defer></script>\n</body>');
  }
  if (!html.includes('/enhancements/mobile-polish.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/mobile-polish.js" defer></script>\n</body>');
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
