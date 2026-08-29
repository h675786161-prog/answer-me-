(() => {
  'use strict';

  const VERSION = '0.6.1-beta.45';
  const FLAG = '__answerMeSiteSelectorV45';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const router = () => window.AnswerMeModelRouter ?? null;
  const profiles = () => {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  };
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
    if (!Array.isArray(s.profileIds)) s.profileIds = [];
    if (!s.raceModelByProfileId || typeof s.raceModelByProfileId !== 'object' || Array.isArray(s.raceModelByProfileId)) s.raceModelByProfileId = {};
    return s;
  }

  const currentProfileId = () => String(ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? '');
  const profileById = id => profiles().find(p => String(p?.id) === String(id));

  function eligibleIds() {
    const group = router()?.selected;
    return group?.matches?.keys ? [...group.matches.keys()].map(String) : [];
  }

  function selectedIds() {
    const s = settings();
    if (!s) return [];
    const eligible = new Set(eligibleIds());
    const selected = (s.profileIds || []).map(String).filter(id => eligible.has(id));
    if (selected.length) return selected;
    const current = currentProfileId();
    if ((s.profileIds || []).map(String).includes(current)) return [current];
    return [];
  }

  function chooseModel(id) {
    const s = settings();
    const group = router()?.selected;
    const candidates = group?.matches?.get?.(String(id)) || [];
    const saved = String(s?.raceModelByProfileId?.[String(id)] || '');
    if (saved && candidates.includes(saved)) return saved;
    const profile = profileById(id);
    if (profile?.model && candidates.includes(profile.model)) return String(profile.model);
    return candidates[0] || '';
  }

  function rebuildAssignments(allowed) {
    const s = settings();
    const group = router()?.selected;
    if (!s || !group) return;
    const map = { ...(s.raceModelByProfileId || {}) };
    const rows = [];
    for (const id of allowed) {
      const model = chooseModel(id);
      const profile = profileById(id);
      if (!model || !profile) continue;
      map[String(id)] = model;
      rows.push({ profile: profile.name || String(id), profileId: String(id), model, transportMode: router()?.transportMode || s.transportMode || 'stream' });
    }
    s.raceModelByProfileId = map;
    s.lastModelAssignments = rows;
    s.lastModelAssignmentsTransport = router()?.transportMode || s.transportMode || 'stream';
  }

  async function applySiteFilter({ notify = false } = {}) {
    const s = settings();
    const eligible = eligibleIds();
    if (!s || !eligible.length) return false;
    const disabled = new Set((s.siteDisabledIds || []).map(String));
    let allowed = eligible.filter(id => !disabled.has(id));
    if (!allowed.length) {
      const first = eligible[0];
      disabled.delete(first);
      s.siteDisabledIds = [...disabled];
      allowed = [first];
      if (notify) window.toastr?.warning?.('至少留一家支线参赛，已经把第一家放回来了。', '💢 Answer Me');
    }
    s.profileIds = [...allowed];
    rebuildAssignments(allowed);
    save();
    try { window.AnswerMe?.refresh?.(); } catch {}
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    return true;
  }

  async function toggleSite(id) {
    const s = settings();
    const eligible = eligibleIds();
    id = String(id);
    if (!s || !eligible.includes(id)) return false;
    const disabled = new Set((s.siteDisabledIds || []).map(String));
    const currentlyOn = !disabled.has(id);
    const onCount = eligible.filter(x => !disabled.has(x)).length;
    if (currentlyOn && onCount <= 1) {
      window.toastr?.warning?.('至少留一家支线参赛。', '💢 Answer Me');
      return false;
    }
    if (currentlyOn) disabled.add(id); else disabled.delete(id);
    s.siteDisabledIds = [...disabled];
    save();
    return await applySiteFilter();
  }

  async function selectAllEligible() {
    const s = settings();
    if (!s) return false;
    const eligible = new Set(eligibleIds());
    s.siteDisabledIds = (s.siteDisabledIds || []).filter(id => !eligible.has(String(id)));
    save();
    return await applySiteFilter();
  }

  async function selectOnlyCurrent() {
    const s = settings();
    if (!s) return false;
    const current = currentProfileId();
    const eligible = eligibleIds();
    if (eligible.includes(current)) {
      const disabled = new Set((s.siteDisabledIds || []).map(String));
      for (const id of eligible) id === current ? disabled.delete(id) : disabled.add(id);
      s.siteDisabledIds = [...disabled];
      s.profileIds = [current];
      rebuildAssignments([current]);
      save();
    } else {
      s.profileIds = current ? [current] : [];
      s.lastModelAssignments = [];
      save();
      window.toastr?.info?.('当前插头不属于这个支线模型档；已只保留酒馆原生主线路，不会切你的插头。', '💢 Answer Me');
    }
    try { window.AnswerMe?.refresh?.(); } catch {}
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    return true;
  }

  window.AnswerMeSiteSelector = {
    version: VERSION,
    get eligibleIds() { return eligibleIds(); },
    get selectedIds() { return selectedIds(); },
    get disabledIds() { return [...new Set(settings()?.siteDisabledIds || [])]; },
    toggle: toggleSite,
    selectAll: selectAllEligible,
    onlyCurrent: selectOnlyCurrent,
    apply: applySiteFilter,
  };

  async function boot() {
    for (let i = 0; i < 120; i++) {
      if (ctx() && router()?.selected) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    document.querySelector('#answer_me_site_selector_v16')?.remove();
    await applySiteFilter();
    console.log(`[💢 Answer Me] site selector ${VERSION} ready · never changes native Connection Profile`);
  }

  void boot().catch(error => console.error(`[💢 Answer Me] site selector ${VERSION} failed`, error));
})();
