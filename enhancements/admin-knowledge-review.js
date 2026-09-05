(() => {
  function esc(value='') {
    return String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  }
  function getAdminPassword() {
    try { return typeof adminPassword !== 'undefined' ? adminPassword : ''; }
    catch (_) { return ''; }
  }
  function fmt(value) {
    if (!value) return '—';
    const d=new Date(value);
    return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString([], {year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function notify(message) {
    try { if (typeof showToast === 'function') return showToast(message); } catch (_) {}
    console.log(message);
  }

  function installSection() {
    if (document.getElementById('knowledge-review')) return;
    const control=document.getElementById('control-room');
    if (!control) return;
    const section=document.createElement('div');
    section.className='section';
    section.id='knowledge-review';
    section.innerHTML=`
      <div class="section-title">KNOWLEDGE UPDATE REVIEW <span class="section-count" id="kr-pending-badge"></span></div>
      <div style="color:var(--tMid);font-size:11px;line-height:1.5;margin-bottom:10px">
        The six-hour source monitor can flag potential changes to actors, organizations, deployments and systems. Nothing here changes a public dossier until you approve it.
      </div>
      <div class="kr-toolbar">
        <button class="btn-secondary" id="kr-refresh">REFRESH QUEUE</button>
        <button class="btn-secondary" id="kr-scan">RUN SOURCE SCAN</button>
        <select id="kr-filter" style="background:var(--deep);border:1px solid var(--border);color:var(--tHi);font-family:var(--mono);font-size:10px;padding:6px 8px">
          <option value="pending">PENDING</option>
          <option value="all">ALL HISTORY</option>
        </select>
        <span class="kr-status" id="kr-runtime">SOURCE MONITOR —</span>
      </div>
      <div class="kr-counts" id="kr-counts"></div>
      <div class="kr-list" id="kr-list"><div class="kr-empty">Loading review queue…</div></div>`;
    control.insertAdjacentElement('afterend', section);

    document.getElementById('kr-refresh').addEventListener('click',()=>loadKnowledgeReview());
    document.getElementById('kr-scan').addEventListener('click',runKnowledgeScan);
    document.getElementById('kr-filter').addEventListener('change',()=>loadKnowledgeReview());
  }

  function renderProposal(p) {
    const confidence=String(p.confidence || 'MEDIUM').toUpperCase();
    const actionable=p.status === 'pending';
    return `<article class="kr-card" data-confidence="${esc(confidence)}">
      <div class="kr-head">
        <div class="kr-head-main">
          <div class="kr-title">${esc(p.commandDisplayName || p.commandId)} · ${esc(p.actorName || p.actorId)}</div>
          <div class="kr-meta">${esc(p.actorType || 'actor').toUpperCase()} · DETECTED ${fmt(p.detectedAt)} · STATUS ${esc(p.status || 'pending').toUpperCase()}</div>
        </div>
        <div class="kr-confidence ${confidence.toLowerCase()}">${esc(confidence)} CONF</div>
      </div>
      <div class="kr-reason">${esc(p.reason || 'Potential profile change detected from monitored reporting.')}</div>
      <div class="kr-source">SOURCE: ${esc(p.source || 'Open source')} · ${fmt(p.sourcePublishedAt)} ${p.url ? `· <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">OPEN SOURCE ↗</a>` : ''}</div>
      <div class="kr-compare">
        <div class="kr-pane"><div class="kr-pane-label">CURRENT APPROVED VALUE</div><div class="kr-pane-text">${esc(p.currentValue || '—')}</div></div>
        <div class="kr-pane"><div class="kr-pane-label">PROPOSED UPDATE NOTE</div><div class="kr-pane-text">${esc(p.newValue || '—')}</div></div>
      </div>
      ${actionable ? `<div class="kr-actions"><button class="kr-action kr-approve" data-action="approve" data-id="${esc(p.id)}">APPROVE → PUBLIC DOSSIER</button><button class="kr-action kr-reject" data-action="reject" data-id="${esc(p.id)}">REJECT</button></div>` : ''}
    </article>`;
  }

  async function loadKnowledgeReview() {
    installSection();
    const list=document.getElementById('kr-list');
    if (!list) return;
    const password=getAdminPassword();
    if (!password) return;
    const filter=document.getElementById('kr-filter')?.value || 'pending';
    list.innerHTML='<div class="kr-empty">Loading review queue…</div>';
    try {
      const r=await fetch(`/.netlify/functions/knowledge-review?status=${encodeURIComponent(filter)}`, {
        headers:{'x-admin-password':password}, cache:'no-store'
      });
      if (!r.ok) throw new Error(`Review queue unavailable (${r.status})`);
      const data=await r.json();
      const counts=data.counts || {pending:0,approved:0,rejected:0};
      document.getElementById('kr-pending-badge').textContent=`${counts.pending || 0} PENDING`;
      document.getElementById('kr-counts').innerHTML=`<span class="kr-chip">PENDING ${counts.pending||0}</span><span class="kr-chip">APPROVED ${counts.approved||0}</span><span class="kr-chip">REJECTED ${counts.rejected||0}</span>`;
      document.getElementById('kr-runtime').textContent=`SOURCE MONITOR ${data.runtimeUpdated ? fmt(data.runtimeUpdated) : 'NOT YET CACHED'}`;
      const proposals=Array.isArray(data.proposals) ? data.proposals : [];
      list.innerHTML=proposals.length ? proposals.map(renderProposal).join('') : '<div class="kr-empty">No proposals in this view.</div>';
      list.querySelectorAll('.kr-action').forEach(btn=>btn.addEventListener('click',()=>reviewProposal(btn.dataset.id,btn.dataset.action)));
    } catch (error) {
      list.innerHTML=`<div class="kr-empty">${esc(error.message)}</div>`;
    }
  }

  async function reviewProposal(id, action) {
    const password=getAdminPassword();
    if (!password) return;
    const buttons=[...document.querySelectorAll(`.kr-action[data-id="${CSS.escape(id)}"]`)];
    buttons.forEach(btn=>btn.disabled=true);
    try {
      const r=await fetch('/.netlify/functions/knowledge-review', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-admin-password':password},
        body:JSON.stringify({id,action})
      });
      const data=await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data.error || `Review action failed (${r.status})`);
      notify(action === 'approve' ? 'Knowledge update approved' : 'Knowledge update rejected');
      await loadKnowledgeReview();
    } catch (error) {
      notify(error.message || 'Review action failed');
      buttons.forEach(btn=>btn.disabled=false);
    }
  }

  async function runKnowledgeScan() {
    const button=document.getElementById('kr-scan');
    if (!button) return;
    button.disabled=true;
    const original=button.textContent;
    button.textContent='SCANNING…';
    try {
      const r=await fetch('/.netlify/functions/knowledge-refresh', {cache:'no-store'});
      const data=await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(data.error || `Source scan failed (${r.status})`);
      notify(data.skipped ? 'Source scan already current' : `Source scan complete · ${data.proposalsAdded || 0} review candidates added`);
      await loadKnowledgeReview();
    } catch (error) {
      notify(error.message || 'Source scan failed');
    } finally {
      button.disabled=false;
      button.textContent=original;
    }
  }

  function boot() {
    installSection();
    const adminUi=document.getElementById('admin-ui');
    if (adminUi) {
      const observer=new MutationObserver(()=>{
        if (adminUi.style.display === 'block') loadKnowledgeReview();
      });
      observer.observe(adminUi,{attributes:true,attributeFilter:['style']});
      if (adminUi.style.display === 'block') loadKnowledgeReview();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
