(() => {
  const TYPE_LABELS = {
    country:'COUNTRIES / TERRITORIES',
    unit:'MILITARY / UNITS',
    adversary:'ADVERSARIES',
    'defense-security':'DEFENSE / SECURITY',
    maritime:'MARITIME / COAST GUARD',
    'security-intelligence':'SECURITY / INTELLIGENCE',
    militia:'MILITIAS / PROXIES',
    'terrorist-insurgent':'INSURGENT / TERRORIST',
    'organized-crime':'ORGANIZED CRIME / TCO'
  };
  const TYPE_SHORT = {
    country:'COUNTRIES', unit:'UNITS', adversary:'ADVERSARIES',
    'defense-security':'DEF/SEC', maritime:'MARITIME',
    'security-intelligence':'SEC/INTEL', militia:'MILITIAS',
    'terrorist-insurgent':'INSURGENT/TERROR', 'organized-crime':'TCO/OC'
  };
  const TYPE_ORDER = ['country','unit','adversary','defense-security','maritime','security-intelligence','militia','terrorist-insurgent','organized-crime'];
  const DISPLAY_REWRITES = [
    ['TERRORIST-INSURGENT','INSURGENT / TERRORIST'],
    ['DEFENSE-SECURITY','DEFENSE / SECURITY'],
    ['SECURITY-INTELLIGENCE','SECURITY / INTELLIGENCE'],
    ['MARITIME','MARITIME / COAST GUARD']
  ];
  const cache = new Map();
  let observer = null;
  let raf = 0;

  const esc = value => String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const label = type => TYPE_LABELS[type] || String(type || '').replace(/-/g,' ').toUpperCase();
  const shortLabel = type => TYPE_SHORT[type] || label(type);

  async function load(commandId) {
    if (!commandId) return { actors:[], coverage:null };
    if (cache.has(commandId)) return cache.get(commandId);
    const promise = fetch(`/.netlify/functions/cocom-knowledge?command=${encodeURIComponent(commandId)}`, { cache:'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Task Org ${r.status}`)))
      .then(data => ({
        actors:Array.isArray(data?.command?.actors) ? data.command.actors : [],
        coverage:data?.coverage || null
      }))
      .catch(() => ({ actors:[], coverage:null }));
    cache.set(commandId, promise);
    return promise;
  }

  function syncTypeOptions(drawer, actors) {
    const select = drawer.querySelector('#tm-k-type');
    if (!select) return;
    const current = select.value || 'all';
    const available = [...new Set(actors.map(actor => actor.type).filter(Boolean))];
    available.sort((a,b) => {
      const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return label(a).localeCompare(label(b));
    });
    const html = '<option value="all">ALL ACTORS</option>' + available
      .map(type => `<option value="${esc(type)}">${esc(label(type))}</option>`).join('');
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = available.includes(current) || current === 'all' ? current : 'all';
  }

  function coveragePrefix(drawer, coverage) {
    if (!coverage) return '';
    const selectedCountry = drawer.querySelector('#tm-k-country')?.value || 'all';
    if (selectedCountry !== 'all') {
      const row = (coverage.countries || []).find(item => item.country === selectedCountry);
      if (row) return `<span>OOB ${esc(row.status)} ${row.score}/${row.total}</span>`;
    }
    const s = coverage.summary || {};
    if (s.countries) return `<span>OOB ${s.comprehensive || 0} COMP · ${s.developed || 0} DEV · ${s.basic || 0} BASIC · ${s.indexOnly || 0} INDEX</span>`;
    return '';
  }

  function syncStats(drawer, actors, coverage) {
    const stats = drawer.querySelector('.tm-k-stats');
    if (!stats || !actors.length) return;
    const counts = new Map();
    actors.forEach(actor => counts.set(actor.type, (counts.get(actor.type) || 0) + 1));
    const list = drawer.querySelector('.tm-k-list');
    const shown = list && !list.hidden ? list.querySelectorAll('.tm-k-card').length : actors.length;
    const ordered = [...counts.keys()].sort((a,b) => {
      const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return shortLabel(a).localeCompare(shortLabel(b));
    });
    const html = coveragePrefix(drawer, coverage) + `<span>${shown}/${actors.length} SHOWN</span>` + ordered
      .map(type => `<span>${counts.get(type)} ${esc(shortLabel(type))}</span>`).join('');
    if (stats.innerHTML !== html) stats.innerHTML = html;
  }

  function rewriteLabels(drawer) {
    drawer.querySelectorAll('.tm-k-meta,.tm-k-breadcrumb span,.tm-k-dossier-meta').forEach(node => {
      let text = node.textContent || '';
      for (const [from,to] of DISPLAY_REWRITES) {
        if (!text.includes(to) && text.includes(from)) text = text.replace(from,to);
      }
      if (text !== node.textContent) node.textContent = text;
    });
  }

  async function sync(drawer, force = false) {
    const commandId = drawer.querySelector('#tm-k-command')?.value;
    if (!commandId) return;
    if (force) cache.delete(commandId);
    const payload = await load(commandId);
    syncTypeOptions(drawer, payload.actors);
    syncStats(drawer, payload.actors, payload.coverage);
    rewriteLabels(drawer);
  }

  function schedule(drawer) {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(async () => {
      const commandId = drawer.querySelector('#tm-k-command')?.value;
      const payload = commandId ? await load(commandId) : { actors:[], coverage:null };
      syncStats(drawer, payload.actors, payload.coverage);
      rewriteLabels(drawer);
    });
  }

  function attach(drawer) {
    if (drawer.dataset.tmTaskOrgScale === '1') return;
    drawer.dataset.tmTaskOrgScale = '1';
    const command = drawer.querySelector('#tm-k-command');
    const type = drawer.querySelector('#tm-k-type');
    const country = drawer.querySelector('#tm-k-country');
    const search = drawer.querySelector('#tm-k-search');
    command?.addEventListener('change', () => setTimeout(() => sync(drawer), 80));
    type?.addEventListener('change', () => setTimeout(() => schedule(drawer), 0));
    country?.addEventListener('change', () => setTimeout(() => schedule(drawer), 0));
    search?.addEventListener('input', () => setTimeout(() => schedule(drawer), 0));
    observer = new MutationObserver(() => schedule(drawer));
    observer.observe(drawer, { childList:true, subtree:true });
    sync(drawer);
  }

  function boot() {
    const existing = document.querySelector('#tm-knowledge-drawer');
    if (existing) return attach(existing);
    const bodyObserver = new MutationObserver(() => {
      const drawer = document.querySelector('#tm-knowledge-drawer');
      if (!drawer) return;
      bodyObserver.disconnect();
      attach(drawer);
    });
    bodyObserver.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
