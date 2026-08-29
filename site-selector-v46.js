(() => {
  'use strict';

  const VERSION = '0.6.2-beta.46';
  const FLAG = '__answerMeSiteSelectorV46';
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
    if (!Array.isArray(s.profileIds)) s.profileIds = [];
    if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
    if (!s.raceModelByProfileId || typeof s.raceModelByProfileId !== 'object' || Array.isArray(s.raceModelByProfileId)) s.raceModelByProfileId = {};
    if (typeof s.zeroSideMode !== 'boolean') s.zeroSideMode = s.profileIds.length === 0;
    return s;
  }

  function currentProfileId() {
    const c = ctx();
    return String(c?.extensionSettings?.connectionManager?.selectedProfile ?? document.querySelector('#connection_profiles')?.value ?? '');
  }

  const profileById = id => profiles().find(p => String(p?.id) === String(id));

  function eligibleIds() {
    const group = router()?.selected;
    if (!group?.matches?.keys) return [];
    const current = currentProfileId();
    // The current ST connection is the native/main lane, never an extra racer.
    return [...group.matches.keys()].map(String).filter(id => id !== current);
  }

  function selectedIds() {
    const s = settings();
    if (!s || s.zeroSideMode) return [];
    const eligible = new Set(eligibleIds());
    return (s.profileIds || []).map(String).filter(id => eligible.has(id));
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
      rows.push({
        profile: profile.name || String(id),
        profileId: String(id),
        model,
        transportMode: router()?.transportMode || s.transportMode || 'stream',
      });
    }
    s.raceModelByProfileId = map;
    s.lastModelAssignments = rows;
    s.lastModelAssignmentsTransport = router()?.transportMode || s.transportMode || 'stream';
  }

  function commitSelection(allowed) {
    const s = settings();
    if (!s) return false;
    const eligible = eligibleIds();
    const eligibleSet = new Set(eligible);
    allowed = [...new Set((allowed || []).map(String).filter(id => eligibleSet.has(id)))];

    s.zeroSideMode = allowed.length === 0;
    s.profileIds = allowed;

    const disabled = new Set((s.siteDisabledIds || []).map(String).filter(id => !eligibleSet.has(id)));
    for (const id of eligible) if (!allowed.includes(id)) disabled.add(id);
    s.siteDisabledIds = [...disabled];

    rebuildAssignments(allowed);
    if (!allowed.length) s.lastModelAssignments = [];
    save();
    try { window.AnswerMe?.refresh?.(); } catch {}
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    return true;
  }

  async function applySiteFilter() {
    const s = settings();
    if (!s) return false;
    if (s.zeroSideMode) return commitSelection([]);
    return commitSelection(selectedIds());
  }

  async function toggleSite(id) {
    id = String(id);
    const eligible = eligibleIds();
    if (!eligible.includes(id)) return false;
    const selected = new Set(selectedIds());
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    return commitSelection([...selected]);
  }

  async function selectAllEligible() {
    return commitSelection(eligibleIds());
  }

  async function nativeOnly() {
    return commitSelection([]);
  }

  window.AnswerMeSiteSelector = {
    version: VERSION,
    get eligibleIds() { return eligibleIds(); },
    get selectedIds() { return selectedIds(); },
    get disabledIds() {
      const selected = new Set(selectedIds());
      return eligibleIds().filter(id => !selected.has(id));
    },
    toggle: toggleSite,
    selectAll: selectAllEligible,
    onlyCurrent: nativeOnly,
    nativeOnly,
    apply: applySiteFilter,
  };

  async function boot() {
    for (let i = 0; i < 120; i += 1) {
      if (ctx() && router()?.selected) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    try { await router()?.scan?.(false); } catch {}
    document.querySelector('#answer_me_site_selector_v16')?.remove();
    await applySiteFilter();
    console.log(`[💢 Answer Me] site selector ${VERSION} ready · native lane is independent and zero side racers are allowed`);
  }

  void boot().catch(error => console.error(`[💢 Answer Me] site selector ${VERSION} failed`, error));
})();
