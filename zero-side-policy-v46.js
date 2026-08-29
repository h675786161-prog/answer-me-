(() => {
  'use strict';

  const VERSION = '0.6.2-beta.46';
  const FLAG = '__answerMeZeroSidePolicyV46';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (!Array.isArray(s.profileIds)) s.profileIds = [];
    if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
    if (typeof s.zeroSideMode !== 'boolean') s.zeroSideMode = s.profileIds.length === 0;
    return s;
  }

  function eligibleIds() {
    const group = window.AnswerMeModelRouter?.selected;
    return group?.matches?.keys ? [...group.matches.keys()].map(String) : [];
  }

  function enforceZero() {
    const s = settings();
    if (!s?.zeroSideMode) return false;
    const eligible = eligibleIds();
    s.profileIds = [];
    s.siteDisabledIds = [...new Set([...(s.siteDisabledIds || []).map(String), ...eligible])];
    s.lastModelAssignments = [];
    save();
    try { window.AnswerMe?.refresh?.(); } catch {}
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    return true;
  }

  function wrapRouter() {
    const router = window.AnswerMeModelRouter;
    if (!router || router.__answerMeZeroSideWrappedV46) return !!router;

    for (const name of ['select', 'setTransport', 'setFamily']) {
      if (typeof router[name] !== 'function') continue;
      const original = router[name].bind(router);
      router[name] = async (...args) => {
        const keepZero = settings()?.zeroSideMode === true;
        const result = await original(...args);
        if (keepZero) {
          settings().zeroSideMode = true;
          enforceZero();
        }
        try { await window.AnswerMeSiteSelector?.apply?.(); } catch {}
        return result;
      };
    }

    router.__answerMeZeroSideWrappedV46 = true;
    return true;
  }

  async function boot() {
    for (let i = 0; i < 120; i += 1) {
      if (ctx() && wrapRouter()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const router = window.AnswerMeModelRouter;
    try { await router?.scan?.(false); } catch {}
    // model-router-v45 performs a quiet apply after its scan. We register this
    // continuation later, so this cleanup runs after that legacy boot apply.
    enforceZero();

    window.AnswerMeZeroSidePolicy = {
      version: VERSION,
      get enabled() { return settings()?.zeroSideMode === true; },
      enforce: enforceZero,
      set(value) {
        const s = settings();
        if (!s) return false;
        s.zeroSideMode = !!value;
        if (s.zeroSideMode) enforceZero();
        else save();
        return true;
      },
    };

    console.log(`[💢 Answer Me] zero-side policy ${VERSION} ready · no forced side racer`);
  }

  void boot().catch(error => console.error(`[💢 Answer Me] zero-side policy ${VERSION} failed`, error));
})();
