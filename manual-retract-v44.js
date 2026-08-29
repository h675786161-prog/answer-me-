(() => {
  'use strict';
  const VERSION = '0.6.0-beta.44';
  const FLAG = '__answerMeManualRetractV44';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const settings = () => {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    return c.extensionSettings.answerMe;
  };
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function installStyle() {
    if (document.querySelector('#answer_me_manual_retract_style_v44')) return;
    const style = document.createElement('style');
    style.id = 'answer_me_manual_retract_style_v44';
    style.textContent = `
      #answer_me_compact_ui_v38 .manual{display:none!important}
      #answer_me_model_router_v14 .am18-manual{display:none!important}
      #answer_me_model_router_v14 details.am18-site{display:none!important}
    `;
    document.head.appendChild(style);
  }

  async function returnToAutoOnce() {
    const s = settings();
    if (!s) return false;
    if (s.manualRetractMigrationV44 === true) return true;

    s.manualRetractMigrationV44 = true;
    s.keywordManualOpen = false;
    s.compactAdvancedOpen = false;
    s.keywordOverrides = {};
    s.exactModelOverrides = {};
    save();

    // Re-run the currently selected group once so race-model assignments are
    // rebuilt from automatic matching after stale manual overrides are cleared.
    const router = window.AnswerMeModelRouter;
    const selected = router?.selected;
    if (selected?.key && typeof router?.select === 'function') {
      try { await router.select(selected.key); } catch {}
    }
    return true;
  }

  function tidyVisibleUi() {
    installStyle();
    const s = settings();
    if (s) s.keywordManualOpen = false;
    const box = document.querySelector('#answer_me_compact_ui_v38');
    box?.classList?.remove('manual-open');
    const note = box?.querySelector('.am38-note');
    if (note) note.textContent = '识别不对时先重扫模型；模型选择保持自动匹配。';
  }

  async function boot() {
    for (let i = 0; i < 100; i += 1) {
      if (ctx() && window.AnswerMeModelRouter?.groups && document.querySelector('#answer_me_compact_ui_v38')) break;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    installStyle();
    await returnToAutoOnce();
    tidyVisibleUi();

    // Only bounded cleanup passes: compact UI may finish one of its own startup
    // refreshes just after this module. No observer / no permanent polling.
    for (const delay of [180, 500, 1200, 2500]) {
      setTimeout(tidyVisibleUi, delay);
    }

    window.AnswerMeManualRetract = {
      version: VERSION,
      restoreAuto: async () => {
        const s = settings();
        if (!s) return false;
        s.keywordManualOpen = false;
        s.keywordOverrides = {};
        s.exactModelOverrides = {};
        save();
        const selected = window.AnswerMeModelRouter?.selected;
        if (selected?.key) {
          try { await window.AnswerMeModelRouter?.select?.(selected.key); } catch {}
        }
        tidyVisibleUi();
        return true;
      },
    };

    console.log(`[💢 Answer Me] manual controls ${VERSION} retracted · automatic model matching only`);
  }

  void boot();
})();
