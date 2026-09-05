(() => {
  function esc(value='') {
    return String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  }
  function getAdminPassword() {
    try { return typeof adminPassword !== 'undefined' ? adminPassword : ''; }
    catch (_) { return ''; }
  }
  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString([], {year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function installSection() {
    if (document.getElementById('audience-growth')) return;
    const anchor = document.getElementById('knowledge-review') || document.getElementById('control-room');
    if (!anchor) return;
    const section = document.createElement('div');
    section.className = 'section';
    section.id = 'audience-growth';
    section.innerHTML = `
      <div class="section-title">GROWTH / AUDIENCE <span class="section-count">PHASE 1</span></div>
      <div class="ag-toolbar">
        <button class="btn-secondary" id="ag-refresh">REFRESH METRICS</button>
        <a class="btn-secondary" id="ag-substack" href="https://substack.com/@tocmonkey" target="_blank" rel="noopener noreferrer" style="text-decoration:none">OPEN SUBSTACK ↗</a>
        <span class="ag-note">TOC Monkey measures outbound subscribe intent; Substack owns actual subscriber records.</span>
      </div>
      <div class="ag-grid" id="ag-grid">
        <div class="ag-card"><div class="ag-label">SUBSCRIBE CLICKS · 30D</div><div class="ag-value">—</div></div>
        <div class="ag-card"><div class="ag-label">SUBSCRIBE CLICKS · 7D</div><div class="ag-value">—</div></div>
        <div class="ag-card"><div class="ag-label">SUBSCRIBE CLICKS · ALL</div><div class="ag-value">—</div></div>
        <div class="ag-card"><div class="ag-label">LAST INTENT</div><div class="ag-value" style="font-size:13px">—</div></div>
      </div>
      <div class="ag-columns">
        <div class="ag-panel"><h4>SUBSCRIBE INTENT BY PLACEMENT</h4><div id="ag-sources"><div class="ag-empty">Loading…</div></div></div>
        <div class="ag-panel"><h4>SUBSCRIBE INTENT BY AOR</h4><div id="ag-cocoms"><div class="ag-empty">Loading…</div></div></div>
      </div>
      <div class="ag-foot" id="ag-foot">This is first-party funnel telemetry only. It intentionally stores aggregate counts, not visitor emails, names, or IP addresses.</div>`;
    anchor.insertAdjacentElement('afterend', section);
    document.getElementById('ag-refresh').addEventListener('click', loadAudienceMetrics);
  }
  function rows(items=[]) {
    if (!items.length) return '<div class="ag-empty">No tracked clicks yet.</div>';
    const max = Math.max(...items.map(item => Number(item.count || 0)), 1);
    return items.slice(0,12).map(item => {
      const pct = Math.max(2, Math.round((Number(item.count || 0) / max) * 100));
      return `<div class="ag-row"><div class="ag-name">${esc(item.key)}</div><div class="ag-track"><div class="ag-fill" style="width:${pct}%"></div></div><div class="ag-count">${Number(item.count || 0).toLocaleString()}</div></div>`;
    }).join('');
  }
  async function loadAudienceMetrics() {
    installSection();
    const password = getAdminPassword();
    if (!password) return;
    try {
      const r = await fetch('/.netlify/functions/audience-metrics', {
        headers:{'x-admin-password':password}, cache:'no-store'
      });
      if (!r.ok) throw new Error(`Audience metrics unavailable (${r.status})`);
      const data = await r.json();
      const clicks = data.clicks || {};
      const cards = document.querySelectorAll('#ag-grid .ag-card');
      if (cards[0]) cards[0].querySelector('.ag-value').textContent = Number(clicks.last30Days || 0).toLocaleString();
      if (cards[1]) cards[1].querySelector('.ag-value').textContent = Number(clicks.last7Days || 0).toLocaleString();
      if (cards[2]) cards[2].querySelector('.ag-value').textContent = Number(clicks.allTime || 0).toLocaleString();
      if (cards[3]) cards[3].querySelector('.ag-value').textContent = fmtDate(clicks.lastClickAt);
      document.getElementById('ag-sources').innerHTML = rows(clicks.bySource || []);
      document.getElementById('ag-cocoms').innerHTML = rows(clicks.byCocom || []);
      document.getElementById('ag-substack').href = data.substack?.profileUrl || 'https://substack.com/@tocmonkey';
      document.getElementById('ag-foot').innerHTML = `${esc(data.note || '')}<br>LAST REFRESH ${fmtDate(data.generatedAt)} · Actual free/paid subscriber totals remain authoritative in <a class="ag-link" href="${esc(data.substack?.profileUrl || 'https://substack.com/@tocmonkey')}" target="_blank" rel="noopener noreferrer">Substack ↗</a>.`;
    } catch (error) {
      document.getElementById('ag-sources').innerHTML = `<div class="ag-empty">${esc(error.message || 'Unable to load audience metrics.')}</div>`;
      document.getElementById('ag-cocoms').innerHTML = '<div class="ag-empty">—</div>';
    }
  }
  function boot() {
    installSection();
    const adminUi = document.getElementById('admin-ui');
    if (adminUi) {
      const observer = new MutationObserver(() => {
        if (adminUi.style.display === 'block') loadAudienceMetrics();
      });
      observer.observe(adminUi, {attributes:true,attributeFilter:['style']});
      if (adminUi.style.display === 'block') loadAudienceMetrics();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
