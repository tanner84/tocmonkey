(function () {
  'use strict';

  const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
  const TRAILING_PUNCTUATION = /[),.;!?\]]$/;

  function splitTrailingPunctuation(value) {
    let url = value;
    let trailing = '';
    while (url && TRAILING_PUNCTUATION.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    return { url, trailing };
  }

  function linkifyTextNode(node) {
    const text = node.nodeValue || '';
    URL_PATTERN.lastIndex = 0;
    if (!URL_PATTERN.test(text)) return false;
    URL_PATTERN.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match;

    while ((match = URL_PATTERN.exec(text))) {
      const start = match.index;
      const raw = match[0];
      const parts = splitTrailingPunctuation(raw);
      if (!parts.url) continue;

      if (start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, start)));

      const anchor = document.createElement('a');
      anchor.className = 'tm-sitrep-inline-link';
      anchor.href = parts.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = parts.url;
      fragment.appendChild(anchor);

      if (parts.trailing) fragment.appendChild(document.createTextNode(parts.trailing));
      cursor = start + raw.length;
    }

    if (!cursor) return false;
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
    return true;
  }

  function linkifySitrep(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('a, button, script, style')) continue;
      if (/https?:\/\//i.test(node.nodeValue || '')) nodes.push(node);
    }
    nodes.forEach(linkifyTextNode);
  }

  function install() {
    const body = document.getElementById('srpbody');
    if (!body || body.dataset.tmSitrepLinks === '1') return;
    body.dataset.tmSitrepLinks = '1';

    let queued = false;
    const run = () => {
      queued = false;
      linkifySitrep(body);
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
    };

    const observer = new MutationObserver(queue);
    observer.observe(body, { childList: true, subtree: true, characterData: true });
    linkifySitrep(body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
