(() => {
  'use strict';

  const VERSION = '0.6.3-beta.47';
  const FLAG = '__answerMeNativeOnlyBridgeV47';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  let restoreTimer = null;
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

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
    return String(document.querySelector('#connection_profiles')?.value ?? '');
  }

  function restoreTransient() {
    const s = settings();
    if (!s?.__answerMeNativeOnlyTransientV47) return;
    s.profileIds = [];
    delete s.__answerMeNativeOnlyTransientV47;
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
  }

  function exposeNativeForCore() {
    const s = settings();
    if (!s) return;
    const nativeOnly = s.zeroSideMode === true || s.profileIds.length === 0;
    if (!nativeOnly) return;
    const current = currentProfileId();
    if (!current) return;

    s.profileIds = [current];
    s.__answerMeNativeOnlyTransientV47 = true;

    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreTransient, 0);
  }

  function register() {
    const c = ctx();
    const events = c?.eventTypes || c?.event_types;
    if (!c?.eventSource || !events) return false;

    if (events.CHAT_COMPLETION_SETTINGS_READY) c.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, exposeNativeForCore);
    if (events.GENERATE_AFTER_DATA) c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => { if (!dryRun) exposeNativeForCore(); });

    readyResolve?.(true);
    readyResolve = null;
    console.log(`[💢 Answer Me] native-only bridge ${VERSION} ready · registration is guaranteed before race core`);
    return true;
  }

  window.AnswerMeNativeOnlyBridgeV47 = { version: VERSION, ready, expose: exposeNativeForCore };

  if (!register()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (register() || tries >= 120) {
        clearInterval(timer);
        if (tries >= 120 && readyResolve) {
          readyResolve(false);
          readyResolve = null;
          console.warn(`[💢 Answer Me] native-only bridge ${VERSION}: event source unavailable`);
        }
      }
    }, 100);
  }
})();
