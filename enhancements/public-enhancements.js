(() => {
  const COMMAND_IDS = ['EUCOM','CENTCOM','INDOPACOM','AFRICOM','SOUTHCOM','NORTHCOM'];
  const ignoredTags = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','CODE','PRE']);
  const state = { manifest:null, commandId:null, payload:null, actorId:null, cache:new Map() };

  function esc(value='') {
    return String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString([], {year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function labelType(type='') {
    return ({unit:'UNIT',adversary:'ADVERSARY',militia:'MILITIA / PROXY','organized-crime':'ORGANIZED CRIME'})[type] || String(type).toUpperCase();
  }
  function publicCommandLabel(id='') { return id === 'INDOPACOM' ? 'PACOM' : id; }
  function normalizeCommand(value='') {
    const text=String(value).toUpperCase();
    if (text.includes('INDOPACOM') || /\bPACOM\b/.test(text)) return 'INDOPACOM';
    return COMMAND_IDS.find(id => text.includes(id)) || null;
  }

  function normalizePacom(root=document.body) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (!root.parentElement || ignoredTags.has(root.parentElement.tagName)) return;
      root.nodeValue = root.nodeValue.replace(/\bINDOPACOM\b/g, 'PACOM');
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const walker=document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node=walker.currentNode;
      if (!node.parentElement || ignoredTags.has(node.parentElement.tagName)) continue;
      const next=node.nodeValue.replace(/\bINDOPACOM\b/g, 'PACOM');
      if (next !== node.nodeValue) node.nodeValue=next;
    }
  }

  function inferActiveCommand() {
    const preferred=[...document.querySelectorAll('[aria-selected="true"],.active,.selected,.cocom-active,.tab-active')];
    for (const el of preferred) {
      const id=normalizeCommand(el.textContent || el.getAttribute('data-cocom') || el.getAttribute('data-aor') || '');
      if (id) return id;
    }
    return state.commandId || 'EUCOM';
  }

  function feedScore(el) {
    const children=[...el.children];
    if (children.length < 2) return -1;
    const links=el.querySelectorAll('a').length;
    const cards=el.querySelectorAll('article,li,[class*="item"],[class*="post"],[class*="feed"]').length;
    const scrollBonus=el.scrollHeight > el.clientHeight + 30 ? 20 : 0;
    return Math.min(children.length,12)*6 + Math.min(links,20)*2 + Math.min(cards,20)*3 + scrollBonus;
  }

  function findFeedWindows() {
    const labels=['OSINT','RSS','OPEN SOURCE','SOCIAL FEED','INTEL FEED'];
    const panels=[...document.querySelectorAll('section,aside,div')].filter(el => {
      if (el.id === 'tm-knowledge-drawer' || el.closest('#tm-knowledge-drawer')) return false;
      const heading=el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > .title,:scope > .section-title,:scope > [class*="header"]');
      const direct=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ');
      const text=`${direct} ${heading?.textContent || ''}`.toUpperCase();
      return labels.some(label => text.includes(label));
    });

    panels.slice(0,10).forEach(panel => {
      const candidates=[panel,...panel.querySelectorAll('div,ul,ol')].slice(0,80)
        .filter(el => !el.closest('#tm-knowledge-drawer'));
      const ranked=candidates.map(el=>({el,score:feedScore(el)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
      const target=ranked[0]?.el;
      if (!target || target.classList.contains('tm-feed-window')) return;
      target.classList.add('tm-feed-window','tm-snap');
      const directChildren=target.children.length || 1;
      if (target.scrollHeight / directChildren > 105) target.classList.add('tm-feed-compact');
    });
  }

  async function loadManifest() {
    if (state.manifest) return state.manifest;
    const r=await fetch('/enhancements/cocom-knowledge.json', {cache:'no-store'});
    if (!r.ok) throw new Error('Knowledge manifest unavailable');
    state.manifest=await r.json();
    return state.manifest;
  }

  async function loadCommand(commandId) {
    if (state.cache.has(commandId)) return state.cache.get(commandId);
    const manifest=await loadManifest();
    let payload=null;
    try {
      const r=await fetch(`/.netlify/functions/cocom-knowledge?command=${encodeURIComponent(commandId)}`, {cache:'no-store'});
      if (r.ok) payload=await r.json();
    } catch (_) {}
    if (!payload?.command) {
      const file=manifest.commands?.[commandId]?.file;
      if (!file) throw new Error('Unknown COCOM');
      const r=await fetch(file, {cache:'no-store'});
      if (!r.ok) throw new Error('COCOM data unavailable');
      payload={
        version:manifest.version,
        updated:manifest.updated,
        runtimeUpdated:null,
        disclaimer:manifest.disclaimer,
        methodology:manifest.methodology,
        command:await r.json()
      };
    }
    state.cache.set(commandId,payload);
    return payload;
  }

  function actorById(id) {
    return state.payload?.command?.actors?.find(actor => actor.id === id) || null;
  }

  function createExplorerShell() {
    const launcher=document.createElement('button');
    launcher.id='tm-knowledge-launcher';
    launcher.type='button';
    launcher.textContent='TASK ORG / AO';
    launcher.setAttribute('aria-controls','tm-knowledge-drawer');

    const drawer=document.createElement('aside');
    drawer.id='tm-knowledge-drawer';
    drawer.setAttribute('aria-label','COCOM task organization and actor explorer');
    drawer.innerHTML=`
      <div class="tm-k-head">
        <div><div class="tm-k-title">TASK ORG / AO KNOWLEDGE</div><div class="tm-k-subtitle">OPEN-SOURCE ACTOR + SYSTEM REFERENCE</div></div>
        <button class="tm-k-close" type="button">CLOSE</button>
      </div>
      <div class="tm-k-tools">
        <select id="tm-k-command" aria-label="Combatant command"></select>
        <select id="tm-k-type" aria-label="Actor type">
          <option value="all">ALL ACTORS</option>
          <option value="unit">UNITS</option>
          <option value="adversary">ADVERSARIES</option>
          <option value="militia">MILITIAS / PROXIES</option>
          <option value="organized-crime">ORGANIZED CRIME</option>
        </select>
        <select id="tm-k-country" aria-label="Country or network"><option value="all">ALL COUNTRIES / NETWORKS</option></select>
        <input id="tm-k-search" placeholder="Search actor / system / capability" aria-label="Search actors, systems or capabilities">
      </div>
      <div class="tm-k-focus"></div>
      <div class="tm-k-stats"></div>
      <div class="tm-k-reference"></div>
      <div class="tm-k-list"></div>
      <div class="tm-k-detail" hidden></div>
      <div class="tm-k-note"></div>`;
    document.body.append(launcher,drawer);
    return {launcher,drawer};
  }

  async function createExplorer() {
    let manifest;
    try { manifest=await loadManifest(); }
    catch (_) { return; }

    const {launcher,drawer}=createExplorerShell();
    const cmd=drawer.querySelector('#tm-k-command');
    const type=drawer.querySelector('#tm-k-type');
    const country=drawer.querySelector('#tm-k-country');
    const search=drawer.querySelector('#tm-k-search');
    const focus=drawer.querySelector('.tm-k-focus');
    const stats=drawer.querySelector('.tm-k-stats');
    const reference=drawer.querySelector('.tm-k-reference');
    const list=drawer.querySelector('.tm-k-list');
    const detail=drawer.querySelector('.tm-k-detail');
    const note=drawer.querySelector('.tm-k-note');

    const commands=Object.entries(manifest.commands || {});
    cmd.innerHTML=commands.map(([id,c])=>`<option value="${esc(id)}">${esc(c.displayName || publicCommandLabel(id))}</option>`).join('');

    function setLoading(message='LOADING AO DATA…') {
      list.hidden=false;
      detail.hidden=true;
      list.innerHTML=`<div class="tm-k-loading">${esc(message)}</div>`;
    }

    function syncCountry() {
      const actors=state.payload?.command?.actors || [];
      const values=[...new Set(actors.map(a=>a.country).filter(Boolean))].sort();
      const prior=country.value;
      country.innerHTML='<option value="all">ALL COUNTRIES / NETWORKS</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
      if (values.includes(prior)) country.value=prior;
    }

    function renderReferenceShelf() {
      const refs=state.payload?.command?.references || [];
      reference.innerHTML=refs.length ? `<div class="tm-k-ref-label">AOR REFERENCE SHELF</div><div class="tm-k-ref-links">${refs.map(r=>`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)} ↗</a>`).join('')}</div>` : '';
    }

    function filteredActors() {
      const q=search.value.trim().toLowerCase();
      return (state.payload?.command?.actors || []).filter(a => {
        if (type.value !== 'all' && a.type !== type.value) return false;
        if (country.value !== 'all' && a.country !== country.value) return false;
        if (!q) return true;
        const systems=(a.systems || []).map(s=>`${s.name || ''} ${s.category || ''}`);
        const relationships=(a.relationships || []).map(r=>r.kind || '');
        const hay=[a.name,a.country,a.summary,...(a.capabilities||[]),...systems,...relationships,...(a.keywords||[])].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    function renderStats(actors) {
      const all=state.payload?.command?.actors || [];
      const counts={unit:0,adversary:0,militia:0,'organized-crime':0};
      all.forEach(a=>{ if (counts[a.type] !== undefined) counts[a.type]++; });
      stats.innerHTML=`<span>${actors.length}/${all.length} SHOWN</span><span>${counts.unit} UNITS</span><span>${counts.adversary} ADVERSARIES</span><span>${counts.militia} MILITIAS</span><span>${counts['organized-crime']} TCO/OC</span>`;
    }

    function renderList() {
      state.actorId=null;
      detail.hidden=true;
      list.hidden=false;
      const c=state.payload?.command;
      if (!c) return;
      focus.textContent=`${c.displayName || publicCommandLabel(state.commandId)} — ${c.focus || ''}`;
      renderReferenceShelf();
      const actors=filteredActors();
      renderStats(actors);
      list.innerHTML=actors.length ? actors.map(a=>{
        const signalCount=(a.recentSignals || []).length;
        const systemNames=(a.systems || []).slice(0,3).map(s=>s.name).filter(Boolean);
        return `<article class="tm-k-card" data-actor="${esc(a.id)}">
          <div class="tm-k-card-top"><div><h3>${esc(a.name)}</h3><div class="tm-k-meta">${esc(labelType(a.type))} · ${esc(a.country || '—')}</div></div><button class="tm-k-open" type="button" data-id="${esc(a.id)}">OPEN DOSSIER</button></div>
          <div class="tm-k-summary">${esc(a.summary)}</div>
          <div class="tm-k-tags">${(a.capabilities||[]).slice(0,5).map(x=>`<span class="tm-k-tag">${esc(x)}</span>`).join('')}</div>
          ${systemNames.length ? `<div class="tm-k-card-systems"><b>SYSTEMS:</b> ${systemNames.map(esc).join(' · ')}${(a.systems||[]).length>3?' · …':''}</div>` : ''}
          <div class="tm-k-card-foot"><span>${(a.sources||[]).length} SOURCES</span><span>${(a.relationships||[]).length} RELATIONSHIPS</span><span class="${signalCount?'tm-live':''}">${signalCount} RECENT SIGNALS</span></div>
        </article>`;
      }).join('') : '<div class="tm-k-empty">No matching actors.</div>';
      list.querySelectorAll('.tm-k-open').forEach(btn=>btn.addEventListener('click',()=>renderDetail(btn.dataset.id)));
    }

    function renderSystem(system) {
      const link=system.url ? `<a href="${esc(system.url)}" target="_blank" rel="noopener noreferrer">SYSTEM REFERENCE ↗</a>` : '';
      return `<div class="tm-k-system"><div><b>${esc(system.name || 'System')}</b>${system.category?`<span>${esc(system.category)}</span>`:''}</div>${system.note?`<p>${esc(system.note)}</p>`:''}${link}</div>`;
    }

    function renderRelationship(rel) {
      const target=actorById(rel.target);
      if (target) return `<button class="tm-k-related" type="button" data-id="${esc(target.id)}"><span>${esc(rel.kind || 'related')}</span><b>${esc(target.name)}</b></button>`;
      return `<div class="tm-k-related tm-k-related-static"><span>${esc(rel.kind || 'related')}</span><b>${esc(rel.target || 'External actor')}</b></div>`;
    }

    function renderSignal(signal) {
      const title=signal.title || signal.summary || 'Recent reporting';
      const source=signal.source ? ` · ${esc(signal.source)}` : '';
      const body=signal.summary ? `<p>${esc(signal.summary)}</p>` : '';
      return `<article class="tm-k-signal"><a href="${esc(signal.url)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>${body}<div>${fmtDate(signal.pubDate)}${source}</div></article>`;
    }

    function renderDetail(id) {
      const actor=actorById(id);
      if (!actor) return;
      state.actorId=id;
      list.hidden=true;
      detail.hidden=false;
      const systems=actor.systems || [];
      const relationships=actor.relationships || [];
      const signals=actor.recentSignals || [];
      detail.innerHTML=`
        <div class="tm-k-breadcrumb"><button class="tm-k-back" type="button">← BACK TO ${esc(state.payload.command.displayName || publicCommandLabel(state.commandId))}</button><span>${esc(labelType(actor.type))}</span></div>
        <article class="tm-k-dossier">
          <h2>${esc(actor.name)}</h2>
          <div class="tm-k-dossier-meta">${esc(actor.country || '—')} · ${esc(labelType(actor.type))}</div>
          <p class="tm-k-dossier-summary">${esc(actor.summary)}</p>
          <section><h4>CAPABILITIES</h4><div class="tm-k-tags">${(actor.capabilities||[]).map(x=>`<button class="tm-k-tag tm-k-search-tag" type="button" data-search="${esc(x)}">${esc(x)}</button>`).join('')}</div></section>
          <section><h4>SYSTEMS / EQUIPMENT</h4>${systems.length?`<div class="tm-k-systems">${systems.map(renderSystem).join('')}</div>`:'<div class="tm-k-muted">No system-level entries added yet.</div>'}</section>
          <section><h4>RELATIONSHIPS</h4>${relationships.length?`<div class="tm-k-related-grid">${relationships.map(renderRelationship).join('')}</div>`:'<div class="tm-k-muted">No cross-links recorded.</div>'}</section>
          <section><h4>RECENT OPEN-SOURCE REPORTING</h4>${signals.length?`<div class="tm-k-signals">${signals.map(renderSignal).join('')}</div>`:'<div class="tm-k-muted">No matching items in the current seven-day RSS signal window.</div>'}</section>
          <section><h4>SOURCE SHELF</h4><div class="tm-k-dossier-sources">${(actor.sources||[]).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a>`).join('') || '<span class="tm-k-muted">No sources recorded.</span>'}</div></section>
        </article>`;
      detail.querySelector('.tm-k-back').addEventListener('click',renderList);
      detail.querySelectorAll('.tm-k-related[data-id]').forEach(btn=>btn.addEventListener('click',()=>renderDetail(btn.dataset.id)));
      detail.querySelectorAll('.tm-k-search-tag').forEach(btn=>btn.addEventListener('click',()=>{ search.value=btn.dataset.search || ''; type.value='all'; country.value='all'; renderList(); }));
      detail.scrollTop=0;
    }

    function renderFooter() {
      const runtime=state.payload?.runtimeUpdated;
      note.innerHTML=`BASELINE REVIEWED ${esc(state.payload?.updated || manifest.updated || '—')} · LIVE SIGNALS ${runtime ? fmtDate(runtime) : 'NOT YET CACHED'}<br>${esc(state.payload?.disclaimer || manifest.disclaimer || '')}`;
    }

    async function selectCommand(commandId, preserveFilters=false) {
      state.commandId=commandId;
      cmd.value=commandId;
      state.actorId=null;
      setLoading();
      try {
        state.payload=await loadCommand(commandId);
        if (!preserveFilters) { type.value='all'; search.value=''; country.value='all'; }
        syncCountry();
        renderFooter();
        renderList();
      } catch (error) {
        list.innerHTML=`<div class="tm-k-empty">${esc(error.message || 'Unable to load AO data.')}</div>`;
      }
    }

    cmd.addEventListener('change',()=>selectCommand(cmd.value));
    type.addEventListener('change',renderList);
    country.addEventListener('change',renderList);
    search.addEventListener('input',renderList);
    launcher.addEventListener('click',async()=>{
      drawer.classList.add('tm-open');
      const active=inferActiveCommand();
      if (!state.payload || active !== state.commandId) await selectCommand(active);
    });
    drawer.querySelector('.tm-k-close').addEventListener('click',()=>drawer.classList.remove('tm-open'));
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') drawer.classList.remove('tm-open'); });

    await selectCommand(inferActiveCommand());
  }

  function boot() {
    normalizePacom(document.body);
    findFeedWindows();
    createExplorer();
    let feedTimer=null;
    const observer=new MutationObserver(mutations=>{
      for (const mutation of mutations) mutation.addedNodes.forEach(node=>normalizePacom(node));
      clearTimeout(feedTimer);
      feedTimer=setTimeout(findFeedWindows,250);
    });
    observer.observe(document.body,{subtree:true,childList:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
