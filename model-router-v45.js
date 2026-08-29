(() => {
  'use strict';

  const VERSION = '0.6.1-beta.45';
  const FLAG = '__answerMeModelRouterV45';
  const SERVICE_FLAG = '__answerMeRaceModelOverrideV45';
  const CATALOG_TTL = 6 * 60 * 60 * 1000;
  const SCAN_CONCURRENCY = 3;
  if (window[FLAG]) return;
  window[FLAG] = true;

  let scanPromise = null;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };
  const profiles = () => {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  };

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (!['stream', 'fake'].includes(s.transportMode)) s.transportMode = 'stream';
    if (typeof s.selectedModelGroup !== 'string') s.selectedModelGroup = '';
    if (typeof s.selectedModelFamily !== 'string') s.selectedModelFamily = '';
    if (!s.modelCatalog || typeof s.modelCatalog !== 'object' || Array.isArray(s.modelCatalog)) s.modelCatalog = {};
    if (!s.raceModelByProfileId || typeof s.raceModelByProfileId !== 'object' || Array.isArray(s.raceModelByProfileId)) s.raceModelByProfileId = {};
    if (!Array.isArray(s.profileIds)) s.profileIds = [];
    if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
    return s;
  }

  function isUsable(profile) {
    const service = ctx()?.ConnectionManagerRequestService;
    if (!profile?.id || !service) return false;
    try { return typeof service.isProfileSupported === 'function' ? service.isProfileSupported(profile) : true; }
    catch { return false; }
  }

  const FAMILY_DEFS = [
    ['gemini', 'Gemini'], ['claude', 'Claude'], ['gpt', 'GPT'], ['glm', 'GLM'],
    ['grok', 'Grok'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['kimi', 'Kimi'],
    ['mistral', 'Mistral'], ['llama', 'Llama'], ['gemma', 'Gemma'],
  ];

  function normalizeRaw(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[／]/g, '/').replace(/[＿]/g, '_').replace(/[－—–]/g, '-');
  }

  function familyInfo(model) {
    const raw = normalizeRaw(model);
    let hit = null;
    for (const [needle, name] of FAMILY_DEFS) {
      const index = raw.indexOf(needle);
      if (index < 0) continue;
      if (!hit || index < hit.index) hit = { needle, name, index };
    }
    return hit;
  }

  function autoTransport(model) {
    const raw = normalizeRaw(model);
    return /(?:假流式|假流|伪流式|伪流|非流式|整包|fake[\s._-]*stream|non[\s._-]*stream|whole[\s._-]*(?:response|stream))/.test(raw)
      ? 'fake' : 'stream';
  }

  function versionOf(model) {
    const family = familyInfo(model);
    const raw = normalizeRaw(model);
    const tail = family ? raw.slice(family.index) : raw;
    let m = tail.match(/(?:^|[^0-9])(\d{1,2})[._-](\d{1,2})(?=[^0-9]|$)/);
    if (m) return `${Number(m[1])}.${Number(m[2])}`;
    m = tail.match(/(?:^|[^0-9])(\d)(?=[^0-9]|$)/);
    return m ? String(Number(m[1])) : '';
  }

  function variantOf(model) {
    const raw = normalizeRaw(model);
    const ordered = [
      'non-reasoning', 'reasoning', 'multi-agent', 'flash-lite', 'flash-image', 'flash', 'pro',
      'opus', 'sonnet', 'haiku', 'turbo', 'mini', 'lite', 'thinking', 'chat-fast', 'chat',
    ];
    return ordered.find(token => raw.includes(token)) || '';
  }

  function canonicalKeyword(model) {
    const family = familyInfo(model);
    const version = versionOf(model);
    if (!family || !version) return '';
    const variant = variantOf(model);
    return `${family.needle}-${version}${variant ? `-${variant}` : ''}`;
  }

  function classifyModel(profileId, model) {
    const family = familyInfo(model);
    const version = versionOf(model);
    const transport = autoTransport(model);
    const keyword = canonicalKeyword(model);
    return {
      raw: String(model || ''),
      family: family?.name || '',
      familyNeedle: family?.needle || '',
      version,
      keyword,
      transport,
      ignored: !family || !version || !keyword,
    };
  }

  function normalizeModelList(json, fallback = '') {
    let list = [];
    if (Array.isArray(json)) list = json;
    else if (Array.isArray(json?.data)) list = json.data;
    else if (Array.isArray(json?.models)) list = json.models;
    else if (Array.isArray(json?.data?.data)) list = json.data.data;
    const ids = list.map(item => typeof item === 'string' ? item : (item?.id ?? item?.name ?? item?.model ?? ''))
      .map(x => String(x || '').trim()).filter(Boolean);
    if (fallback) ids.push(String(fallback));
    return [...new Set(ids)];
  }

  function fallbackCatalog(profile, error = '') {
    return {
      models: profile?.model ? [String(profile.model)] : [],
      scannedAt: Date.now(),
      fallback: true,
      error: String(error || ''),
    };
  }

  async function fetchModelsForProfile(profile) {
    const c = ctx();
    if (!c || !profile) return fallbackCatalog(profile, '酒馆上下文不可用');
    const apiMap = c.CONNECT_API_MAP?.[profile.api];
    if (!apiMap || apiMap.selected !== 'openai' || !apiMap.source) return fallbackCatalog(profile, '此连接类型暂不支持自动扫模型');
    const body = {
      chat_completion_source: apiMap.source,
      custom_url: profile['api-url'],
      secret_id: profile['secret-id'],
      vertexai_region: profile['api-url'],
      zai_endpoint: profile['api-url'],
      siliconflow_endpoint: profile['api-url'],
      minimax_endpoint: profile['api-url'],
    };
    try {
      const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST', headers: c.getRequestHeaders(), cache: 'no-cache', body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.error === true) return fallbackCatalog(profile, `模型列表请求失败 ${response.status || ''}`.trim());
      const models = normalizeModelList(json, profile.model);
      return models.length ? { models, scannedAt: Date.now(), fallback: false, error: '' } : fallbackCatalog(profile, '站点没有返回模型列表');
    } catch (error) {
      return fallbackCatalog(profile, error?.message || error || '扫描失败');
    }
  }

  function cacheFresh(profile) {
    const item = settings()?.modelCatalog?.[profile.id];
    return !!(item && Array.isArray(item.models) && item.models.length && Date.now() - Number(item.scannedAt || 0) < CATALOG_TTL);
  }

  async function mapLimited(items, limit, worker) {
    const result = new Array(items.length);
    let cursor = 0;
    async function runner() {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        result[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return result;
  }

  async function scanAll(force = false) {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const s = settings();
      if (!s) return [];
      const usable = profiles().filter(isUsable);
      const targets = usable.filter(p => force || !cacheFresh(p));
      if (targets.length) {
        const scanned = await mapLimited(targets, SCAN_CONCURRENCY, fetchModelsForProfile);
        scanned.forEach((entry, index) => { s.modelCatalog[targets[index].id] = entry; });
        save();
      }
      return usable;
    })().finally(() => {
      scanPromise = null;
      try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    });
    return scanPromise;
  }

  function modelList(profile) {
    const cached = settings()?.modelCatalog?.[profile?.id];
    const list = Array.isArray(cached?.models) ? [...cached.models] : [];
    if (profile?.model) list.push(profile.model);
    return [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];
  }

  function records(mode = settings()?.transportMode || 'stream', familyFilter = '') {
    const out = [];
    for (const profile of profiles().filter(isUsable)) {
      for (const model of modelList(profile)) {
        const info = classifyModel(profile.id, model);
        if (info.ignored || info.transport !== mode) continue;
        if (familyFilter && info.family !== familyFilter) continue;
        out.push({ profile, model, ...info });
      }
    }
    return out;
  }

  function families(mode = settings()?.transportMode || 'stream') {
    const counts = new Map();
    for (const rec of records(mode)) {
      if (!counts.has(rec.family)) counts.set(rec.family, new Set());
      counts.get(rec.family).add(String(rec.profile.id));
    }
    return [...counts.entries()].map(([name, ids]) => ({ name, count: ids.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function activeFamily(mode = settings()?.transportMode || 'stream') {
    const s = settings();
    const available = families(mode);
    if (s?.selectedModelFamily && available.some(x => x.name === s.selectedModelFamily)) return s.selectedModelFamily;
    const currentId = String(ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? '');
    const current = profiles().find(p => String(p.id) === currentId);
    const currentFamily = current?.model ? classifyModel(current.id, current.model).family : '';
    if (currentFamily && available.some(x => x.name === currentFamily)) return currentFamily;
    return available[0]?.name || '';
  }

  function buildGroups(mode = settings()?.transportMode || 'stream', family = activeFamily(mode)) {
    if (!family) return [];
    const byVersion = new Map();
    for (const rec of records(mode, family)) {
      if (!byVersion.has(rec.version)) byVersion.set(rec.version, []);
      byVersion.get(rec.version).push(rec);
    }
    const result = [];
    for (const [version, recs] of byVersion.entries()) {
      const matches = new Map();
      const models = new Set();
      for (const rec of recs) {
        const id = String(rec.profile.id);
        if (!matches.has(id)) matches.set(id, []);
        matches.get(id).push(rec.model);
        models.add(rec.model);
      }
      for (const [id, list] of matches) matches.set(id, [...new Set(list)]);
      const keywordCounts = new Map();
      for (const rec of recs) keywordCounts.set(rec.keyword, (keywordCounts.get(rec.keyword) || 0) + 1);
      const keyword = [...keywordCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || '';
      result.push({ key: `${family}:${version}`, label: version, display: version, version, family, keyword, matches, models, profileCount: matches.size, transportMode: mode });
    }
    result.sort((a, b) => Number.parseFloat(b.version) - Number.parseFloat(a.version) || b.profileCount - a.profileCount || a.version.localeCompare(b.version));
    return result;
  }

  function selectedGroup(mode = settings()?.transportMode || 'stream') {
    const family = activeFamily(mode);
    const list = buildGroups(mode, family);
    const s = settings();
    return list.find(g => g.key === s?.selectedModelGroup) || list[0] || null;
  }

  function chooseModel(profile, candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return '';
    const previous = String(settings()?.raceModelByProfileId?.[profile.id] || '');
    if (previous && candidates.includes(previous)) return previous;
    if (profile?.model && candidates.includes(profile.model)) return String(profile.model);
    return [...candidates].sort((a, b) => String(a).length - String(b).length || String(a).localeCompare(String(b)))[0] || '';
  }

  function applyGroup(group, { quiet = false } = {}) {
    const s = settings();
    if (!s || !group) return { ok: false, reason: '没有这个模型档' };
    const disabled = new Set((s.siteDisabledIds || []).map(String));
    const eligible = [...group.matches.keys()].map(String);
    let allowed = eligible.filter(id => !disabled.has(id));
    if (!allowed.length && eligible.length) {
      const first = eligible[0];
      s.siteDisabledIds = (s.siteDisabledIds || []).filter(id => String(id) !== first);
      allowed = [first];
    }
    const map = { ...(s.raceModelByProfileId || {}) };
    const assignments = [];
    for (const id of eligible) {
      const profile = profiles().find(p => String(p.id) === id);
      if (!profile) continue;
      const model = chooseModel(profile, group.matches.get(id) || []);
      if (!model) continue;
      map[id] = model;
      if (allowed.includes(id)) assignments.push({ profile: profile.name || id, profileId: id, model, keyword: canonicalKeyword(model), transportMode: group.transportMode });
    }
    s.raceModelByProfileId = map;
    s.transportMode = group.transportMode;
    s.selectedModelFamily = group.family;
    s.selectedModelGroup = group.key;
    s.profileIds = allowed;
    s.lastModelAssignments = assignments;
    s.lastModelAssignmentsTransport = group.transportMode;
    save();
    try { window.AnswerMe?.refresh?.(); } catch {}
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    if (!quiet) window.toastr?.success?.(`${group.family} ${group.version} · ${group.transportMode === 'stream' ? '真流' : '整包'} · ${allowed.length} 家上场`, '🍚 Answer Me');
    return { ok: true, group, assignments };
  }

  async function selectGroup(key, mode = settings()?.transportMode || 'stream', options = {}) {
    const family = activeFamily(mode);
    const group = buildGroups(mode, family).find(g => g.key === key);
    return applyGroup(group, options);
  }

  async function setTransport(mode, { quiet = false } = {}) {
    if (!['stream', 'fake'].includes(mode)) return { ok: false, reason: '未知传输方式' };
    const s = settings();
    const old = selectedGroup(s?.transportMode || 'stream');
    s.transportMode = mode;
    if (old?.family) s.selectedModelFamily = old.family;
    save();
    const list = buildGroups(mode, activeFamily(mode));
    const target = list.find(g => g.version === old?.version) || list[0];
    if (!target) {
      s.profileIds = [];
      s.lastModelAssignments = [];
      save();
      try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
      return { ok: false, reason: `${s.selectedModelFamily || '当前模型'} 没有${mode === 'stream' ? '真流' : '整包'}匹配` };
    }
    return applyGroup(target, { quiet });
  }

  async function setFamily(family) {
    const s = settings();
    const mode = s?.transportMode || 'stream';
    const oldVersion = selectedGroup(mode)?.version || '';
    s.selectedModelFamily = String(family || '');
    save();
    const list = buildGroups(mode, s.selectedModelFamily);
    const target = list.find(g => g.version === oldVersion) || list[0];
    return target ? applyGroup(target) : { ok: false, reason: '这个系列没有可用模型档' };
  }

  function mountCompatibilityAnchor() {
    const root = document.querySelector('#answer_me_settings');
    if (!root) return false;
    let anchor = root.querySelector('#answer_me_model_router_v14');
    if (!anchor) {
      anchor = document.createElement('div');
      anchor.id = 'answer_me_model_router_v14';
      anchor.dataset.answerMeReadOnlyRouter = '1';
      anchor.style.display = 'none';
      const note = root.querySelector('.answer-me-note') || root.querySelector('.answer-me-head');
      note?.insertAdjacentElement('afterend', anchor);
    }
    return true;
  }

  function wrapRaceModelOverride() {
    const service = ctx()?.ConnectionManagerRequestService;
    if (!service?.sendRequest) return false;
    if (service[SERVICE_FLAG]) return true;
    const original = service.sendRequest.bind(service);
    service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
      if (!custom?.answerMeRace) return await original(profileId, prompt, maxTokens, custom, overridePayload);
      const model = String(settings()?.raceModelByProfileId?.[String(profileId)] || '');
      const merged = model ? { ...(overridePayload || {}), model } : (overridePayload || {});
      return await original(profileId, prompt, maxTokens, custom, merged);
    };
    service[SERVICE_FLAG] = true;
    return true;
  }

  window.AnswerMeModelRouter = {
    version: VERSION,
    groups: () => buildGroups(settings()?.transportMode || 'stream', activeFamily(settings()?.transportMode || 'stream')),
    classify: classifyModel,
    canonicalKeyword,
    autoTransport,
    scan: scanAll,
    get selected() { return selectedGroup(settings()?.transportMode || 'stream'); },
    get transportMode() { return settings()?.transportMode || 'stream'; },
    get family() { return activeFamily(settings()?.transportMode || 'stream'); },
    select: async key => await selectGroup(key),
    setTransport,
    setFamily,
    setKeyword() { return false; },
  };

  async function boot() {
    for (let i = 0; i < 120; i++) {
      if (ctx() && document.querySelector('#answer_me_settings')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    settings();
    mountCompatibilityAnchor();
    wrapRaceModelOverride();
    await scanAll(false);
    const active = selectedGroup(settings()?.transportMode || 'stream');
    if (active) applyGroup(active, { quiet: true });
    try { window.AnswerMeCompactUI?.refresh?.(); } catch {}
    console.log(`[💢 Answer Me] model router ${VERSION} ready · native ST connection is read-only`);
  }

  void boot().catch(error => {
    console.error(`[💢 Answer Me] model router ${VERSION} failed`, error);
    window.toastr?.error?.(String(error?.message || error || '模型路由启动失败'), '💢 Answer Me');
  });
})();
