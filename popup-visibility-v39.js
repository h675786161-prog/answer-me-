(() => {
  'use strict';
  const VERSION = '0.5.5-beta.39';
  const FLAG = '__answerMePopupVisibilityV39';
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

  function migrateVisibleDefaultOnce() {
    const s = settings();
    if (!s) return false;
    if (s.popupVisibilityMigrationV39 !== true) {
      s.popupVisibilityMigrationV39 = true;
      s.showFloatingStatus = true;
      save();
    }
    return true;
  }

  function forceRefresh() {
    try { window.AnswerMe?.refresh?.(); } catch {}
  }

  function exposeApi() {
    window.AnswerMePopupVisibility = {
      version: VERSION,
      show() {
        const s = settings();
        if (!s) return false;
        s.showFloatingStatus = true;
        if (window.AnswerMe?.round) window.AnswerMe.round.dismissed = false;
        save();
        forceRefresh();
        return true;
      },
      hide() {
        const s = settings();
        if (!s) return false;
        s.showFloatingStatus = false;
        save();
        forceRefresh();
        return true;
      },
      state() {
        const s = settings();
        const round = window.AnswerMe?.round;
        const panel = document.querySelector('#answer_me_float_panel');
        let computedDisplay = '';
        let computedVisibility = '';
        if (panel) {
          try {
            const css = getComputedStyle(panel);
            computedDisplay = css.display;
            computedVisibility = css.visibility;
          } catch {}
        }
        return {
          showFloatingStatus: !!s?.showFloatingStatus,
          roundId: round?.id ?? null,
          roundDismissed: !!round?.dismissed,
          panelExists: !!panel,
          panelHiddenClass: !!panel?.classList?.contains('hidden'),
          computedDisplay,
          computedVisibility,
        };
      },
    };
  }

  function boot() {
    if (!migrateVisibleDefaultOnce()) {
      setTimeout(boot, 150);
      return;
    }
    exposeApi();
    if (window.AnswerMe?.round) window.AnswerMe.round.dismissed = false;
    forceRefresh();
    console.log(`[💢 Answer Me] popup visibility ${VERSION} ready · floating status restored`);
  }

  boot();
})();
