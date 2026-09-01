(() => {
  'use strict';

  const VERSION = '0.6.3-beta.47';
  const FLAG = '__answerMeNativeOnlyBridgeV47';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (!Array.isArray(s.profileIds)) s.profileIds = [];
    return s;
  }

  function currentProfileId() {
    const c = ctx();
    const stored = c?.extensionSettings?.connectionManager?.selectedProfile;
    if (stored !== undefined && stored !== null && String(stored)) return String(stored);
    const select = document.querySelector('#connection_profiles');
    return String(select?.value ?? '');
  }

  let restoreTimer = null;

  function exposeNativeForCore() {
    const s = settings();
    if (!s) return;
    const nativeOnly = s.zeroSideMode === true || s.profileIds.length === 0;
    if (!nativeOnly || s.profileIds.length) return;

    const id = currentProfileId();
    if (!id) return;

    s.profileIds = [id];
    s.__answerMeNativeOnlyTransientV47 = true;

    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      const latest = settings();
      if (!latest?.__answerMeNativeOnlyTransientV47) return;
      latest.profileIds = [];
      delete latest.__answerMeNativeOnlyTransientV47;
      try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    }, 900);
  }

  async function register() {
    for (let i = 0; i < 120; i += 1) {
      const c = ctx();
      const events = c?.eventTypes || c?.event_types;
      if (c?.eventSource && events) {
        if (events.GENERATION_STARTED) c.eventSource.on(events.GENERATION_STARTED, exposeNativeForCore);
        if (events.CHAT_COMPLETION_SETTINGS_READY) c.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, exposeNativeForCore);
        if (events.GENERATE_AFTER_DATA) c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => { if (!dryRun) exposeNativeForCore(); });
        console.log(`[💢 Answer Me] native-only bridge ${VERSION} ready · native-only race held through mobile event ordering`);
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.warn(`[💢 Answer Me] native-only bridge ${VERSION}: event source unavailable`);
    return false;
  }

  window.__AnswerMeNativeBridgeReadyV47 = register();
})();
