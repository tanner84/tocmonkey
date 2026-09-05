const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const marker = 'data-tm-modernization="v1"';

let html = fs.readFileSync(indexPath, 'utf8');

if (html.includes(marker)) {
  console.log('[public-modernization] already injected; skipping');
  process.exit(0);
}

const headInjection = `\n  <!-- TOC Monkey public modernization: injected at Netlify build time -->\n  <link rel="stylesheet" href="/public-modernization.css" ${marker}>\n`;
const bodyInjection = `\n  <script src="/public-ao-directory.js" defer ${marker}></script>\n  <script src="/public-modernization.js" defer ${marker}></script>\n`;

if (!html.includes('</head>') || !html.includes('</body>')) {
  throw new Error('index.html is missing </head> or </body>; refusing to modify build output');
}

html = html.replace('</head>', `${headInjection}</head>`);
html = html.replace('</body>', `${bodyInjection}</body>`);
fs.writeFileSync(indexPath, html, 'utf8');

console.log('[public-modernization] injected CSS/JS hooks into build output only');
