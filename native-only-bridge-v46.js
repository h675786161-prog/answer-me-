(() => {
  'use strict';

  const VERSION = '0.6.2-beta.46';
  const FLAG = '__answerMeNativeOnlyBridgeV46';
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
    if (stored !== undefined && stored !== null) return String(stored);
    return String(document.querySelector('#connection_profiles')?.value ?? '');
  }

  let restoreTimer = null;

  function exposeNativeForCore() {
    const s = settings();
    if (!s) return;
    const nativeOnly = s.zeroSideMode === true || s.profileIds.length === 0;
    if (!nativeOnly || s.profileIds.length) return;

    // race-core-v35 historically refuses to start unless one profile id is
    // selected. Expose the current native profile only for this event turn so
    // the legacy core creates a one-candidate native round. No setting is saved.
    s.profileIds = [currentProfileId()];
    s.__answerMeNativeOnlyTransientV46 = true;

    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      const latest = settings();
      if (!latest?.__answerMeNativeOnlyTransientV46) return;
      latest.profileIds = [];
      delete latest.__answerMeNativeOnlyTransientV46;
      try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    }, 0);
  }

  async function boot() {
    for (let i = 0; i < 120; i += 1) {
      const c = ctx();
      const events = c?.eventTypes || c?.event_types;
      if (c?.eventSource && events) {
        if (events.CHAT_COMPLETION_SETTINGS_READY) c.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, exposeNativeForCore);
        if (events.GENERATE_AFTER_DATA) c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => { if (!dryRun) exposeNativeForCore(); });
        console.log(`[💢 Answer Me] native-only bridge ${VERSION} ready · zero side racers still starts native retry round`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.warn(`[💢 Answer Me] native-only bridge ${VERSION}: event source unavailable`);
  }

  void boot();
})();
