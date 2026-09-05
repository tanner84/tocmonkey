(() => {
  const CONTROL_LABELS = ['RINGS','AOR','CTRL','TERRAIN'];

  function buttonText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function candidateScore(el) {
    if (!el || el === document.body || el.closest?.('#tm-knowledge-drawer')) return -1;
    const rect = el.getBoundingClientRect();
    if (rect.width < 360 || rect.height < 220) return -1;
    const text = buttonText(el);
    const hits = CONTROL_LABELS.reduce((n, label) => n + (text.includes(label) ? 1 : 0), 0);
    const mapSignals = el.querySelectorAll('svg,canvas,[class*="map" i],[id*="map" i]').length;
    return hits * 100 + Math.min(mapSignals, 4) * 20 + Math.min(rect.width * rect.height / 100000, 20);
  }

  function findMapShell() {
    const buttons = [...document.querySelectorAll('button')];
    const ring = buttons.find(btn => buttonText(btn).includes('RINGS'));
    const candidates = [];

    if (ring) {
      let node = ring.parentElement;
      let depth = 0;
      while (node && node !== document.body && depth < 8) {
        candidates.push(node);
        node = node.parentElement;
        depth++;
      }
    }

    document.querySelectorAll('[id*="map" i],[class*="map" i]').forEach(el => candidates.push(el));
    const unique = [...new Set(candidates)];
    return unique
      .map(el => ({ el, score:candidateScore(el) }))
      .filter(item => item.score >= 200)
      .sort((a,b) => b.score - a.score)[0]?.el || null;
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
