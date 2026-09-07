(() => {
  const COCOMS = ['EUCOM','CENTCOM','INDOPACOM','AFRICOM','SOUTHCOM','NORTHCOM'];

  // Geographic / actor anchors only. These are intentionally stricter than the
  // general RSS keyword shelf: a secondary mention of Gaza should not turn a
  // Kosovo or Bosnia story into a CENTCOM SIGACT.
  const AOR_TERMS = {
    EUCOM: [
      'europe','european','ukraine','ukrainian','kyiv','russia','russian','moscow','belarus','moldova',
      'poland','polish','germany','german','france','french','britain','british','italy','italian','spain','spanish',
      'portugal','baltic','estonia','latvia','lithuania','finland','sweden','norway','denmark','netherlands','belgium',
      'romania','bulgaria','hungary','slovakia','slovenia','croatia','bosnia','serbia','kosovo','albania','montenegro',
      'north macedonia','greece','greek','turkey','turkiye','türkiye','georgia','armenia','azerbaijan','nato','black sea','crimea'
    ],
    CENTCOM: [
      'iran','iranian','iraq','iraqi','israel','israeli','gaza','palestine','palestinian','west bank','lebanon','lebanese',
      'syria','syrian','jordan','jordanian','saudi','yemen','yemeni','oman','omani','qatar','qatari','bahrain','kuwait',
      'emirates','emirati','afghanistan','afghan','pakistan','pakistani','kazakhstan','kyrgyzstan','tajikistan','turkmenistan',
      'uzbekistan','red sea','hormuz','gulf of aden','hamas','hezbollah','houthi','houthis','irgc','quds force'
    ],
    INDOPACOM: [
      'indo pacific','indo-pacific','china','chinese','beijing','taiwan','taiwanese','japan','japanese','tokyo',
      'north korea','south korea','korean','pyongyang','seoul','india','indian','australia','australian','new zealand',
      'philippines','philippine','manila','indonesia','indonesian','vietnam','vietnamese','thailand','thai','malaysia',
      'malaysian','singapore','cambodia','laos','myanmar','burma','bangladesh','sri lanka','nepal','mongolia','guam',
      'south china sea','east china sea','spratly','paracel','scarborough shoal','second thomas shoal','aukus'
    ],
    AFRICOM: [
      'africa','african','algeria','morocco','tunisia','libya','sudan','south sudan','ethiopia','eritrea','djibouti','somalia',
      'kenya','uganda','rwanda','burundi','congo','drc','democratic republic of congo','nigeria','niger','mali','mauritania',
      'senegal','gambia','guinea','sierra leone','liberia','ghana','togo','benin','burkina faso','chad','cameroon',
      'central african republic','gabon','angola','namibia','botswana','zimbabwe','zambia','mozambique','malawi','tanzania',
      'south africa','lesotho','eswatini','madagascar','sahel','darfur','tigray','al shabaab','al-shabaab','jnim','boko haram'
    ],
    SOUTHCOM: [
      'south america','latin america','caribbean','colombia','colombian','venezuela','venezuelan','brazil','brazilian',
      'argentina','argentine','chile','chilean','peru','peruvian','ecuador','ecuadorian','bolivia','paraguay','uruguay',
      'guyana','suriname','panama','cuba','haiti','haitian','dominican republic','jamaica','belize','guatemala','honduras',
      'el salvador','nicaragua','costa rica','tren de aragua','farc','eln','clan del golfo','comando vermelho','pcc'
    ],
    NORTHCOM: [
      'northcom','norad','canada','canadian','mexico','mexican','greenland','alaska','bahamas','arctic','sinaloa','cjng',
      'jalisco new generation','gulf cartel','cartel del golfo','cartel del noreste','nueva familia michoacana','fentanyl'
    ]
  };

  function clean(value='') {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function norm(value='') {
    return clean(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function publicLabel(id) {
    return id === 'INDOPACOM' ? 'PACOM' : id;
  }

  function activeCocom() {
    const tab = document.querySelector('#tabbar .ctab.on, .ctab.on');
    const text = clean(tab?.textContent || '').toUpperCase();
    if (/INDOPACOM|PACOM/.test(text)) return 'INDOPACOM';
    const direct = COCOMS.find(id => text.includes(id));
    if (direct) return direct;

    const heading = clean(document.querySelector('#mappnl .phs, #mappnl .pht')?.textContent || '').toUpperCase();
    if (/INDOPACOM|PACOM/.test(heading)) return 'INDOPACOM';
    return COCOMS.find(id => heading.includes(id)) || 'EUCOM';
  }

  function hasTerm(text, term) {
    const hay = ` ${norm(text)} `;
    const needle = norm(term);
    return needle && (hay.includes(` ${needle} `) || (needle.includes(' ') && hay.includes(needle)));
  }

  function hitCount(text, terms=[]) {
    let hits = 0;
    for (const term of terms) if (hasTerm(text, term)) hits++;
    return hits;
  }

  function otherHits(text, cocom) {
    let hits = 0;
    for (const id of COCOMS) {
      if (id === cocom) continue;
      hits += hitCount(text, AOR_TERMS[id]);
    }
    return hits;
  }

  function relevant(row, cocom) {
    if(row.dataset.tmPolicy==='reporting-v1')return row.dataset.cocom===cocom;
    const headline = clean(row.querySelector('.sigloc')?.textContent || '');
    const summary = clean(row.querySelector('.sigsummary')?.textContent || '');

    const targetHeadline = hitCount(headline, AOR_TERMS[cocom]);
    const otherHeadline = otherHits(headline, cocom);
    const targetSummary = hitCount(summary, AOR_TERMS[cocom]);
    const otherSummary = otherHits(summary, cocom);

    // Primary-headline geography wins. If the headline is cross-AOR, only keep
    // it when the selected AOR clearly dominates rather than tying 1-for-1.
    if (targetHeadline > 0) {
      if (otherHeadline === 0) return true;
      return targetHeadline > otherHeadline;
    }

    // A headline anchored in another AOR is not rescued by a secondary mention
    // in the description (the exact Kosovo/Gaza and Bosnia/Israel failure mode).
    if (otherHeadline > 0) return false;

    // Generic headline: require selected-AOR context in the description and no
    // competing-AOR geography there.
    return targetSummary > 0 && otherSummary === 0;
  }

  function repairStructure(list) {
    // If encoded RSS markup was re-parsed as HTML, later .sigact nodes can wind
    // up nested inside an earlier description. Pull every row back to the real
    // list before flattening text-only description surfaces.
    const rows = [...list.querySelectorAll('.sigact')];
    for (const row of rows) {
      if (row.parentElement !== list) list.appendChild(row);
    }

    list.querySelectorAll('style,script,iframe,object,embed').forEach(node => node.remove());

    for (const row of [...list.children].filter(el => el.classList.contains('sigact'))) {
      for (const selector of ['.sigloc','.sigsummary']) {
        const node = row.querySelector(selector);
        if (!node) continue;
        const value = clean(node.textContent || '');
        // textContent deliberately destroys any RSS-provided markup/floats.
        if (node.innerHTML !== value) node.textContent = value;
      }
      row.classList.add('tm-sigact-row');
    }
  }

  let lastCocom = null;
  function refresh() {
    const list = document.getElementById('sigactslist');
    if (!list) return;
    repairStructure(list);
    list.classList.add('tm-sigact-list');

    const cocom = activeCocom();
    const rows = [...list.children].filter(el => el.classList.contains('sigact'));
    let shown = 0;
    for (const row of rows) {
      const keep = relevant(row, cocom);
      row.dataset.tmAorMatch = keep ? 'true' : 'false';
      if (keep) shown++;
    }

    const sub = document.getElementById('sigactssub');
    if (sub && rows.length) sub.textContent = `${publicLabel(cocom)} · AOR · ${shown} ITEMS`;

    if (lastCocom && lastCocom !== cocom) list.scrollTop = 0;
    lastCocom = cocom;
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refresh();
    });
  }

  function boot() {
    schedule();
    const bodyObserver = new MutationObserver(schedule);
    bodyObserver.observe(document.body, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class']
    });
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#tabbar .ctab')) setTimeout(schedule, 30);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
