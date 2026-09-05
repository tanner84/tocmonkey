export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
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
