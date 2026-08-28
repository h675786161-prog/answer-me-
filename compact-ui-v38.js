(() => {
  'use strict';

  const VERSION = '0.5.4-beta.38';
  const FLAG = '__answerMeCompactUiV38';
  const UI_ID = 'answer_me_compact_ui_v38';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const router = () => window.AnswerMeModelRouter ?? null;
  const selector = () => window.AnswerMeSiteSelector ?? null;
  const profiles = () => Array.isArray(ctx()?.extensionSettings?.connectionManager?.profiles)
    ? ctx().extensionSettings.connectionManager.profiles
    : [];
  const profile = id => profiles().find(p => String(p?.id) === String(id));

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (typeof s.compactSitesOpen !== 'boolean') s.compactSitesOpen = true;
    if (typeof s.compactAdvancedOpen !== 'boolean') s.compactAdvancedOpen = false;
    if (typeof s.keywordManualOpen !== 'boolean') s.keywordManualOpen = false;
    return s;
  }

  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function families() {
    const r = router();
    const s = settings();
    const mode = r?.transportMode || 'stream';
    const map = new Map();
    if (!r?.classify || !s) return [];

    for (const p of profiles()) {
      const models = [...(s.modelCatalog?.[p.id]?.models || []), p.model].filter(Boolean);
      for (const model of new Set(models.map(String))) {
        let info;
        try { info = r.classify(p.id, model); } catch { continue; }
        if (!info || info.ignored || info.transport !== mode || !info.family) continue;
        if (!map.has(info.family)) map.set(info.family, new Set());
        map.get(info.family).add(String(p.id));
      }
    }

    return [...map]
      .map(([name, ids]) => ({ name, count: ids.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function setOptions(select, items, value, emptyLabel) {
    const sig = JSON.stringify(items.map(x => [x.value, x.text]));
    if (select.dataset.sig !== sig) {
      select.dataset.sig = sig;
      select.replaceChildren(...items.map(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.text;
        return option;
      }));
    }
    if (!items.length) {
      const option = document.createElement('option');
      option.textContent = emptyLabel;
      select.replaceChildren(option);
    }
    select.disabled = !items.length;
    if (items.length && select.value !== value) select.value = value;
  }

  function anchor() {
    const root = document.querySelector('#answer_me_settings');
    const oldRouter = root?.querySelector('#answer_me_model_router_v14');
    const anchorEl = root?.querySelector('.answer-me-note') || root?.querySelector('.answer-me-head');
    if (!root || !oldRouter || !anchorEl) return null;

    root.querySelector('#answer_me_compact_ui_v23')?.remove();
    let box = root.querySelector(`#${UI_ID}`);
    if (!box) {
      box = document.createElement('section');
      box.id = UI_ID;
      box.className = 'answer-me-console';
      box.innerHTML = `
        <div class="am38-summary">
          <div class="am38-summary-copy">
            <div class="am38-main">等待模型识别</div>
            <div class="am38-sub">抢答配置</div>
          </div>
          <div class="am38-badges">
            <span class="am38-badge modeBadge">—</span>
            <span class="am38-badge siteBadge">—</span>
          </div>
        </div>

        <div class="am38-grid">
          <label class="am38-field">
            <span>模型系列</span>
            <select class="family"></select>
          </label>
          <label class="am38-field">
            <span>版本</span>
            <select class="version"></select>
          </label>
        </div>

        <div class="am38-segment" role="group" aria-label="传输模式">
          <button type="button" data-mode="stream">🟢 真流式</button>
          <button type="button" data-mode="fake">📦 整包模式</button>
        </div>

        <details class="am38-fold sitesFold" open>
          <summary>
            <span>参赛站</span>
            <span class="am38-fold-meta sitesMeta">0/0</span>
          </summary>
          <div class="am38-fold-body">
            <div class="am38-sites"></div>
            <div class="am38-actions am38-actions-soft">
              <button type="button" class="all">全选可用站</button>
              <button type="button" class="one">只留当前站</button>
            </div>
          </div>
        </details>

        <details class="am38-fold advFold">
          <summary>
            <span>高级</span>
            <span class="am38-fold-meta advMeta">模型扫描</span>
          </summary>
          <div class="am38-fold-body">
            <div class="am38-actions">
              <button type="button" class="scan">↻ 重扫模型</button>
              <button type="button" class="manual">✎ 手动校正</button>
            </div>
            <div class="am38-note"></div>
          </div>
        </details>`;
    }

    anchorEl.insertAdjacentElement('afterend', box);
    box.insertAdjacentElement('afterend', oldRouter);
    return box;
  }

  function renderSites(box, eligible, selected) {
    const wrap = box.querySelector('.am38-sites');
    const sig = JSON.stringify([eligible, [...selected]]);
    if (wrap.dataset.sig === sig) return;
    wrap.dataset.sig = sig;
    wrap.replaceChildren();

    for (const id of eligible) {
      const p = profile(id);
      if (!p) continue;
      const on = selected.has(String(id));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `am38-site ${on ? 'on' : 'off'}`;
      button.innerHTML = `<span class="am38-site-dot">${on ? '●' : '○'}</span><span class="am38-site-name"></span>`;
      button.querySelector('.am38-site-name').textContent = p.name || '未命名站';
      button.title = p.name || '未命名站';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await selector()?.toggle?.(id); }
        finally { update(); }
      });
      wrap.appendChild(button);
    }
  }

  function bind(box) {
    if (box.dataset.bound === '1') return;
    box.dataset.bound = '1';

    box.querySelector('.family').addEventListener('change', async e => {
      e.currentTarget.disabled = true;
      try { await router()?.setFamily?.(e.currentTarget.value); }
      finally { update(); }
    });

    box.querySelector('.version').addEventListener('change', async e => {
      e.currentTarget.disabled = true;
      try { await router()?.select?.(e.currentTarget.value); }
      finally { update(); }
    });

    box.querySelectorAll('.am38-segment button').forEach(button => {
      button.addEventListener('click', async () => {
        if (button.dataset.mode === router()?.transportMode) return;
        button.disabled = true;
        try { await router()?.setTransport?.(button.dataset.mode); }
        finally { update(); }
      });
    });

    box.querySelector('.all').addEventListener('click', async () => {
      await selector()?.selectAll?.();
      update();
    });

    box.querySelector('.one').addEventListener('click', async () => {
      await selector()?.onlyCurrent?.();
      update();
    });

    box.querySelector('.scan').addEventListener('click', async e => {
      e.currentTarget.disabled = true;
      try { await router()?.scan?.(true); }
      finally { e.currentTarget.disabled = false; update(); }
    });

    box.querySelector('.manual').addEventListener('click', () => {
      const s = settings();
      if (!s) return;
      const old = document.querySelector('#answer_me_model_router_v14');
      const action = [...(old?.querySelectorAll('.am18-action') || [])]
        .find(x => String(x.textContent).includes('手动校正'));
      action?.click?.();
      s.keywordManualOpen = !s.keywordManualOpen;
      save();
      update();
    });

    for (const [selectorText, key] of [['.sitesFold', 'compactSitesOpen'], ['.advFold', 'compactAdvancedOpen']]) {
      box.querySelector(selectorText).addEventListener('toggle', e => {
        const s = settings();
        if (!s) return;
        s[key] = !!e.currentTarget.open;
        save();
      });
    }
  }

  function update() {
    const box = anchor();
    const r = router();
    const sel = selector();
    const s = settings();
    if (!box || !r || !sel || !s) return false;
    bind(box);

    const group = r.selected;
    const mode = r.transportMode || 'stream';
    const family = r.family || group?.family || '';
    const familyList = families();
    const versionList = Array.isArray(r.groups?.()) ? r.groups() : [];
    const eligible = Array.isArray(sel.eligibleIds) ? sel.eligibleIds.map(String) : [];
    const selected = new Set((Array.isArray(sel.selectedIds) ? sel.selectedIds : []).map(String));

    box.querySelector('.am38-main').textContent = group ? `${group.family} ${group.version}` : (family || '未选模型');
    box.querySelector('.am38-sub').textContent = group?.keyword ? `关键模型名 · ${group.keyword}` : '抢答配置';
    box.querySelector('.modeBadge').textContent = mode === 'stream' ? '🟢 真流' : '📦 整包';
    box.querySelector('.siteBadge').textContent = `${selected.size}/${eligible.length} 站`;

    setOptions(box.querySelector('.family'), familyList.map(x => ({ value: x.name, text: `${x.name} · ${x.count}站` })), family, '暂无系列');
    setOptions(box.querySelector('.version'), versionList.map(x => ({ value: x.key, text: `${x.version} · ${x.profileCount}站` })), group?.key || '', '暂无版本');

    box.querySelectorAll('.am38-segment button').forEach(button => {
      button.classList.toggle('on', button.dataset.mode === mode);
      button.disabled = false;
    });

    const sitesFold = box.querySelector('.sitesFold');
    const advFold = box.querySelector('.advFold');
    sitesFold.open = !!s.compactSitesOpen;
    advFold.open = !!s.compactAdvancedOpen;
    box.querySelector('.sitesMeta').textContent = `${selected.size}/${eligible.length}`;

    const total = profiles().length;
    const scanned = profiles().filter(p => s.modelCatalog?.[p.id]?.fallback === false).length;
    box.querySelector('.advMeta').textContent = `${scanned}/${total} 已扫描`;
    box.querySelector('.manual').textContent = s.keywordManualOpen ? '收起手动校正' : '✎ 手动校正';
    box.querySelector('.am38-note').textContent = group?.keyword ? `当前关键模型名：${group.keyword}` : '识别不对时再重扫或手动校正。';
    box.classList.toggle('manual-open', !!s.keywordManualOpen);

    renderSites(box, eligible, selected);
    return true;
  }

  async function boot() {
    for (let i = 0; i < 100; i += 1) {
      if (ctx() && router()?.groups && selector() && document.querySelector('#answer_me_settings') && document.querySelector('#answer_me_model_router_v14')) break;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (!update()) throw new Error('设置 UI 挂载点未就绪');
    window.AnswerMeCompactUI = { version: VERSION, refresh: update };
    console.log(`[💢 Answer Me] compact UI ${VERSION} ready · no observer / no polling`);
  }

  boot().catch(error => console.error(`[💢 Answer Me] compact UI ${VERSION} failed`, error));
})();
