(() => {
  const COMMAND_IDS = ['EUCOM','CENTCOM','INDOPACOM','AFRICOM','SOUTHCOM','NORTHCOM'];
  const state = { open:false, commandId:null, legacy:null };

  const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'
  }[c]));

  function normalizeCommand(value='') {
    const text=String(value).toUpperCase();
    if (text.includes('INDOPACOM') || /\bPACOM\b/.test(text)) return 'INDOPACOM';
    return COMMAND_IDS.find(id => text.includes(id)) || null;
  }

  function getLegacyCommands() {
    try {
      if (typeof COCOMS !== 'undefined' && Array.isArray(COCOMS)) return COCOMS;
    } catch (_) {}
    try {
      if (Array.isArray(window.COCOMS)) return window.COCOMS;
    } catch (_) {}
    return [];
  }

  function getLegacyCommand(commandId) {
    return getLegacyCommands().find(command => normalizeCommand(command?.id || command?.name || '') === commandId) || null;
  }

  function allLegacyEquipment() {
    const seen = new Set();
    const out = [];
    for (const command of getLegacyCommands()) {
      for (const item of command?.equipment || []) {
        const key = String(item?.n || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }

  function matchEquipment(text='') {
    const hay=String(text).toLowerCase();
    if (!hay) return [];
    return allLegacyEquipment().filter(item => {
      const words=String(item?.n || '').toLowerCase().split(/[\s\-\/\(\)]+/).filter(word => word.length > 3);
      return words.some(word => hay.includes(word));
    });
  }

  function renderEquipmentRefs(text='') {
    const matches=matchEquipment(text);
    if (!matches.length) return '';
    return `<div class="tm-k-parity-eq">${matches.map(item => {
      const label=`${item.flag || ''} ${item.n || 'System'}`.trim();
      const meta=[item.t,item.o].filter(Boolean).join(' · ');
      return item.l
        ? `<a href="${esc(item.l)}" target="_blank" rel="noopener noreferrer"><b>${esc(label)}</b>${meta?`<span>${esc(meta)}</span>`:''}<em>REF ↗</em></a>`
        : `<span><b>${esc(label)}</b>${meta?`<small>${esc(meta)}</small>`:''}</span>`;
    }).join('')}</div>`;
  }

  function renderOrg(org) {
    if (!org) return '<div class="tm-k-parity-empty">No legacy Task Org data for this selection.</div>';
    const components=Array.isArray(org.components) ? org.components : [];
    return `
      <div class="tm-k-parity-hq">${esc(org.flag || '')} ${esc(org.hq || 'TASK ORGANIZATION')}</div>
      ${components.map(component => `
        <section class="tm-k-parity-component">
          <div class="tm-k-parity-component-head"><b>${esc(component.name || 'Component')}</b><span>${esc(component.type || '')}</span></div>
          ${(component.units || []).map(unit => {
            const unitName=unit?.u || 'Unit';
            const subs=Array.isArray(unit?.subs) ? unit.subs : [];
            return `<div class="tm-k-parity-unit">
              <div class="tm-k-parity-unit-name">— ${esc(unitName)}</div>
              ${renderEquipmentRefs([unitName,...subs].join(' '))}
              ${subs.map(sub => `<div class="tm-k-parity-sub">· ${esc(sub)}${renderEquipmentRefs(sub)}</div>`).join('')}
            </div>`;
          }).join('') || '<div class="tm-k-parity-empty">No unit-level entries in the legacy tree.</div>'}
        </section>`).join('')}
      ${org.note ? `<div class="tm-k-parity-note">⚠ ${esc(org.note)}</div>` : ''}`;
  }

  function ensureShelf(drawer) {
    let shelf=drawer.querySelector('#tm-k-parity');
    if (shelf) return shelf;
    const reference=drawer.querySelector('.tm-k-reference');
    if (!reference) return null;
    shelf=document.createElement('section');
    shelf.id='tm-k-parity';
    shelf.className='tm-k-parity';
    shelf.innerHTML=`
      <div class="tm-k-parity-head">
        <div><b>LEGACY OOB / TASK ORG</b><span>SAME DATA AS CURRENT TOP-RIGHT PANEL</span></div>
        <button type="button" class="tm-k-parity-toggle" aria-expanded="false">SHOW OOB</button>
      </div>
      <div class="tm-k-parity-controls" hidden>
        <select class="tm-k-parity-select" aria-label="Legacy Task Org selection"></select>
      </div>
      <div class="tm-k-parity-body" hidden></div>
      <div class="tm-k-parity-source" hidden>PARITY BRIDGE · ORGANIZATION TREE READS THE SAME COCOMS DATASET AS THE LEGACY PANEL · EQUIPMENT REFERENCES USE THE SAME CROSS-COCOM MATCHING LOGIC</div>`;
    reference.insertAdjacentElement('afterend', shelf);

    const toggle=shelf.querySelector('.tm-k-parity-toggle');
    toggle.addEventListener('click', () => {
      state.open=!state.open;
      toggle.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      toggle.textContent=state.open ? 'HIDE OOB' : 'SHOW OOB';
      shelf.querySelector('.tm-k-parity-controls').hidden=!state.open;
      shelf.querySelector('.tm-k-parity-body').hidden=!state.open;
      shelf.querySelector('.tm-k-parity-source').hidden=!state.open;
      if (state.open) renderCurrent(drawer, shelf);
    });
    shelf.querySelector('.tm-k-parity-select').addEventListener('change', () => renderCurrent(drawer, shelf));
    return shelf;
  }

  function syncOptions(drawer, shelf) {
    const commandId=normalizeCommand(drawer.querySelector('#tm-k-command')?.value || '');
    if (!commandId) return false;
    const legacy=getLegacyCommand(commandId);
    state.commandId=commandId;
    state.legacy=legacy;
    const select=shelf.querySelector('.tm-k-parity-select');
    const tabs=Array.isArray(legacy?.orgTabs) ? legacy.orgTabs : [];
    const prior=select.value;
    select.innerHTML=tabs.length
      ? tabs.map(tab => `<option value="${esc(tab.id)}">${esc(`${tab.flag || ''} ${tab.label || tab.id}`.trim())}</option>`).join('')
      : '<option value="">NO LEGACY OOB DATA</option>';
    if (tabs.some(tab => tab.id === prior)) select.value=prior;
    return true;
  }

  function renderCurrent(drawer, shelf) {
    syncOptions(drawer, shelf);
    const select=shelf.querySelector('.tm-k-parity-select');
    const body=shelf.querySelector('.tm-k-parity-body');
    const orgId=select.value;
    const org=state.legacy?.orgs?.[orgId] || null;
    body.innerHTML=renderOrg(org);
  }

  function attach(drawer) {
    if (drawer.dataset.tmTaskOrgParity === '1') return;
    drawer.dataset.tmTaskOrgParity='1';
    const shelf=ensureShelf(drawer);
    if (!shelf) return;
    syncOptions(drawer, shelf);

    drawer.querySelector('#tm-k-command')?.addEventListener('change', () => {
      setTimeout(() => {
        syncOptions(drawer, shelf);
        if (state.open) renderCurrent(drawer, shelf);
      }, 0);
    });
  }

  function boot() {
    const existing=document.querySelector('#tm-knowledge-drawer');
    if (existing) return attach(existing);
    const observer=new MutationObserver(() => {
      const drawer=document.querySelector('#tm-knowledge-drawer');
      if (!drawer) return;
      observer.disconnect();
      attach(drawer);
    });
    observer.observe(document.body, {childList:true,subtree:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
