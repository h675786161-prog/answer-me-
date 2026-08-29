(() => {
  'use strict';

  const VERSION = '0.6.2-beta.46';
  const FLAG = '__answerMeNativeStatusV46';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const profiles = () => {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  };

  function currentInfo() {
    const c = ctx();
    const selected = String(c?.extensionSettings?.connectionManager?.selectedProfile ?? document.querySelector('#connection_profiles')?.value ?? '');
    const profile = profiles().find(p => String(p?.id) === selected);
    const select = document.querySelector('#connection_profiles');
    const selectName = select?.selectedOptions?.[0]?.textContent?.trim() || '';
    const model = String(
      profile?.model
      ?? c?.chatCompletionSettings?.openai_model
      ?? c?.chatCompletionSettings?.model
      ?? document.querySelector('#model_openai_select')?.value
      ?? document.querySelector('#openai_model')?.value
      ?? ''
    );
    return {
      id: selected,
      name: String(profile?.name || selectName || '当前酒馆插头'),
      model,
      profile: profile || null,
    };
  }

  function installStyle() {
    if (document.querySelector('#answer_me_native_status_style_v46')) return;
    const style = document.createElement('style');
    style.id = 'answer_me_native_status_style_v46';
    style.textContent = `
      #answer_me_compact_ui_v38 .am46-native{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 9px;align-items:center;margin:8px 0 10px;padding:8px 10px;border:1px solid var(--am-border,var(--SmartThemeBorderColor,rgba(127,127,127,.18)));border-radius:10px;background:var(--am-soft,rgba(127,127,127,.055))}
      #answer_me_compact_ui_v38 .am46-native-label{font-size:.75em;opacity:.62;grid-row:1/3;white-space:nowrap}
      #answer_me_compact_ui_v38 .am46-native-name{font-size:.88em;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #answer_me_compact_ui_v38 .am46-native-model{font-size:.74em;opacity:.66;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    `;
    document.head.appendChild(style);
  }

  function renameOriginalCandidate(info) {
    const round = window.AnswerMe?.round;
    const original = round?.candidates?.get?.('__original__');
    if (!original) return;
    original.profileId = info.id;
    original.name = info.name ? `酒馆主线 · ${info.name}` : '酒馆主线';
  }

  function update() {
    installStyle();
    const info = currentInfo();
    renameOriginalCandidate(info);

    const box = document.querySelector('#answer_me_compact_ui_v38');
    if (box) {
      let row = box.querySelector('.am46-native');
      if (!row) {
        row = document.createElement('div');
        row.className = 'am46-native';
        row.innerHTML = '<span class="am46-native-label">酒馆主线</span><span class="am46-native-name"></span><span class="am46-native-model"></span>';
        const summary = box.querySelector('.am38-summary');
        summary?.insertAdjacentElement('afterend', row);
      }
      row.querySelector('.am46-native-name').textContent = info.name || '当前酒馆插头';
      row.querySelector('.am46-native-model').textContent = info.model || '模型由酒馆当前连接决定';

      const sitesTitle = box.querySelector('.sitesFold > summary > span:first-child');
      if (sitesTitle) sitesTitle.textContent = '额外参赛站';
      const one = box.querySelector('.one');
      if (one) {
        one.textContent = '只跑酒馆主线';
        one.title = '清空所有额外支线；当前酒馆插头仍会正常请求，失败时按单线路规则重试';
      }
    }

    const singleLabel = document.querySelector('#answer_me_single_retry')?.closest('label')?.querySelector('span');
    if (singleLabel) singleLabel.textContent = '只跑酒馆主线时，失败 / 空回也自动重试';
    return info;
  }

  function wrapCompactRefresh() {
    const ui = window.AnswerMeCompactUI;
    if (!ui?.refresh || ui.__answerMeNativeStatusWrappedV46) return false;
    const original = ui.refresh.bind(ui);
    ui.refresh = (...args) => {
      const result = original(...args);
      update();
      return result;
    };
    ui.__answerMeNativeStatusWrappedV46 = true;
    return true;
  }

  async function boot() {
    for (let i = 0; i < 120; i += 1) {
      if (ctx() && document.querySelector('#answer_me_settings')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (let i = 0; i < 80 && !wrapCompactRefresh(); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    document.addEventListener('change', event => {
      const target = event.target;
      const id = String(target?.id || '');
      if (id === 'connection_profiles' || /model/i.test(id)) {
        setTimeout(() => {
          update();
          try { window.AnswerMeSiteSelector?.apply?.(); } catch {}
        }, 120);
      }
    }, true);

    const c = ctx();
    const events = c?.eventTypes || c?.event_types;
    if (c?.eventSource && events) {
      const refreshOn = key => { if (events[key]) c.eventSource.on(events[key], () => setTimeout(update, 0)); };
      refreshOn('GENERATION_STARTED');
      refreshOn('CHAT_COMPLETION_SETTINGS_READY');
      refreshOn('GENERATION_ENDED');
    }

    update();
    window.AnswerMeNativeStatus = { version: VERSION, current: currentInfo, refresh: update };
    console.log(`[💢 Answer Me] native status ${VERSION} ready · current ST plug tracked as independent main lane`);
  }

  void boot().catch(error => console.error(`[💢 Answer Me] native status ${VERSION} failed`, error));
})();
