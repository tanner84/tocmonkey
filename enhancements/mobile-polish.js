(() => {
  const MOBILE_QUERY = '(max-width: 820px)';
  const mq = window.matchMedia(MOBILE_QUERY);
  let scheduled = false;

  const COCOM_RE = /^(EUCOM|CENTCOM|PACOM|INDOPACOM|AFRICOM|SOUTHCOM|NORTHCOM)$/i;

  function nearestPanel(el) {
    if (!el) return null;
    return el.closest('section, aside, main > div, body > div') || el.parentElement;
  }

  function annotateUtilities() {
    const actions = [...document.querySelectorAll('a,button')].filter(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
      return t.includes('FOLLOW / SUBSCRIBE') || t === 'WTF IS THIS?' || t === 'WTF IS THIS';
    });
    actions.forEach(el => el.classList.add('tm-mobile-utility-action'));
    const parents = new Map();
    actions.forEach(el => {
      const p = el.parentElement;
      if (p) parents.set(p, (parents.get(p) || 0) + 1);
    });
    [...parents.entries()].filter(([, count]) => count >= 2).forEach(([p]) => p.classList.add('tm-mobile-utility-row'));
  }

  function annotateCocomTabs() {
    const tabs = [...document.querySelectorAll('button,a,[role="tab"]')].filter(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return COCOM_RE.test(t);
    });
    tabs.forEach(el => el.classList.add('tm-mobile-cocom-tab'));
    const parents = new Map();
    tabs.forEach(el => {
      const p = el.parentElement;
      if (p) parents.set(p, (parents.get(p) || 0) + 1);
    });
    [...parents.entries()].filter(([, count]) => count >= 3).forEach(([p]) => p.classList.add('tm-mobile-cocom-tabs'));
  }

  function annotateMap() {
    document.querySelectorAll('.leaflet-container').forEach(map => {
      map.classList.add('tm-mobile-map');
      const panel = nearestPanel(map);
      if (panel && panel !== document.body) panel.classList.add('tm-mobile-panel', 'tm-mobile-map-panel');
    });
  }

  function annotateKnownPanels() {
    document.querySelectorAll('.tm-sigacts-scoped').forEach(panel => {
      panel.classList.add('tm-mobile-panel', 'tm-mobile-sigact-panel');
    });
    document.querySelectorAll('.tm-osint-dense').forEach(panel => {
      panel.classList.add('tm-mobile-panel', 'tm-mobile-osint-panel');
    });
    const tv = document.querySelector('#eqpnl.tm-tv-panel');
    if (tv) tv.classList.add('tm-mobile-panel', 'tm-mobile-tv-panel');
  }

  function annotateContentPanels() {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,.title,.section-title,.pht,[class*="header"]')];
    headings.forEach(h => {
      const text = (h.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (!text || text.length > 120) return;
      let kind = null;
      if (/\bSIGACT/.test(text)) kind = 'sigact';
      else if (/\b(OSINT|RSS|OPEN SOURCE|SOCIAL FEED|INTEL FEED)\b/.test(text)) kind = 'osint';
      else if (/\bTOC TV\b/.test(text)) kind = 'tv';
      else if (/\bSITREP\b/.test(text)) kind = 'sitrep';
      if (!kind) return;
      const panel = nearestPanel(h);
      if (!panel || panel === document.body) return;
      panel.classList.add('tm-mobile-panel', `tm-mobile-${kind}-panel`);
    });
  }

  function annotate() {
    scheduled = false;
    if (!mq.matches) {
      document.body?.classList.remove('tm-mobile-ready');
      return;
    }
    document.body?.classList.add('tm-mobile-ready');
    annotateUtilities();
    annotateCocomTabs();
    annotateMap();
    annotateKnownPanels();
    annotateContentPanels();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(annotate);
  }

  mq.addEventListener?.('change', schedule);
  const observer = new MutationObserver(schedule);

  function boot() {
    annotate();
    observer.observe(document.body, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class']
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
