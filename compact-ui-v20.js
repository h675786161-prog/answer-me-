(() => {
  'use strict';

  const VERSION = '0.3.8-beta.20';
  const FLAG = '__answerMeCompactUiV20';
  const STYLE_ID = 'answer_me_compact_ui_style_v20';
  const UI_ID = 'answer_me_compact_ui_v20';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  let refs = null;
  let renderTimer = null;
  let observer = null;
  let guardSnapshot = null;
  let guardUntil = 0;
  let guardRestoreTimer = null;

  function ctx() { return window.SillyTavern?.getContext?.() ?? null; }
  function router() { return window.AnswerMeModelRouter ?? null; }
  function selector() { return window.AnswerMeSiteSelector ?? null; }

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (typeof s.compactSitesOpen !== 'boolean') s.compactSitesOpen = false;
    if (typeof s.compactAdvancedOpen !== 'boolean') s.compactAdvancedOpen = false;
    if (typeof s.keywordManualOpen !== 'boolean') s.keywordManualOpen = false;
    return s;
  }

  function saveSettings() { try { ctx()?.saveSettingsDebounced?.(); } catch {} }
  function profiles() {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  }
  function profileById(id) { return profiles().find(p => String(p?.id) === String(id)); }

  function familyOptions() {
    const r = router();
    const s = settings();
    if (!r?.classify || !s) return [];
    const mode = r.transportMode || 'stream';
    const map = new Map();
    for (const profile of profiles()) {
      const cached = s.modelCatalog?.[profile?.id];
      const models = Array.isArray(cached?.models) ? [...cached.models] : [];
      if (profile?.model) models.push(profile.model);
      for (const model of [...new Set(models.filter(Boolean).map(String))]) {
        let info;
        try { info = r.classify(profile.id, model); } catch { continue; }
        if (!info || info.ignored || info.transport !== mode || !info.family) continue;
        if (!map.has(info.family)) map.set(info.family, new Set());
        map.get(info.family).add(String(profile.id));
      }
    }
    return [...map.entries()]
      .map(([name, ids]) => ({ name, count: ids.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }

  function scanStats() {
    const s = settings();
    const all = profiles();
    return {
      full: all.filter(p => s?.modelCatalog?.[p.id]?.fallback === false).length,
      total: all.length,
    };
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #answer_me_compact_ui_v19{display:none!important}
      #answer_me_model_router_v14{display:none!important}
      #answer_me_site_selector_v16{display:none!important}
      #${UI_ID}{margin:10px 0 12px;padding:11px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));border-radius:14px;background:linear-gradient(145deg,rgba(127,127,127,.075),rgba(127,127,127,.035));box-shadow:0 5px 18px rgba(0,0,0,.04)}
      #${UI_ID} .am20-top{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:9px}
      #${UI_ID} .am20-current{min-width:0;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      #${UI_ID} .am20-current-main{font-weight:800;font-size:.96em}
      #${UI_ID} .am20-badge{font-size:.75em;opacity:.68;padding:2px 7px;border-radius:999px;background:rgba(127,127,127,.10)}
      #${UI_ID} .am20-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
      #${UI_ID} .am20-field{display:grid;gap:4px;min-width:0}
      #${UI_ID} .am20-field>span{font-size:.72em;opacity:.64;font-weight:700}
      #${UI_ID} select{width:100%;min-width:0;height:34px;padding:4px 30px 4px 9px;border-radius:9px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:var(--black30a,rgba(127,127,127,.06));color:inherit}
      #${UI_ID} .am20-mode{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
      #${UI_ID} .am20-mode button,#${UI_ID} .am20-mini-btn{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.055);color:inherit;border-radius:9px;padding:7px 8px;cursor:pointer}
      #${UI_ID} .am20-mode button.is-active{font-weight:800;background:rgba(127,127,127,.19);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
      #${UI_ID} button:disabled,#${UI_ID} select:disabled{opacity:.42;cursor:wait}
      #${UI_ID} .am20-section{margin-top:9px;padding-top:9px;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.09))}
      #${UI_ID} .am20-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;user-select:none}
      #${UI_ID} .am20-section-title{display:flex;align-items:center;gap:7px;font-size:.85em;font-weight:750}
      #${UI_ID} .am20-section-meta{font-size:.76em;opacity:.62;white-space:nowrap}
      #${UI_ID} .am20-sites{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}
      #${UI_ID} .am20-site{min-width:0;text-align:left;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));background:rgba(127,127,127,.045);color:inherit;border-radius:9px;padding:7px 8px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${UI_ID} .am20-site.is-on{font-weight:750;background:rgba(127,127,127,.15)}
      #${UI_ID} .am20-site.is-off{opacity:.42}
      #${UI_ID} .am20-site-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}
      #${UI_ID} .am20-link{border:0;background:transparent;color:inherit;opacity:.7;cursor:pointer;padding:1px 0;font-size:.78em}
      #${UI_ID} .am20-advanced{display:grid;gap:7px;margin-top:8px}
      #${UI_ID} .am20-advanced-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      #${UI_ID} .am20-note{font-size:.75em;opacity:.58;line-height:1.45;word-break:break-word}
      #${UI_ID}.is-manual-open + #answer_me_model_router_v14{display:block!important;margin-top:8px!important;padding:8px!important;background:rgba(127,127,127,.035)!important}
      #${UI_ID}.is-manual-open + #answer_me_model_router_v14 > :not(.am18-manual){display:none!important}
      #${UI_ID}.is-manual-open + #answer_me_model_router_v14 .am18-manual{display:block!important;margin-top:0!important;padding-top:0!important;border-top:0!important}
      @media(max-width:700px){#${UI_ID}{padding:10px}#${UI_ID} .am20-sites{grid-template-columns:repeat(2,minmax(0,1fr))}#${UI_ID} .am20-current-main{font-size:.92em}}
    `;
    document.head.appendChild(style);
  }

  function scrollTargets() {
    const root = document.querySelector('#answer_me_settings');
    const targets = [];
    const seen = new Set();
    const add = el => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      targets.push(el);
    };
    add(document.scrollingElement);
    let node = root;
    while (node) {
      try {
        const cs = getComputedStyle(node);
        if (/(auto|scroll|overlay)/.test(`${cs.overflowY} ${cs.overflow}`) && node.scrollHeight > node.clientHeight + 2) add(node);
      } catch {}
      node = node.parentElement;
    }
    return targets;
  }

  function captureScroll() {
    return {
      windowX: window.scrollX,
      windowY: window.scrollY,
      items: scrollTargets().map(el => ({ el, top: el.scrollTop, left: el.scrollLeft })),
    };
  }

  function restoreScroll(snapshot) {
    if (!snapshot) return;
    const apply = () => {
      for (const item of snapshot.items || []) {
        if (!item.el?.isConnected) continue;
        item.el.scrollTop = item.top;
        item.el.scrollLeft = item.left;
      }
      try { window.scrollTo(snapshot.windowX, snapshot.windowY); } catch {}
    };
    apply();
    requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
    setTimeout(apply, 90);
    setTimeout(apply, 260);
  }

  function armScrollGuard() {
    guardSnapshot = captureScroll();
    guardUntil = Date.now() + 1600;
  }

  function kickScrollGuard() {
    if (!guardSnapshot || Date.now() > guardUntil) return;
    if (guardRestoreTimer) clearTimeout(guardRestoreTimer);
    const snap = guardSnapshot;
    restoreScroll(snap);
    guardRestoreTimer = setTimeout(() => restoreScroll(snap), 45);
  }

  async function stableAction(control, fn) {
    const snap = guardSnapshot && Date.now() <= guardUntil ? guardSnapshot : captureScroll();
    guardSnapshot = snap;
    guardUntil = Date.now() + 1800;
    if (control) control.disabled = true;
    try { return await fn(); }
    finally {
      if (control?.isConnected) control.disabled = false;
      scheduleUpdate();
      restoreScroll(snap);
    }
  }

  function createSkeleton() {
    const root = document.querySelector('#answer_me_settings');
    const old = root?.querySelector('#answer_me_model_router_v14');
    if (!root || !old) return null;
    document.querySelector('#answer_me_compact_ui_v19')?.remove();
    let box = root.querySelector(`#${UI_ID}`);
    if (!box) {
      box = document.createElement('div');
      box.id = UI_ID;
      old.insertAdjacentElement('beforebegin', box);
      box.innerHTML = `
        <div class="am20-top"><div class="am20-current"><div class="am20-current-main"></div><span class="am20-badge am20-mode-badge"></span><span class="am20-badge am20-site-badge"></span></div></div>
        <div class="am20-grid">
          <label class="am20-field"><span>模型系列</span><select class="am20-family"></select></label>
          <label class="am20-field"><span>版本</span><select class="am20-version"></select></label>
        </div>
        <div class="am20-mode"><button type="button" data-mode="stream">🟢 真流式</button><button type="button" data-mode="fake">📦 假流式</button></div>
        <div class="am20-section am20-sites-section">
          <div class="am20-section-head am20-sites-head"><div class="am20-section-title"></div><div class="am20-section-meta"></div></div>
          <div class="am20-sites-body"><div class="am20-sites"></div><div class="am20-site-actions"><button type="button" class="am20-link am20-all">全选可用站</button><button type="button" class="am20-link am20-one">只留当前站</button></div></div>
        </div>
        <div class="am20-section am20-advanced-section">
          <div class="am20-section-head am20-advanced-head"><div class="am20-section-title"></div><div class="am20-section-meta"></div></div>
          <div class="am20-advanced-body"><div class="am20-advanced"><div class="am20-advanced-row"><button type="button" class="am20-mini-btn am20-scan">↻ 重扫模型</button><button type="button" class="am20-mini-btn am20-manual">✎ 手动校正识别</button></div><div class="am20-note"></div></div></div>
        </div>`;
    } else if (box.nextElementSibling !== old) {
      old.insertAdjacentElement('beforebegin', box);
    }

    if (box.dataset.bound !== '1') {
      box.dataset.bound = '1';
      box.addEventListener('pointerdown', armScrollGuard, true);
      box.addEventListener('touchstart', armScrollGuard, { capture: true, passive: true });
      box.querySelector('.am20-family').addEventListener('change', e => {
        const el = e.currentTarget;
        void stableAction(el, () => router()?.setFamily?.(el.value));
      });
      box.querySelector('.am20-version').addEventListener('change', e => {
        const el = e.currentTarget;
        void stableAction(el, () => router()?.select?.(el.value));
      });
      box.querySelectorAll('.am20-mode button').forEach(btn => btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === router()?.transportMode) return;
        void stableAction(btn, () => router()?.setTransport?.(mode));
      }));
      box.querySelector('.am20-sites-head').addEventListener('click', () => {
        const s = settings();
        s.compactSitesOpen = !s.compactSitesOpen;
        saveSettings();
        update();
        kickScrollGuard();
      });
      box.querySelector('.am20-advanced-head').addEventListener('click', () => {
        const s = settings();
        s.compactAdvancedOpen = !s.compactAdvancedOpen;
        saveSettings();
        update();
        kickScrollGuard();
      });
      box.querySelector('.am20-all').addEventListener('click', e => void stableAction(e.currentTarget, () => selector()?.selectAll?.()));
      box.querySelector('.am20-one').addEventListener('click', e => void stableAction(e.currentTarget, () => selector()?.onlyCurrent?.()));
      box.querySelector('.am20-scan').addEventListener('click', e => void stableAction(e.currentTarget, () => router()?.scan?.(true)));
      box.querySelector('.am20-manual').addEventListener('click', () => {
        const s = settings();
        const next = !s.keywordManualOpen;
        const oldRouter = document.querySelector('#answer_me_model_router_v14');
        const manualButton = [...(oldRouter?.querySelectorAll('.am18-action') || [])].find(btn => String(btn.textContent || '').includes('手动校正'));
        if (manualButton) manualButton.click();
        else { s.keywordManualOpen = next; saveSettings(); }
        s.keywordManualOpen = next;
        saveSettings();
        update();
        kickScrollGuard();
      });
    }

    refs = {
      box,
      main: box.querySelector('.am20-current-main'),
      modeBadge: box.querySelector('.am20-mode-badge'),
      siteBadge: box.querySelector('.am20-site-badge'),
      family: box.querySelector('.am20-family'),
      version: box.querySelector('.am20-version'),
      modeButtons: [...box.querySelectorAll('.am20-mode button')],
      sitesTitle: box.querySelector('.am20-sites-head .am20-section-title'),
      sitesMeta: box.querySelector('.am20-sites-head .am20-section-meta'),
      sitesBody: box.querySelector('.am20-sites-body'),
      sites: box.querySelector('.am20-sites'),
      advTitle: box.querySelector('.am20-advanced-head .am20-section-title'),
      advMeta: box.querySelector('.am20-advanced-head .am20-section-meta'),
      advBody: box.querySelector('.am20-advanced-body'),
      manual: box.querySelector('.am20-manual'),
      note: box.querySelector('.am20-note'),
    };
    return refs;
  }

  function syncSelect(select, items, selectedValue, emptyText = '暂无可用') {
    const sig = JSON.stringify(items.map(x => [x.value, x.text]));
    if (select.dataset.optionsSig !== sig) {
      select.dataset.optionsSig = sig;
      const existing = new Map([...select.options].map(o => [o.value, o]));
      const wanted = new Set(items.map(x => x.value));
      for (const opt of [...select.options]) if (!wanted.has(opt.value)) opt.remove();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let opt = existing.get(item.value);
        if (!opt || !opt.isConnected) {
          opt = document.createElement('option');
          opt.value = item.value;
        }
        if (opt.textContent !== item.text) opt.textContent = item.text;
        const at = select.options[i];
        if (at !== opt) select.insertBefore(opt, at || null);
      }
      if (!items.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = emptyText;
        select.appendChild(opt);
      }
    }
    select.disabled = !items.length;
    if (items.some(x => x.value === selectedValue)) select.value = selectedValue;
    else if (items.length && !items.some(x => x.value === select.value)) select.value = items[0].value;
  }

  function syncSiteButtons(eligible, selected) {
    const existing = new Map([...refs.sites.querySelectorAll('[data-site-id]')].map(btn => [btn.dataset.siteId, btn]));
    const wanted = new Set(eligible.map(String));
    for (const [id, btn] of existing) if (!wanted.has(id)) btn.remove();
    for (let i = 0; i < eligible.length; i++) {
      const id = String(eligible[i]);
      const p = profileById(id);
      if (!p) continue;
      let btn = existing.get(id);
      if (!btn || !btn.isConnected) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'am20-site';
        btn.dataset.siteId = id;
        btn.addEventListener('click', () => void stableAction(btn, () => selector()?.toggle?.(id)));
      }
      const on = selected.has(id);
      btn.classList.toggle('is-on', on);
      btn.classList.toggle('is-off', !on);
      const text = `${on ? '✓' : '○'} ${p.name || '未命名站'}`;
      if (btn.textContent !== text) btn.textContent = text;
      const at = refs.sites.children[i];
      if (at !== btn) refs.sites.insertBefore(btn, at || null);
    }
  }

  function update() {
    if (!refs?.box?.isConnected) refs = createSkeleton();
    if (!refs) return;
    const r = router();
    const sel = selector();
    const s = settings();
    if (!r || !sel || !s) return;

    const group = r.selected;
    const mode = r.transportMode || 'stream';
    const family = r.family || group?.family || '';
    const families = familyOptions();
    const versions = Array.isArray(r.groups?.()) ? r.groups() : [];
    const eligible = Array.isArray(sel.eligibleIds) ? sel.eligibleIds.map(String) : [];
    const selected = new Set(Array.isArray(sel.selectedIds) ? sel.selectedIds.map(String) : []);
    const stats = scanStats();
    const siteNames = [...selected].map(id => profileById(id)?.name || '').filter(Boolean);

    refs.main.textContent = group ? `${group.family} ${group.version}` : (family || '未选模型');
    refs.modeBadge.textContent = mode === 'stream' ? '🟢 真流' : '📦 假流';
    refs.siteBadge.textContent = `${selected.size}/${eligible.length} 家`;

    syncSelect(refs.family, families.map(x => ({ value: x.name, text: `${x.name} · ${x.count}` })), family, '暂无模型系列');
    syncSelect(refs.version, versions.map(x => ({ value: x.key, text: `${x.version} · ${x.profileCount}家` })), group?.key || '', '暂无可用版本');

    for (const btn of refs.modeButtons) {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    }

    refs.sitesTitle.textContent = `${s.compactSitesOpen ? '▾' : '▸'} 参赛站`;
    refs.sitesMeta.textContent = `${selected.size}/${eligible.length} 家${!s.compactSitesOpen && siteNames.length ? ` · ${siteNames.slice(0, 2).join('、')}${siteNames.length > 2 ? '…' : ''}` : ''}`;
    refs.sitesBody.hidden = !s.compactSitesOpen;
    syncSiteButtons(eligible, selected);

    refs.advTitle.textContent = `${s.compactAdvancedOpen ? '▾' : '▸'} 高级设置`;
    refs.advMeta.textContent = `${stats.full}/${stats.total} 家已扫描`;
    refs.advBody.hidden = !s.compactAdvancedOpen;
    refs.manual.textContent = s.keywordManualOpen ? '收起手动校正' : '✎ 手动校正识别';
    refs.note.textContent = group?.keyword
      ? `当前关键模型名：${group.keyword} · 原始模型 ID 和扫描细节默认收起来。`
      : '原始模型 ID 和扫描细节默认收起来。';
    refs.box.classList.toggle('is-manual-open', !!s.keywordManualOpen);
  }

  function scheduleUpdate() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderTimer = null; update(); kickScrollGuard(); }, 35);
  }

  function observeRoot() {
    observer?.disconnect?.();
    const root = document.querySelector('#answer_me_settings');
    if (!root) return;
    root.addEventListener('pointerdown', e => {
      if (e.target.closest('#answer_me_settings')) armScrollGuard();
    }, true);
    observer = new MutationObserver(() => {
      scheduleUpdate();
      kickScrollGuard();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  async function boot() {
    if (window[FLAG]) return;
    window[FLAG] = true;
    for (let i = 0; i < 140; i++) {
      if (ctx() && router()?.groups && selector() && document.querySelector('#answer_me_settings')) break;
      await sleep(100);
    }
    installStyle();
    createSkeleton();
    update();
    observeRoot();
    const timer = setInterval(() => {
      if (!document.querySelector(`#${UI_ID}`)) createSkeleton();
      update();
    }, 1000);
    window.addEventListener('beforeunload', () => {
      clearInterval(timer);
      observer?.disconnect?.();
    }, { once: true });
    console.log(`[💢 Answer Me] compact UI ${VERSION} ready · persistent DOM + scroll guard`);
  }

  boot().catch(error => {
    console.error('[💢 Answer Me] compact UI v20 startup failed', error);
    window.toastr?.error?.(String(error?.message || error || '稳定控制面板启动失败'), '💢 Answer Me');
  });
})();
