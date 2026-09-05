(() => {
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

  function controlText(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function findControl(label) {
    const target = String(label || '').toUpperCase();
    return [...document.querySelectorAll('a,button,[role="button"]')]
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top < 90;
      })
      .find(el => controlText(el).includes(target)) || null;
  }

  function findTopShell() {
    const candidates = [...document.querySelectorAll('header,nav,[role="navigation"]')]
      .map(el => ({ el, rect:el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= 320 && rect.height >= 28 && rect.height <= 180 && rect.top < 160 && rect.bottom > 0)
      .sort((a,b) => a.rect.top - b.rect.top || b.rect.width - a.rect.width);
    return candidates[0]?.el || null;
  }

  function placeGlobalCta(link) {
    const wtf = findControl('WTF IS THIS');
    if (wtf?.parentElement) {
      link.classList.remove('tm-in-header','tm-global-fixed');
      link.classList.add('tm-topbar-native');
      if (link.nextElementSibling !== wtf || link.parentElement !== wtf.parentElement) {
        wtf.insertAdjacentElement('beforebegin', link);
      }
      return true;
    }

    const topShell = findTopShell();
    if (topShell) {
      if (getComputedStyle(topShell).position === 'static') topShell.style.position = 'relative';
      link.classList.remove('tm-topbar-native','tm-global-fixed');
      link.classList.add('tm-in-header');
      if (link.parentElement !== topShell) topShell.appendChild(link);
      return true;
    }

    link.classList.remove('tm-topbar-native','tm-in-header');
    link.classList.add('tm-global-fixed');
    if (link.parentElement !== document.body) document.body.appendChild(link);
    return false;
  }

  function mountGlobalCta() {
    let link = document.getElementById('tm-audience-global-follow');
    if (!link) {
      link = document.createElement('a');
      link.id = 'tm-audience-global-follow';
      link.href = trackedHref('global-follow', currentCocom());
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', 'Follow TOC Monkey on Substack or subscribe to the Monthly SITREP');
      link.title = 'Follow TOC Monkey on Substack or subscribe to the TOC Monkey Monthly SITREP';
      link.innerHTML = '<span>FOLLOW</span><b>/ SUBSCRIBE</b><i>↗</i>';
      link.addEventListener('click', () => {
        link.href = trackedHref('global-follow', currentCocom());
      });
    }

    placeGlobalCta(link);
    return true;
  }

  function removeLegacySecondaryCtas() {
    document.getElementById('tm-audience-map-cta')?.remove();
    document.getElementById('tm-audience-drawer-cta')?.remove();
    document.getElementById('tm-audience-fallback')?.remove();
  }

  function boot() {
    removeLegacySecondaryCtas();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      mountGlobalCta();
      removeLegacySecondaryCtas();
      if (document.getElementById('tm-audience-global-follow') || attempts >= 80) clearInterval(timer);
    }, 125);

    const observer = new MutationObserver(() => {
      mountGlobalCta();
      removeLegacySecondaryCtas();
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
