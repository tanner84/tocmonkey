(() => {
  function esc(value='') {
    return String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  }
  function password() {
    try { return typeof adminPassword !== 'undefined' ? adminPassword : ''; }
    catch (_) { return ''; }
  }
  function fmtAge(minutes) {
    if (minutes == null) return '—';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes/60), m = minutes % 60;
    return `${h}h ${m}m`;
  }
  function fmtTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString([], {month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function badge(state='MISSING') {
    const safe = String(state).toUpperCase();
    return `<span class="aio-badge aio-${safe.toLowerCase()}">${esc(safe)}</span>`;
  }
  function install() {
    if (document.getElementById('ai-ops')) return;
    const anchor = document.getElementById('control-room') || document.getElementById('knowledge-review');
    if (!anchor) return;
    const section = document.createElement('div');
    section.id = 'ai-ops';
    section.className = 'section';
    section.innerHTML = `
      <div class="section-title">AI / SITREP OPS <span class="section-count" id="aio-provider">OPENAI</span></div>
      <div class="aio-toolbar">
        <button class="btn-secondary" id="aio-refresh">REFRESH STATUS</button>
        <button class="btn-secondary" id="aio-regenerate-all">REGENERATE ALL SIX</button>
        <span id="aio-model" class="aio-note">MODEL —</span>
        <span id="aio-state" class="aio-note">STATUS —</span>
      </div>
      <div class="aio-callout">Public visitors only read stored reports. These controls are admin-only paid generation.</div>
      <div class="aio-table-wrap"><table class="aio-table">
        <thead><tr><th>AOR</th><th>FRESHNESS</th><th>AGE</th><th>MODE</th><th>GENERATED</th><th>SOURCES</th><th>ACTION</th></tr></thead>
        <tbody id="aio-rows"><tr><td colspan="7">Loading…</td></tr></tbody>
      </table></div>
      <div class="aio-foot" id="aio-foot">OPENAI_API_KEY status will appear here.</div>`;
    anchor.insertAdjacentElement('afterend', section);
    document.getElementById('aio-refresh').addEventListener('click', load);
    document.getElementById('aio-regenerate-all').addEventListener('click', () => regenerate('ALL'));
  }
  async function load() {
    install();
    const pw = password();
    if (!pw) return;
    try {
      const response = await fetch('/.netlify/functions/control-room', {
        headers:{'x-admin-password':pw}, cache:'no-store'
      });
      if (!response.ok) throw new Error(`Control Room API ${response.status}`);
      const data = await response.json();
      const provider = data.aiProvider || {};
      document.getElementById('aio-provider').textContent = provider.name || 'OPENAI';
      document.getElementById('aio-model').textContent = `MODEL ${provider.sitrepModel || provider.defaultModel || '—'}`;
      document.getElementById('aio-state').textContent = `STATUS ${data.status || '—'}`;
      document.getElementById('aio-foot').textContent = provider.configured
        ? 'OPENAI_API_KEY CONFIGURED · scheduled generation runs every 4 hours'
        : 'OPENAI_API_KEY NOT CONFIGURED · source-only fallback remains available until a key is added';
      const rows = data.sitreps || [];
      document.getElementById('aio-rows').innerHTML = rows.length ? rows.map(row => `
        <tr>
          <td>${esc(row.displayName || row.cocom)}</td>
          <td>${badge(row.freshness)}</td>
          <td>${fmtAge(row.ageMinutes)}</td>
          <td>${esc(row.mode || 'LEGACY')}</td>
          <td>${fmtTime(row.generatedAt)}</td>
          <td>${Number(row.sourceItemCount || 0)}</td>
          <td><button class="btn-secondary aio-one" data-cocom="${esc(row.cocom)}">REGENERATE</button></td>
        </tr>`).join('') : '<tr><td colspan="7">No SITREP records found.</td></tr>';
      document.querySelectorAll('.aio-one').forEach(btn => btn.addEventListener('click', () => regenerate(btn.dataset.cocom)));
    } catch (error) {
      document.getElementById('aio-rows').innerHTML = `<tr><td colspan="7">${esc(error.message || 'Status unavailable')}</td></tr>`;
    }
  }
  async function regenerate(cocom) {
    const pw = password();
    if (!pw) return;
    const all = cocom === 'ALL';
    const button = all ? document.getElementById('aio-regenerate-all') : document.querySelector(`.aio-one[data-cocom="${CSS.escape(cocom)}"]`);
    if (button) { button.disabled = true; button.textContent = all ? 'GENERATING…' : 'WORKING…'; }
    document.getElementById('aio-foot').textContent = `${all ? 'ALL SIX AORs' : cocom} generation requested…`;
    try {
      const response = await fetch('/.netlify/functions/sitrep-regenerate', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-admin-password':pw},
        body:JSON.stringify({cocom}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `Regenerate failed (${response.status})`);
      document.getElementById('aio-foot').textContent = `${all ? 'ALL SIX AORs' : cocom} generation completed. Refreshing status…`;
      await load();
    } catch (error) {
      document.getElementById('aio-foot').textContent = error.message || 'Generation failed.';
    } finally {
      if (button) { button.disabled = false; button.textContent = all ? 'REGENERATE ALL SIX' : 'REGENERATE'; }
    }
  }
  function boot() {
    install();
    const adminUi = document.getElementById('admin-ui');
    if (adminUi) {
      const observer = new MutationObserver(() => {
        if (adminUi.style.display === 'block') load();
      });
      observer.observe(adminUi, {attributes:true,attributeFilter:['style']});
      if (adminUi.style.display === 'block') load();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
