(() => {
  'use strict';
  const VERSION = '0.5.8-beta.42';
  const FLAG = '__answerMeConnectionOwnershipV42';
  const SERVICE_FLAG = '__answerMeConnectionOwnershipServiceV42';
  const ROUTER_FLAG = '__answerMeConnectionOwnershipRouterV42';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const settings = () => {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    return c.extensionSettings.answerMe;
  };
  const profiles = () => {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  };
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function snapshotNative() {
    const c = ctx();
    const models = {};
    for (const p of profiles()) models[String(p.id)] = p.model;
    const stream = {};
    for (const selector of ['#stream_toggle', '#streaming']) {
      const input = document.querySelector(selector);
      if (input?.type === 'checkbox') stream[selector] = !!input.checked;
    }
    return {
      selectedProfile: String(c?.extensionSettings?.connectionManager?.selectedProfile ?? ''),
      models,
      stream,
    };
  }

  async function waitConnectionIdle(timeout = 6500) {
    const spinner = document.querySelector('#connection_profile_spinner');
    if (!spinner) { await sleep(320); return; }
    const started = Date.now();
    let sawBusy = !spinner.classList.contains('hidden');
    while (Date.now() - started < timeout) {
      if (!spinner.classList.contains('hidden')) sawBusy = true;
      if ((!sawBusy && Date.now() - started > 350) || (sawBusy && spinner.classList.contains('hidden'))) return;
      await sleep(80);
    }
  }

  function captureRaceModels() {
    const s = settings();
    if (!s) return;
    const wanted = new Set((Array.isArray(s.profileIds) ? s.profileIds : []).map(String));
    const map = { ...(s.raceModelByProfileId || {}) };
    for (const p of profiles()) {
      const id = String(p.id);
      if (wanted.has(id) && p.model) map[id] = String(p.model);
    }
    s.raceModelByProfileId = map;
    save();
  }

  async function restoreNative(snapshot) {
    const c = ctx();
    if (!c || !snapshot) return;

    const selectedNow = String(c.extensionSettings?.connectionManager?.selectedProfile ?? '');
    if (snapshot.selectedProfile && selectedNow !== snapshot.selectedProfile) {
      const select = document.querySelector('#connection_profiles');
      if (select) {
        select.value = snapshot.selectedProfile;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await waitConnectionIdle();
      }
      c.extensionSettings.connectionManager.selectedProfile = snapshot.selectedProfile;
    }

    // Restore saved Connection Profile models after any profile apply has completed.
    for (const p of profiles()) {
      const id = String(p.id);
      if (Object.prototype.hasOwnProperty.call(snapshot.models, id)) p.model = snapshot.models[id];
    }

    // Answer Me transport choice is side-request-only. Never touch native ST streaming.
    for (const [selector, checked] of Object.entries(snapshot.stream || {})) {
      const input = document.querySelector(selector);
      if (!input || input.type !== 'checkbox' || !!input.checked === checked) continue;
      input.checked = checked;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    save();
  }

  function assignmentFor(profileId) {
    const id = String(profileId);
    const s = settings();
    const direct = String(s?.raceModelByProfileId?.[id] || '');
    if (direct) return direct;
    const p = profiles().find(x => String(x?.id) === id);
    const name = String(p?.name || '');
    const row = (Array.isArray(s?.lastModelAssignments) ? s.lastModelAssignments : [])
      .find(x => String(x?.profile || '') === id || (name && String(x?.profile || '') === name));
    return String(row?.model || '');
  }

  function wrapService() {
    const service = ctx()?.ConnectionManagerRequestService;
    if (!service?.sendRequest) return false;
    if (service[SERVICE_FLAG]) return true;
    const original = service.sendRequest.bind(service);
    service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
      if (!custom?.answerMeRace) return await original(profileId, prompt, maxTokens, custom, overridePayload);
      const model = assignmentFor(profileId);
      const merged = model && !Object.prototype.hasOwnProperty.call(overridePayload || {}, 'model')
        ? { ...(overridePayload || {}), model }
        : (overridePayload || {});
      return await original(profileId, prompt, maxTokens, custom, merged);
    };
    service[SERVICE_FLAG] = true;
    return true;
  }

  function wrapRouter() {
    const router = window.AnswerMeModelRouter;
    if (!router || router.version !== '0.3.6-beta.18') return false;
    if (router[ROUTER_FLAG]) return true;

    for (const name of ['select', 'setTransport', 'setFamily']) {
      if (typeof router[name] !== 'function') continue;
      const original = router[name].bind(router);
      router[name] = async (...args) => {
        const native = snapshotNative();
        try {
          return await original(...args);
        } finally {
          captureRaceModels();
          await restoreNative(native);
        }
      };
    }

    if (typeof router.setKeyword === 'function') {
      const original = router.setKeyword.bind(router);
      router.setKeyword = (...args) => {
        const native = snapshotNative();
        const result = original(...args);
        // v18 launches reconcile() asynchronously here. Repair after its likely
        // completion without installing a permanent observer or poller.
        for (const delay of [250, 900, 2200]) {
          setTimeout(() => { captureRaceModels(); void restoreNative(native); }, delay);
        }
        return result;
      };
    }

    router[ROUTER_FLAG] = true;
    return true;
  }

  const bootNative = snapshotNative();

  async function boot() {
    for (let i = 0; i < 120; i += 1) {
      wrapService();
      if (wrapRouter()) {
        // keyword-router v18 performs one reconcile() during boot. Let that
        // finish, preserve its side-model assignments, then give ST its plug back.
        await sleep(700);
        await waitConnectionIdle();
        captureRaceModels();
        await restoreNative(bootNative);
        console.log(`[💢 Answer Me] connection ownership ${VERSION} ready · current ST plug is read-only`);
        return;
      }
      await sleep(100);
    }
    console.warn(`[💢 Answer Me] connection ownership ${VERSION}: router not found`);
  }

  window.AnswerMeConnectionOwnership = {
    version: VERSION,
    assignmentFor,
    captureRaceModels,
    snapshotNative,
  };

  void boot();
})();
