(() => {
  'use strict';

  const VERSION = '0.4.2-beta.24';
  const FLAG = '__answerMeExactModelPickerV24';
  if (window[FLAG]) return;
  window[FLAG] = true;

  let observer = null;
  let timer = null;
  let patchTimer = null;

  function ctx(){ return window.SillyTavern?.getContext?.() ?? null; }
  function router(){ return window.AnswerMeModelRouter ?? null; }
  function settings(){
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (!s.exactModelOverrides || typeof s.exactModelOverrides !== 'object' || Array.isArray(s.exactModelOverrides)) s.exactModelOverrides = {};
    return s;
  }
  function saveSettings(){ try { ctx()?.saveSettingsDebounced?.(); } catch {} }
  function profiles(){
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  }
  function profileByNameText(text){
    const t = String(text || '');
    return profiles().filter(Boolean).sort((a,b)=>String(b.name||'').length-String(a.name||'').length)
      .find(p => t.startsWith(String(p.name || '未命名站'))) || null;
  }
  function key(profileId, family, version, mode){ return `${encodeURIComponent(String(profileId))}::${family}::${version}::${mode}`; }
  function catalogModels(profile){
    const s = settings();
    const cached = s?.modelCatalog?.[profile?.id];
    const list = Array.isArray(cached?.models) ? [...cached.models] : [];
    if (profile?.model) list.push(profile.model);
    return [...new Set(list.map(x=>String(x||'').trim()).filter(Boolean))];
  }
  function matchingModels(profile, active){
    const r = router();
    if (!r?.classify || !active) return catalogModels(profile);
    return catalogModels(profile).filter(model => {
      try {
        const info = r.classify(profile.id, model);
        return !info?.ignored && info.family === active.family && info.version === active.version && info.transport === active.transportMode;
      } catch { return false; }
    });
  }
  function installStyle(){
    if (document.querySelector('#answer_me_exact_model_picker_style_v24')) return;
    const style = document.createElement('style');
    style.id = 'answer_me_exact_model_picker_style_v24';
    style.textContent = `
      #answer_me_model_router_v14 .am24-exact-wrap{display:grid;gap:5px;margin-top:6px}
      #answer_me_model_router_v14 .am24-exact-wrap>span{font-size:.76em;opacity:.72}
      #answer_me_model_router_v14 .am24-exact{width:100%;min-width:0;max-width:100%;height:34px;border-radius:8px;padding:4px 28px 4px 8px}
      #answer_me_model_router_v14 .am24-source{font-size:.73em;opacity:.58;line-height:1.4;word-break:break-all}
    `;
    document.head.appendChild(style);
  }
  async function applyExact(profile, active, model){
    const s = settings();
    const k = key(profile.id, active.family, active.version, active.transportMode);
    if (model) {
      s.exactModelOverrides[k] = model;
      profile.model = model;
      const keyword = router()?.canonicalKeyword?.(model) || '';
      try { router()?.setKeyword?.(profile.id, active.family, active.version, active.transportMode, keyword); } catch {}
    } else {
      delete s.exactModelOverrides[k];
      try { router()?.setKeyword?.(profile.id, active.family, active.version, active.transportMode, ''); } catch {}
    }
    saveSettings();
    try { await window.AnswerMeSiteSelector?.apply?.(); } catch {}
    try { window.AnswerMe?.refresh?.(); } catch {}
  }
  function patchManual(){
    installStyle();
    const box = document.querySelector('#answer_me_model_router_v14');
    const active = router()?.selected;
    if (!box || !active) return;
    for (const details of box.querySelectorAll('details.am18-site')) {
      if (details.dataset.am24Patched === '1') continue;
      const summary = details.querySelector(':scope > summary');
      const profile = profileByNameText(summary?.textContent);
      const editor = details.querySelector('.am18-editor');
      const oldField = editor?.querySelector('.am18-field');
      if (!profile || !editor || !oldField) continue;

      const models = matchingModels(profile, active);
      const wrap = document.createElement('label');
      wrap.className = 'am24-exact-wrap';
      const title = document.createElement('span');
      title.textContent = '手动模型名（直接读取这个站的模型表）';
      const select = document.createElement('select');
      select.className = 'am24-exact';
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = '自动匹配';
      select.appendChild(auto);
      for (const model of models) {
        const op = document.createElement('option');
        op.value = model;
        op.textContent = model;
        select.appendChild(op);
      }
      const saved = settings()?.exactModelOverrides?.[key(profile.id, active.family, active.version, active.transportMode)] || '';
      const current = saved || (models.includes(profile.model) ? profile.model : '');
      select.value = models.includes(current) ? current : '';
      const source = document.createElement('div');
      source.className = 'am24-source';
      const full = settings()?.modelCatalog?.[profile.id]?.fallback === false;
      source.textContent = models.length
        ? `${models.length} 个当前档模型 · ${full ? '来自站点完整模型表' : '模型表拉取失败/未完整，仅含已知模型'}`
        : '这个站当前没有拉到符合本档的模型名；先点“重扫模型”。';
      wrap.append(title, select, source);

      oldField.replaceWith(wrap);
      const hint = editor.querySelector('.am18-auto:nth-of-type(2)');
      if (hint) hint.textContent = '这里保存的是这个站的真实模型 ID，不再手填关键字。切档时会优先沿用你选中的精确模型。';
      const buttons = editor.querySelector('.am18-buttons');
      if (buttons) buttons.style.display = 'none';

      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await applyExact(profile, active, select.value);
          window.toastr?.success?.(select.value ? `${profile.name || '这个站'} 已锁定：${select.value}` : `${profile.name || '这个站'} 已恢复自动匹配`, '✎ Answer Me');
        } finally {
          if (select.isConnected) select.disabled = false;
        }
      });
      details.dataset.am24Patched = '1';
    }
  }
  function schedule(){
    clearTimeout(patchTimer);
    patchTimer = setTimeout(patchManual, 40);
  }
  async function boot(){
    for (let i=0;i<120;i++) {
      if (ctx() && router()?.groups) break;
      await new Promise(r=>setTimeout(r,100));
    }
    const root = document.querySelector('#answer_me_settings') || document.documentElement;
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList:true, subtree:true });
    timer = setInterval(patchManual, 700);
    patchManual();
    window.addEventListener('beforeunload', () => { observer?.disconnect?.(); clearInterval(timer); clearTimeout(patchTimer); }, { once:true });
    console.log(`[💢 Answer Me] exact model picker ${VERSION} ready · manual correction now uses station model catalog`);
  }
  boot().catch(err => console.error('[💢 Answer Me] exact model picker v24 failed', err));
})();
