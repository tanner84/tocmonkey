(() => {
  const COCOMS = ['EUCOM','CENTCOM','INDOPACOM','AFRICOM','SOUTHCOM','NORTHCOM'];

  const TERMS = {
    EUCOM: [
      'ukraine','ukrainian','kyiv','kiev','russia','russian','moscow','kremlin','nato','europe','european','baltic','poland','germany','france','britain','united kingdom','black sea','crimea','belarus','moldova','georgia','armenia','azerbaijan','balkans','serbia','kosovo','finland','sweden','norway','romania','bulgaria','kaliningrad','kyiv independent','politico europe','euronews','deutsche welle','rferl'
    ],
    CENTCOM: [
      'iran','iranian','tehran','israel','israeli','gaza','hamas','palestin','hezbollah','houthi','yemen','iraq','iraqi','syria','syrian','jordan','lebanon','qatar','saudi','uae','emirates','bahrain','kuwait','oman','afghanistan','pakistan','red sea','hormuz','gulf of aden','bab el mandeb','centcom','irgc','quds force','middle east eye','al monitor','times of israel','jerusalem post','iran international','arab news','gulf news'
    ],
    INDOPACOM: [
      'indo pacific','indo-pacific','pacific','china','chinese','beijing','taiwan','taipei','pla','south china sea','east china sea','philippines','philippine','manila','japan','japanese','tokyo','north korea','pyongyang','south korea','seoul','indonesia','vietnam','india','australia','guam','myanmar','burma','thailand','singapore','malaysia','cambodia','laos','aukus','quad','spratly','paracel','scarborough shoal','second thomas shoal','nikkei asia','south china morning post','rappler','japan times','taiwan news'
    ],
    AFRICOM: [
      'africa','african','sudan','darfur','ethiopia','ethiopian','tigray','somalia','somali','kenya','sahel','mali','niger','burkina','chad','nigeria','mozambique','congo','drc','libya','algeria','morocco','tunisia','south africa','uganda','rwanda','cameroon','al shabaab','al-shabaab','jnim','boko haram','africa corps','horn of africa','gulf of guinea','allafrica','africanews','africa center'
    ],
    SOUTHCOM: [
      'southcom','south america','latin america','caribbean','colombia','colombian','venezuela','venezuelan','brazil','brazilian','argentina','chile','peru','ecuador','bolivia','paraguay','uruguay','guyana','suriname','panama','cuba','haiti','dominican republic','jamaica','tren de aragua','farc','eln','clan del golfo','comando vermelho','pcc','insight crime','mercopress'
    ],
    NORTHCOM: [
      'northcom','norad','alaska','canada','canadian','mexico','mexican','arctic','homeland security','border patrol','cbp','ice raid','ice agents','us immigration','u.s. immigration','fentanyl','sinaloa','cjng','jalisco new generation','gulf cartel','national guard','northern command','arctic today','high north news','mexico news daily'
    ]
  };

  function textOf(el) {
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function norm(value='') {
    return String(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function publicLabel(id) {
    return id === 'INDOPACOM' ? 'PACOM' : id;
  }

  function normalizeCommand(value='') {
    const s = String(value).toUpperCase();
    if (s.includes('INDOPACOM') || /\bPACOM\b/.test(s)) return 'INDOPACOM';
    return COCOMS.find(id => s.includes(id)) || null;
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function activeCommand() {
    // The main AOR heading (e.g. "CENTCOM — U.S. Central Command") is the
    // most reliable state signal and avoids unrelated .active/.selected UI.
    const aorHeading = [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span')]
      .filter(visible)
      .filter(el => el.getBoundingClientRect().top < 230)
      .map(textOf)
      .find(t => /^(EUCOM|CENTCOM|PACOM|INDOPACOM|AFRICOM|SOUTHCOM|NORTHCOM)\s*[—-]\s*U\.S\./i.test(t));
    const headingCommand = normalizeCommand(aorHeading);
    if (headingCommand) return headingCommand;

    const preferred = [...document.querySelectorAll('[aria-selected="true"],.active,.selected,.cocom-active,.tab-active')]
      .filter(visible)
      .filter(el => el.getBoundingClientRect().top < 180);
    for (const el of preferred) {
      const id = normalizeCommand(`${el.getAttribute('data-cocom') || ''} ${el.getAttribute('data-aor') || ''} ${textOf(el)}`);
      if (id) return id;
    }

    const topText = [...document.querySelectorAll('div,span')]
      .filter(visible)
      .filter(el => el.getBoundingClientRect().top < 210)
      .map(textOf)
      .find(t => /\b(EUCOM|CENTCOM|PACOM|INDOPACOM|AFRICOM|SOUTHCOM|NORTHCOM)\s+AOR\b/i.test(t));
    return normalizeCommand(topText) || 'EUCOM';
  }

  function labelElement(label) {
    const wanted = norm(label);
    return [...document.querySelectorAll('h1,h2,h3,h4,h5,div,span,strong')]
      .filter(visible)
      .find(el => {
        const value = norm(textOf(el));
        return value === wanted || (value.startsWith(`${wanted} `) && value.length <= wanted.length + 34);
      }) || null;
  }

  function panelFromLabel(labelEl) {
    if (!labelEl) return null;
    let node = labelEl.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const r = node.getBoundingClientRect();
      if (r.width >= 260 && r.height >= 150) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function rowCandidates(listEl, labelEl) {
    if (!listEl) return [];
    return [...listEl.children].filter(child => {
      if (labelEl && (child === labelEl || child.contains(labelEl))) return false;
      const len = textOf(child).length;
      return len >= 18 && len <= 1800;
    });
  }

  function repeatedList(panel, labelEl) {
    if (!panel) return null;
    const candidates = [panel, ...panel.querySelectorAll('div,ul,ol')]
      .filter(el => !labelEl || !el.isSameNode(labelEl))
      .filter(visible)
      .map(el => {
        const visibleChildren = [...el.children].filter(visible);
        const rows = visibleChildren.filter(child => {
          if (labelEl && (child === labelEl || child.contains(labelEl))) return false;
          const len = textOf(child).length;
          return len >= 18 && len <= 1800;
        });
        const r = el.getBoundingClientRect();
        const avg = rows.length ? rows.reduce((n,row) => n + row.getBoundingClientRect().height, 0) / rows.length : 9999;
        let score = rows.length * 12;
        if (rows.length >= 2 && rows.length <= 100) score += 35;
        if (el.scrollHeight > el.clientHeight + 20) score += 18;
        if (avg >= 32 && avg <= 240) score += 12;
        score -= Math.max(0, r.height - 650) / 50;
        return { el, rows, score };
      })
      .filter(x => x.rows.length >= 2)
      .sort((a,b) => b.score - a.score);
    return candidates[0] || null;
  }

  function hasExplicitCocom(row, cocom) {
    const explicit = `${row.getAttribute('data-cocom') || ''} ${row.getAttribute('data-aor') || ''} ${row.getAttribute('data-cocoms') || ''}`.toUpperCase();
    const any = normalizeCommand(explicit);
    if (!any) return null;
    if (cocom === 'INDOPACOM') return /INDOPACOM|PACOM/.test(explicit);
    return explicit.includes(cocom);
  }

  function matchesCocom(row, cocom) {
    const explicit = hasExplicitCocom(row, cocom);
    if (explicit !== null) return explicit;
    const text = ` ${norm(textOf(row))} `;
    const terms = TERMS[cocom] || [];
    return terms.some(term => text.includes(` ${norm(term)} `) || text.includes(norm(term)));
  }

  function updateSigactCounter(panel, cocom, visibleCount) {
    let counter = panel.querySelector('[data-tm-sigact-counter="1"]');
    if (!counter) {
      counter = [...panel.querySelectorAll('div,span')]
        .filter(el => el.children.length === 0)
        .find(el => /(?:LIVE\s*(?:·|\||-)\s*\d+\s*ITEMS?|(?:EUCOM|CENTCOM|PACOM|INDOPACOM|AFRICOM|SOUTHCOM|NORTHCOM)\s*(?:·|\||-)\s*FILTERED\s*(?:·|\||-)\s*\d+\s*ITEMS?)/i.test(textOf(el))) || null;
    }
    if (!counter) return;
    counter.dataset.tmSigactCounter = '1';
    if (!counter.dataset.tmOriginal) counter.dataset.tmOriginal = textOf(counter);
    counter.textContent = `${publicLabel(cocom)} · FILTERED · ${visibleCount} ITEMS`;
  }

  function filterSigacts() {
    const label = labelElement('SIGACTS');
    const panel = panelFromLabel(label);
    if (!panel) return false;
    panel.classList.add('tm-sigacts-scoped');

    // Reuse the previously identified list when possible. Crucially, evaluate
    // all of its rows, including rows hidden by the prior COCOM filter.
    const existingList = panel.querySelector('.tm-sigact-list');
    const list = existingList
      ? { el:existingList, rows:rowCandidates(existingList, label) }
      : repeatedList(panel, label);
    if (!list) return false;
    list.el.classList.add('tm-sigact-list');

    const rows = rowCandidates(list.el, label);
    if (!rows.length) return false;

    const cocom = activeCommand();
    let shown = 0;
    let filtered = 0;
    for (const row of rows) {
      row.classList.add('tm-sigact-row');
      const keep = matchesCocom(row, cocom);
      row.dataset.tmAorMatch = keep ? 'true' : 'false';
      if (keep) shown++;
      else filtered++;
    }

    panel.dataset.tmCocom = publicLabel(cocom);
    panel.dataset.tmFiltered = String(filtered);
    updateSigactCounter(panel, cocom, shown);
    return true;
  }

  function markOsintDensity() {
    const label = labelElement('OSINT / RSS');
    const panel = panelFromLabel(label);
    if (!panel) return false;
    panel.classList.add('tm-osint-dense');
    const list = repeatedList(panel, label);
    if (!list) return false;
    list.el.classList.add('tm-osint-dense-list');
    list.rows.slice(0,80).forEach(row => row.classList.add('tm-osint-dense-card'));
    return true;
  }

  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      filterSigacts();
      markOsintDensity();
    });
  }

  function boot() {
    refresh();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      refresh();
      if (attempts >= 80) clearInterval(timer);
    }, 125);

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','aria-selected','data-cocom','data-aor'] });

    document.addEventListener('click', event => {
      const command = normalizeCommand(textOf(event.target?.closest?.('button,a,[role="tab"],div') || event.target));
      if (command) setTimeout(refresh, 25);
    }, true);
    window.addEventListener('resize', refresh, { passive:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
