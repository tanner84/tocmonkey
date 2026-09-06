export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
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
  if (!html.includes('/enhancements/public-enhancements.js')) {
    html = html.replace('</body>', '  <script src="/enhancements/public-enhancements.js" defer></script>\n</body>');
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