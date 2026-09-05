(() => {
  const CONTROL_LABELS = ['RINGS','AOR','CTRL','TERRAIN'];

  function buttonText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function controlHits(el) {
    const text = buttonText(el);
    return CONTROL_LABELS.reduce((n, label) => n + (text.includes(label) ? 1 : 0), 0);
  }

  function isPlausibleMapShell(el) {
    if (!el || el === document.body || el.closest?.('#tm-knowledge-drawer')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 360 || rect.height < 220) return false;
    return controlHits(el) >= 3;
  }

  function findMapShell() {
    const buttons = [...document.querySelectorAll('button')];
    const ring = buttons.find(btn => buttonText(btn).includes('RINGS'));

    // Prefer the closest large ancestor that owns the map-control row. This avoids
    // accidentally mounting to a broad page wrapper that also contains the controls.
    if (ring) {
      let node = ring.parentElement;
      let depth = 0;
      while (node && node !== document.body && depth < 10) {
        if (isPlausibleMapShell(node)) return node;
        node = node.parentElement;
        depth++;
      }
    }

    // Fallback for future map markup changes: choose the smallest visible map-like
    // element that is large enough to function as the map surface.
    const mapLike = [...document.querySelectorAll('[id*="map" i],[class*="map" i]')]
      .filter(el => !el.closest('#tm-knowledge-drawer'))
      .map(el => ({ el, rect:el.getBoundingClientRect() }))
      .filter(item => item.rect.width >= 360 && item.rect.height >= 220)
      .sort((a,b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
    return mapLike[0]?.el || null;
  }

  function mountLauncher() {
    const launcher = document.getElementById('tm-knowledge-launcher');
    const mapShell = findMapShell();
    if (!launcher || !mapShell) return false;

    if (getComputedStyle(mapShell).position === 'static') mapShell.style.position = 'relative';
    mapShell.setAttribute('data-tm-map-shell', 'true');
    launcher.classList.add('tm-map-mounted');
    launcher.textContent = '◈ TASK ORG / AO';
    launcher.title = 'Explore units, adversaries, militias, systems and networks in this AOR';
    launcher.setAttribute('aria-label', 'Open Task Org and AO knowledge explorer');

    if (launcher.parentElement !== mapShell) mapShell.appendChild(launcher);
    return true;
  }

  function boot() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (mountLauncher() || attempts >= 80) clearInterval(timer);
    }, 125);

    const observer = new MutationObserver(() => {
      const launcher = document.getElementById('tm-knowledge-launcher');
      if (launcher && !launcher.classList.contains('tm-map-mounted')) mountLauncher();
    });
    observer.observe(document.body, { childList:true, subtree:true });

    window.addEventListener('resize', () => requestAnimationFrame(mountLauncher), { passive:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
