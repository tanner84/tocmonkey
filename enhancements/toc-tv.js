(() => {
  const CONFIG_URL = '/enhancements/toc-tv.json';

  const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'
  }[c]));

  function videoUrl(id) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }

  function embedUrl(id) {
    return `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1`;
  }

  function preserveLegacyTargets(panel) {
    let tabs=document.getElementById('orgtabs');
    let scroll=document.getElementById('orgscroll');
    if (!tabs) {
      tabs=document.createElement('div');
      tabs.id='orgtabs';
    }
    if (!scroll) {
      scroll=document.createElement('div');
      scroll.id='orgscroll';
    }
    tabs.hidden=true;
    scroll.hidden=true;
    tabs.classList.add('tm-tv-legacy-target');
    scroll.classList.add('tm-tv-legacy-target');
    panel.append(tabs,scroll);
  }

  function setMobileTabLabel() {
    const tabs=document.querySelectorAll('#mobiletabs .mtab');
    if (tabs[1]) tabs[1].textContent='TOC TV';
  }

  function renderFailure(panel, channelUrl) {
    panel.classList.add('tm-tv-panel');
    panel.innerHTML=`
      <div class="ph"><span class="pht">TOC TV</span><span class="phs">VIDEO FEED</span></div>
      <div class="tm-tv-error">
        <b>TOC TV feed unavailable.</b>
        <span>The rest of TOC Monkey is still live.</span>
        ${channelUrl ? `<a href="${esc(channelUrl)}" target="_blank" rel="noopener noreferrer">OPEN ON YOUTUBE ↗</a>` : ''}
      </div>`;
    preserveLegacyTargets(panel);
  }

  function mount(panel, config) {
    const episodes=Array.isArray(config?.episodes) ? config.episodes.filter(x => x?.videoId) : [];
    const liveId=String(config?.live?.videoId || '').trim();
    const liveTitle=String(config?.live?.title || 'TOC MONKEY LIVE');
    const archiveUrl=String(config?.channelSearchUrl || '').trim();
    let selectedId=liveId || String(config?.defaultVideoId || episodes[0]?.videoId || '').trim();
    if (!selectedId) return renderFailure(panel, archiveUrl);

    const selected=episodes.find(ep => ep.videoId === selectedId) || null;
    const selectedTitle=liveId ? liveTitle : (selected?.title || 'TOC MONKEY');

    const episodeOrdinal = id => {
      const index=episodes.findIndex(ep => ep.videoId === id);
      return index >= 0 ? `${String(index + 1).padStart(2,'0')} / ${String(episodes.length).padStart(2,'0')}` : `LIVE / ${String(episodes.length).padStart(2,'0')}`;
    };

    panel.classList.add('tm-tv-panel');
    panel.innerHTML=`
      <div class="ph tm-tv-head">
        <span class="pht">TOC TV</span>
        <span class="phs tm-tv-status ${liveId ? 'is-live' : ''}">${liveId ? '● LIVE' : 'REPLAY'}</span>
      </div>
      <div class="tm-tv-shell">
        <div class="tm-tv-frame-wrap">
          <iframe class="tm-tv-frame" title="${esc(selectedTitle)}" src="${esc(embedUrl(selectedId))}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
        </div>
        <div class="tm-tv-meta">
          <div class="tm-tv-meta-top">
            <span class="tm-tv-kicker">TOC MONKEY // VETERAN TRASH TALK</span>
            <span class="tm-tv-count">${esc(episodeOrdinal(selectedId))}</span>
          </div>
          <div class="tm-tv-title">${esc(selectedTitle)}</div>
        </div>
        <div class="tm-tv-controls">
          <label class="tm-tv-picker">
            <span>EPISODE</span>
            <select class="tm-tv-select" aria-label="Select TOC Monkey episode">
              ${liveId ? `<option value="${esc(liveId)}">● LIVE — ${esc(liveTitle)}</option>` : ''}
              ${episodes.map(ep => `<option value="${esc(ep.videoId)}"${ep.videoId===selectedId?' selected':''}>${esc(ep.title)}</option>`).join('')}
            </select>
          </label>
          <div class="tm-tv-actions">
            <a class="tm-tv-watch" href="${esc(videoUrl(selectedId))}" target="_blank" rel="noopener noreferrer">OPEN ↗</a>
            ${archiveUrl ? `<a class="tm-tv-archive" href="${esc(archiveUrl)}" target="_blank" rel="noopener noreferrer">ARCHIVE ↗</a>` : ''}
          </div>
        </div>
      </div>`;

    preserveLegacyTargets(panel);

    const frame=panel.querySelector('.tm-tv-frame');
    const title=panel.querySelector('.tm-tv-title');
    const count=panel.querySelector('.tm-tv-count');
    const watch=panel.querySelector('.tm-tv-watch');
    const select=panel.querySelector('.tm-tv-select');
    const status=panel.querySelector('.tm-tv-status');

    select?.addEventListener('change', () => {
      const nextId=select.value;
      const next=episodes.find(ep => ep.videoId === nextId);
      const isLive=Boolean(liveId && nextId === liveId);
      const nextTitle=isLive ? liveTitle : (next?.title || 'TOC MONKEY');
      if (frame) {
        frame.src=embedUrl(nextId);
        frame.title=nextTitle;
      }
      if (title) title.textContent=nextTitle;
      if (count) count.textContent=episodeOrdinal(nextId);
      if (watch) watch.href=videoUrl(nextId);
      if (status) {
        status.textContent=isLive ? '● LIVE' : 'REPLAY';
        status.classList.toggle('is-live', isLive);
      }
    });
  }

  async function boot() {
    const panel=document.getElementById('eqpnl');
    if (!panel || panel.dataset.tmTocTv === '1') return;
    panel.dataset.tmTocTv='1';
    setMobileTabLabel();

    try {
      const response=await fetch(CONFIG_URL, {cache:'no-store'});
      if (!response.ok) throw new Error(`TOC TV ${response.status}`);
      mount(panel, await response.json());
    } catch (_) {
      renderFailure(panel, 'https://www.youtube.com/@VeteranTrashTalk/search?query=tocmonkey');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
