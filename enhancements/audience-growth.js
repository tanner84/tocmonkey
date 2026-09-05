(() => {
  let config = null;

  function esc(value='') {
    return String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  }

  function currentCocom() {
    const select = document.querySelector('#tm-k-command');
    if (select?.value) return select.value === 'INDOPACOM' ? 'PACOM' : select.value;
    const active = [...document.querySelectorAll('[aria-selected="true"],.active,.selected,.cocom-active,.tab-active')]
      .map(el => String(el.textContent || el.getAttribute('data-cocom') || '').toUpperCase())
      .join(' ');
    if (active.includes('INDOPACOM') || /\bPACOM\b/.test(active)) return 'PACOM';
    return ['EUCOM','CENTCOM','AFRICOM','SOUTHCOM','NORTHCOM'].find(id => active.includes(id)) || '';
  }

  function trackedHref(source, cocom='') {
    const qs = new URLSearchParams({ source });
    if (cocom) qs.set('cocom', cocom);
    return `/.netlify/functions/subscribe-redirect?${qs.toString()}`;
  }

  async function loadConfig() {
    if (config) return config;
    const r = await fetch('/enhancements/audience-config.json', { cache:'no-store' });
    if (!r.ok) throw new Error('Audience config unavailable');
    config = await r.json();
    return config;
  }

  function mountMapCta() {
    if (!config || document.getElementById('tm-audience-map-cta')) return true;
    const mapShell = document.querySelector('[data-tm-map-shell="true"]');
    if (!mapShell) return false;

    const wrap = document.createElement('div');
    wrap.id = 'tm-audience-map-cta';
    wrap.innerHTML = `
      <div class="tm-audience-kicker">${esc(config.cta.headline)}</div>
      <a class="tm-audience-button" href="${trackedHref('map', currentCocom())}" target="_blank" rel="noopener noreferrer">${esc(config.cta.button)} ↗</a>`;
    const link = wrap.querySelector('a');
    link.addEventListener('click', () => { link.href = trackedHref('map', currentCocom()); });
    mapShell.appendChild(wrap);
    return true;
  }

  function mountDrawerCta() {
    if (!config || document.getElementById('tm-audience-drawer-cta')) return true;
    const drawer = document.getElementById('tm-knowledge-drawer');
    if (!drawer) return false;
    const note = drawer.querySelector('.tm-k-note');

    const cta = document.createElement('section');
    cta.id = 'tm-audience-drawer-cta';
    cta.innerHTML = `
      <div>
        <strong>${esc(config.newsletterName)}</strong>
        <span>${esc(config.cta.description)}</span>
      </div>
      <a href="${trackedHref('task-org', currentCocom())}" target="_blank" rel="noopener noreferrer">${esc(config.cta.button)} ↗</a>`;
    const link = cta.querySelector('a');
    link.addEventListener('click', () => { link.href = trackedHref('task-org', currentCocom()); });
    if (note) note.insertAdjacentElement('beforebegin', cta);
    else drawer.appendChild(cta);
    return true;
  }

  function mountFallback() {
    if (!config || document.getElementById('tm-audience-fallback') || document.getElementById('tm-audience-map-cta')) return;
    const el = document.createElement('a');
    el.id = 'tm-audience-fallback';
    el.href = trackedHref('floating');
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.innerHTML = `<span>${esc(config.cta.headline)}</span><b>${esc(config.cta.button)} ↗</b>`;
    document.body.appendChild(el);
  }

  async function boot() {
    try { await loadConfig(); } catch (_) { return; }

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const mapReady = mountMapCta();
      mountDrawerCta();
      if (mapReady || attempts >= 80) {
        clearInterval(timer);
        if (!mapReady) mountFallback();
      }
    }, 125);

    const observer = new MutationObserver(() => {
      mountMapCta();
      mountDrawerCta();
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
