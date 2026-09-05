(() => {
  const TEXT_REPLACEMENTS = [[/\bINDOPACOM\b/g, 'PACOM'], [/\bUSINDOPACOM\b/g, 'USINDOPACOM']];
  const ignoredTags = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','CODE','PRE']);

  function normalizePacom(root=document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes=[]; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (!node.parentElement || ignoredTags.has(node.parentElement.tagName)) return;
      let text=node.nodeValue;
      TEXT_REPLACEMENTS.forEach(([rx,repl]) => { text=text.replace(rx,repl); });
      if (text !== node.nodeValue) node.nodeValue=text;
    });
  }

  function findFeedWindows() {
    const labels = ['OSINT','RSS','OPEN SOURCE','SOCIAL FEED'];
    const candidates = [...document.querySelectorAll('section,aside,div')].filter(el => {
      const own = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').toUpperCase();
      const heading = el.querySelector(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > .title,:scope > .section-title');
      const text = `${own} ${heading?.textContent || ''}`.toUpperCase();
      return labels.some(label => text.includes(label));
    });
    candidates.slice(0,8).forEach(panel => {
      const descendants=[...panel.querySelectorAll('div,ul,ol')].filter(el => el.children.length >= 3);
      const target=descendants.find(el => el.scrollHeight > 260) || descendants.sort((a,b)=>b.children.length-a.children.length)[0];
      if (target && target.scrollHeight > 220) target.classList.add('tm-feed-window','tm-snap');
    });
  }

  function esc(s='') { return String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }

  async function createExplorer() {
    let data;
    try {
      const r=await fetch('/enhancements/cocom-knowledge.json', {cache:'no-store'});
      if (!r.ok) return;
      data=await r.json();
    } catch (_) { return; }

    const launcher=document.createElement('button');
    launcher.id='tm-knowledge-launcher'; launcher.type='button'; launcher.textContent='COCOM KNOWLEDGE';
    const drawer=document.createElement('aside'); drawer.id='tm-knowledge-drawer'; drawer.setAttribute('aria-label','COCOM knowledge explorer');
    drawer.innerHTML=`<div class="tm-k-head"><div class="tm-k-title">COCOM KNOWLEDGE / TASK ORG</div><button class="tm-k-close" type="button">CLOSE</button></div>
      <div class="tm-k-tools"><select id="tm-k-command"></select><select id="tm-k-type"><option value="all">ALL ACTORS</option><option value="unit">UNITS</option><option value="advisory">ADVISORY / PARTNERS</option><option value="militia">MILITIAS / PROXIES</option><option value="organized-crime">ORGANIZED CRIME</option></select><input id="tm-k-search" placeholder="Search actor / capability" aria-label="Search actor or capability"><select id="tm-k-country"><option value="all">ALL COUNTRIES / NETWORKS</option></select></div>
      <div class="tm-k-focus"></div><div class="tm-k-list"></div><div class="tm-k-note"></div>`;
    document.body.append(launcher,drawer);

    const cmd=drawer.querySelector('#tm-k-command'), type=drawer.querySelector('#tm-k-type'), search=drawer.querySelector('#tm-k-search'), country=drawer.querySelector('#tm-k-country'), list=drawer.querySelector('.tm-k-list'), focus=drawer.querySelector('.tm-k-focus'), note=drawer.querySelector('.tm-k-note');
    const commands=Object.entries(data.commands || {});
    cmd.innerHTML=commands.map(([id,c])=>`<option value="${esc(id)}">${esc(c.displayName || id)}</option>`).join('');

    function syncCountry() {
      const actors=data.commands[cmd.value]?.actors || [];
      const values=[...new Set(actors.map(a=>a.country).filter(Boolean))].sort();
      const prior=country.value;
      country.innerHTML='<option value="all">ALL COUNTRIES / NETWORKS</option>'+values.map(v=>`<option>${esc(v)}</option>`).join('');
      if (values.includes(prior)) country.value=prior;
    }
    function render() {
      const c=data.commands[cmd.value]; if (!c) return;
      focus.textContent=`${c.displayName}: ${c.focus}`;
      note.textContent=`UPDATED ${data.updated} · ${data.disclaimer}`;
      const q=search.value.trim().toLowerCase();
      const actors=(c.actors || []).filter(a => (type.value==='all' || a.type===type.value) && (country.value==='all' || a.country===country.value) && (!q || [a.name,a.country,a.summary,...(a.capabilities||[])].join(' ').toLowerCase().includes(q)));
      list.innerHTML=actors.length ? actors.map(a=>`<article class="tm-k-card"><h3>${esc(a.name)}</h3><div class="tm-k-meta">${esc(a.type)} · ${esc(a.country || '—')}</div><div class="tm-k-summary">${esc(a.summary)}</div><div class="tm-k-tags">${(a.capabilities||[]).map(x=>`<span class="tm-k-tag">${esc(x)}</span>`).join('')}</div><div class="tm-k-sources">${(a.sources||[]).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a>`).join('')}</div></article>`).join('') : '<div class="tm-k-summary">No matching actors.</div>';
    }
    cmd.addEventListener('change',()=>{ syncCountry(); render(); });
    type.addEventListener('change',render); country.addEventListener('change',render); search.addEventListener('input',render);
    launcher.addEventListener('click',()=>drawer.classList.add('tm-open'));
    drawer.querySelector('.tm-k-close').addEventListener('click',()=>drawer.classList.remove('tm-open'));
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') drawer.classList.remove('tm-open'); });
    syncCountry(); render();
  }

  function boot() {
    normalizePacom(); findFeedWindows(); createExplorer();
    let queued=false;
    const observer=new MutationObserver(()=>{
      if (queued) return; queued=true;
      requestAnimationFrame(()=>{ queued=false; normalizePacom(); findFeedWindows(); });
    });
    observer.observe(document.body,{subtree:true,childList:true});
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();