(() => {
    'use strict';

    const VERSION = '0.3.6-beta.18';
    const FLAG = '__answerMeKeywordRouterV18';
    const STYLE_ID = 'answer_me_keyword_router_style_v18';
    const UI_ID = 'answer_me_model_router_v14';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    let baseRouter = null;
    let renderTimer = null;
    let applying = false;

    function ctx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function settings() {
        const c = ctx();
        if (!c) return null;
        c.extensionSettings.answerMe ??= {};
        const s = c.extensionSettings.answerMe;
        if (!['stream', 'fake'].includes(s.transportMode)) s.transportMode = 'stream';
        if (typeof s.selectedModelGroup !== 'string') s.selectedModelGroup = '';
        if (typeof s.selectedModelFamily !== 'string') s.selectedModelFamily = '';
        if (typeof s.keywordManualOpen !== 'boolean') s.keywordManualOpen = false;
        if (!s.keywordOverrides || typeof s.keywordOverrides !== 'object' || Array.isArray(s.keywordOverrides)) s.keywordOverrides = {};
        if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
        return s;
    }

    function saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch {}
    }

    function profiles() {
        const list = ctx()?.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(list) ? list : [];
    }

    function profileById(id) {
        return profiles().find(p => String(p?.id) === String(id));
    }

    function isUsable(profile) {
        const service = ctx()?.ConnectionManagerRequestService;
        if (!profile?.id || !service) return false;
        try {
            return typeof service.isProfileSupported === 'function' ? service.isProfileSupported(profile) : true;
        } catch {
            return false;
        }
    }

    function currentProfileId() {
        return String(ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? '');
    }

    function modelList(profile) {
        const cached = settings()?.modelCatalog?.[profile?.id];
        const all = Array.isArray(cached?.models) ? [...cached.models] : [];
        if (profile?.model) all.push(profile.model);
        return [...new Set(all.map(x => String(x || '').trim()).filter(Boolean))];
    }

    const FAMILY_DEFS = [
        { needle: 'gemini', name: 'Gemini' },
        { needle: 'claude', name: 'Claude' },
        { needle: 'gpt', name: 'GPT' },
        { needle: 'glm', name: 'GLM' },
        { needle: 'grok', name: 'Grok' },
        { needle: 'deepseek', name: 'DeepSeek' },
        { needle: 'qwen', name: 'Qwen' },
        { needle: 'kimi', name: 'Kimi' },
        { needle: 'mistral', name: 'Mistral' },
        { needle: 'llama', name: 'Llama' },
        { needle: 'gemma', name: 'Gemma' },
    ];

    function normalizeRaw(value) {
        return String(value || '')
            .normalize?.('NFKC')
            ?.toLowerCase()
            ?.replace(/[／]/g, '/')
            ?.replace(/[＿]/g, '_')
            ?.replace(/[－—–]/g, '-') ?? String(value || '').toLowerCase();
    }

    function familyInfo(model) {
        const raw = normalizeRaw(model);
        let hit = null;
        for (const def of FAMILY_DEFS) {
            const index = raw.indexOf(def.needle);
            if (index < 0) continue;
            if (!hit || index < hit.index) hit = { ...def, index };
        }
        return hit;
    }

    function autoTransport(model) {
        const raw = normalizeRaw(model);
        return /(?:假流式|假流|伪流式|伪流|非流式|整包|fake[\s._-]*stream|non[\s._-]*stream|whole[\s._-]*(?:response|stream))/.test(raw)
            ? 'fake'
            : 'stream';
    }

    function tailFromFamily(model, family) {
        const raw = normalizeRaw(model);
        if (!family) return raw;
        const index = raw.indexOf(family.needle);
        return index >= 0 ? raw.slice(index) : raw;
    }

    function extractVersionFromTail(tail) {
        const m = String(tail || '').match(/(?:^|[^0-9])(\d{1,2})[._-](\d{1,2})(?=[^0-9]|$)/);
        if (m) return `${Number(m[1])}.${Number(m[2])}`;
        const single = String(tail || '').match(/(?:^|[^0-9])(\d)(?=[^0-9]|$)/);
        return single ? String(Number(single[1])) : '';
    }

    function stableVariant(tail) {
        const s = String(tail || '');
        const ordered = [
            'non-reasoning', 'reasoning', 'multi-agent',
            'flash-lite', 'flash-image', 'flash', 'pro',
            'opus', 'sonnet', 'haiku',
            'turbo', 'mini', 'lite', 'thinking', 'chat-fast', 'chat'
        ];
        return ordered.find(token => s.includes(token)) || '';
    }

    function canonicalKeyword(model) {
        const family = familyInfo(model);
        if (!family) return '';
        const tail = tailFromFamily(model, family)
            .replace(/[\/_]+/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
        const version = extractVersionFromTail(tail);
        if (!version) return '';
        const variant = stableVariant(tail);
        return `${family.needle}-${version}${variant ? `-${variant}` : ''}`;
    }

    function classifyModel(profileId, model) {
        const family = familyInfo(model);
        const tail = tailFromFamily(model, family);
        const autoVersion = extractVersionFromTail(tail);
        const keyword = canonicalKeyword(model);
        const legacyKey = `${encodeURIComponent(String(profileId))}::${encodeURIComponent(String(model))}`;
        const legacy = settings()?.modelClassifierOverrides?.[legacyKey] || {};
        const version = String(legacy.version || '').trim() || autoVersion;
        const transport = ['stream', 'fake', 'ignore'].includes(legacy.transport)
            ? legacy.transport
            : autoTransport(model);
        return {
            raw: String(model || ''),
            family: family?.name || '',
            familyNeedle: family?.needle || '',
            version,
            keyword,
            transport,
            ignored: transport === 'ignore' || !family || !version || !keyword,
        };
    }

    function transportMode() {
        return settings()?.transportMode === 'fake' ? 'fake' : 'stream';
    }

    function manualKey(profileId, family, version, mode) {
        return `${encodeURIComponent(String(profileId))}::${family}::${version}::${mode}`;
    }

    function getManualKeyword(profileId, family, version, mode) {
        return String(settings()?.keywordOverrides?.[manualKey(profileId, family, version, mode)] || '').trim().toLowerCase();
    }

    function records(mode = transportMode(), familyFilter = '') {
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

    function families(mode = transportMode()) {
        const counts = new Map();
        for (const rec of records(mode)) {
            if (!counts.has(rec.family)) counts.set(rec.family, new Set());
            counts.get(rec.family).add(String(rec.profile.id));
        }
        return [...counts.entries()]
            .map(([name, ids]) => ({ name, count: ids.size }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }

    function activeFamily(mode = transportMode()) {
        const s = settings();
        const available = families(mode);
        if (s?.selectedModelFamily && available.some(x => x.name === s.selectedModelFamily)) {
            return s.selectedModelFamily;
        }
        const current = profileById(currentProfileId());
        const currentFamily = current?.model ? classifyModel(current.id, current.model).family : '';
        if (currentFamily && available.some(x => x.name === currentFamily)) return currentFamily;
        return available[0]?.name || '';
    }

    function keywordCoverage(versionRecords) {
        const map = new Map();
        for (const rec of versionRecords) {
            if (!map.has(rec.keyword)) map.set(rec.keyword, new Set());
            map.get(rec.keyword).add(String(rec.profile.id));
        }
        return map;
    }

    function preferredKeyword(versionRecords, family, version, mode) {
        const current = profileById(currentProfileId());
        if (current) {
            const currentInfo = classifyModel(current.id, current.model);
            if (currentInfo.family === family && currentInfo.version === version && currentInfo.transport === mode) {
                return currentInfo.keyword;
            }
        }
        const coverage = keywordCoverage(versionRecords);
        return [...coverage.entries()]
            .sort((a, b) => b[1].size - a[1].size || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]?.[0] || '';
    }

    function matchScore(model, targetKeyword) {
        const raw = normalizeRaw(model).replace(/[\/_]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
        const key = canonicalKeyword(model);
        if (!targetKeyword) return 0;
        if (key === targetKeyword) return 100;
        if (raw.includes(targetKeyword)) return 95;
        if (key && (key.includes(targetKeyword) || targetKeyword.includes(key))) return 80;
        const targetParts = targetKeyword.split('-');
        const keyParts = key.split('-');
        if (targetParts[0] === keyParts[0] && targetParts[1] === keyParts[1]) {
            const targetVariant = targetParts.slice(2).join('-');
            const keyVariant = keyParts.slice(2).join('-');
            if (targetVariant && keyVariant && (targetVariant.includes(keyVariant) || keyVariant.includes(targetVariant))) return 70;
        }
        return 0;
    }

    function buildGroups(mode = transportMode(), family = activeFamily(mode)) {
        if (!family) return [];
        const byVersion = new Map();
        for (const rec of records(mode, family)) {
            if (!byVersion.has(rec.version)) byVersion.set(rec.version, []);
            byVersion.get(rec.version).push(rec);
        }

        const result = [];
        for (const [version, versionRecords] of byVersion.entries()) {
            const targetKeyword = preferredKeyword(versionRecords, family, version, mode);
            const matches = new Map();
            const models = new Set();
            const profileMap = new Map();
            for (const rec of versionRecords) {
                const id = String(rec.profile.id);
                if (!profileMap.has(id)) profileMap.set(id, []);
                profileMap.get(id).push(rec);
            }
            for (const [profileId, recs] of profileMap.entries()) {
                const manual = getManualKeyword(profileId, family, version, mode);
                const wanted = manual || targetKeyword;
                const scored = recs.map(rec => ({ rec, score: matchScore(rec.model, wanted) }))
                    .filter(x => x.score > 0)
                    .sort((a, b) => b.score - a.score || String(a.rec.model).length - String(b.rec.model).length);
                if (!scored.length) continue;
                const bestScore = scored[0].score;
                const candidates = scored.filter(x => x.score === bestScore).map(x => x.rec.model);
                matches.set(profileId, candidates);
                candidates.forEach(x => models.add(x));
            }
            if (!matches.size) continue;
            result.push({
                key: `${family}:${version}`,
                label: version,
                display: version,
                version,
                family,
                keyword: targetKeyword,
                matches,
                models,
                profileCount: matches.size,
                transportMode: mode,
            });
        }
        result.sort((a, b) => {
            const av = Number.parseFloat(a.version);
            const bv = Number.parseFloat(b.version);
            if (Number.isFinite(av) && Number.isFinite(bv) && av !== bv) return bv - av;
            return b.profileCount - a.profileCount || a.version.localeCompare(b.version);
        });
        return result;
    }

    function selectedGroup(mode = transportMode()) {
        const family = activeFamily(mode);
        const list = buildGroups(mode, family);
        const s = settings();
        let group = list.find(g => g.key === s?.selectedModelGroup);
        if (group) return group;
        const current = profileById(currentProfileId());
        if (current?.model) {
            const info = classifyModel(current.id, current.model);
            group = list.find(g => g.family === info.family && g.version === info.version);
        }
        return group || list[0] || null;
    }

    function chooseBestModel(profile, candidates, group) {
        if (!Array.isArray(candidates) || !candidates.length) return '';
        const manual = getManualKeyword(profile.id, group.family, group.version, group.transportMode);
        const wanted = manual || group.keyword;
        return candidates.map(model => ({
            model,
            score: (model === profile.model ? 40 : 0) + matchScore(model, wanted),
        })).sort((a, b) => b.score - a.score || String(a.model).length - String(b.model).length)[0]?.model || '';
    }

    function allowedIdsForGroup(group) {
        const disabled = new Set((settings()?.siteDisabledIds || []).map(String));
        let ids = [...group.matches.keys()].map(String).filter(id => !disabled.has(id));
        if (!ids.length && group.matches.size) {
            const first = String(group.matches.keys().next().value);
            settings().siteDisabledIds = settings().siteDisabledIds.filter(id => String(id) !== first);
            ids = [first];
        }
        return ids;
    }

    async function waitProfileApply(timeout = 6000) {
        const spinner = document.querySelector('#connection_profile_spinner');
        if (!spinner) {
            await sleep(420);
            return;
        }
        const started = Date.now();
        let sawBusy = !spinner.classList.contains('hidden');
        while (Date.now() - started < timeout) {
            if (!spinner.classList.contains('hidden')) sawBusy = true;
            if (sawBusy && spinner.classList.contains('hidden')) return;
            await sleep(80);
        }
    }

    async function applyCurrentProfile(targets) {
        if (!targets.length) return null;
        const current = profileById(currentProfileId());
        const currentSite = String(current?.name || '').split(/[·|｜—–]/)[0].replace(/\s+/g, '').toLowerCase();
        const target = targets.find(p => String(p.id) === String(current?.id))
            || (currentSite && targets.find(p => String(p?.name || '').split(/[·|｜—–]/)[0].replace(/\s+/g, '').toLowerCase() === currentSite))
            || targets[0];
        if (!target) return null;
        const select = document.querySelector('#connection_profiles');
        if (select) {
            select.value = target.id;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await waitProfileApply();
        } else {
            ctx().extensionSettings.connectionManager.selectedProfile = target.id;
            saveSettings();
        }
        return target;
    }

    function setNativeStreamMode(mode) {
        const wantStream = mode === 'stream';
        for (const selector of ['#stream_toggle', '#streaming']) {
            const input = document.querySelector(selector);
            if (!input || input.type !== 'checkbox') continue;
            if (!!input.checked === wantStream) continue;
            input.checked = wantStream;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    async function selectGroup(key, mode = transportMode(), { quiet = false } = {}) {
        if (applying) return { ok: false, reason: '正在切模型，请稍等' };
        const group = buildGroups(mode, activeFamily(mode)).find(g => g.key === key);
        if (!group) return { ok: false, reason: '没有这个模型档' };
        applying = true;
        try {
            const allEligible = [];
            const assignments = [];
            for (const profile of profiles().filter(isUsable)) {
                const candidates = group.matches.get(String(profile.id)) || [];
                const model = chooseBestModel(profile, candidates, group);
                if (!model) continue;
                profile.model = model;
                allEligible.push(profile);
                assignments.push({ profile: profile.name || profile.id, model, keyword: canonicalKeyword(model), transportMode: mode });
            }
            if (!allEligible.length) return { ok: false, reason: '没有站匹配到这个关键模型名' };
            const allowedIds = allowedIdsForGroup(group);
            const allowedProfiles = allEligible.filter(p => allowedIds.includes(String(p.id)));
            const s = settings();
            s.transportMode = mode;
            s.selectedModelFamily = group.family;
            s.selectedModelGroup = group.key;
            s.profileIds = allowedIds;
            s.lastModelAssignments = assignments.filter(x => allowedProfiles.some(p => (p.name || p.id) === x.profile));
            s.lastModelAssignmentsTransport = mode;
            saveSettings();
            setNativeStreamMode(mode);
            try { window.AnswerMe?.refresh?.(); } catch {}
            await applyCurrentProfile(allowedProfiles.length ? allowedProfiles : allEligible);
            renderRouter();
            if (!quiet) window.toastr?.success?.(`${group.family} ${group.version} · ${mode === 'stream' ? '真流' : '假流'} · ${allowedIds.length} 家上场`, '🍚 Answer Me');
            return { ok: true, group, selected: allowedProfiles, assignments };
        } finally {
            applying = false;
        }
    }

    async function setTransport(mode, { quiet = false } = {}) {
        if (!['stream', 'fake'].includes(mode)) return { ok: false, reason: '未知传输方式' };
        const s = settings();
        const old = selectedGroup(transportMode());
        const wantedVersion = old?.version || '';
        const wantedFamily = old?.family || activeFamily(transportMode());
        s.transportMode = mode;
        s.selectedModelFamily = wantedFamily;
        saveSettings();
        setNativeStreamMode(mode);
        const same = buildGroups(mode, wantedFamily).find(g => g.version === wantedVersion);
        if (same) return await selectGroup(same.key, mode, { quiet });
        s.profileIds = [];
        s.lastModelAssignments = [];
        saveSettings();
        try { window.AnswerMe?.refresh?.(); } catch {}
        renderRouter();
        const reason = `${wantedFamily || '当前模型'} ${wantedVersion || ''} 没有${mode === 'stream' ? '真流' : '假流'}匹配。`;
        if (!quiet) window.toastr?.warning?.(reason.trim(), '💢 Answer Me');
        return { ok: false, reason };
    }

    async function setFamily(family) {
        const mode = transportMode();
        const oldVersion = selectedGroup(mode)?.version || '';
        const s = settings();
        s.selectedModelFamily = family;
        saveSettings();
        const list = buildGroups(mode, family);
        if (!list.length) {
            renderRouter();
            return;
        }
        const target = list.find(g => g.version === oldVersion) || list[0];
        await selectGroup(target.key, mode);
    }

    function scanStats() {
        const s = settings();
        const usable = profiles().filter(isUsable);
        const full = usable.filter(p => s?.modelCatalog?.[p.id] && s.modelCatalog[p.id].fallback === false).length;
        return { full, total: usable.length };
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #answer_me_model_router{display:none!important}
            #${UI_ID}{margin:10px 0 12px;padding:10px;border-radius:11px;background:rgba(127,127,127,.07);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            #${UI_ID} .am18-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}#${UI_ID} .am18-row+.am18-row{margin-top:9px}
            #${UI_ID} .am18-label{font-weight:750;font-size:.9em;min-width:76px}#${UI_ID} .am18-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1}
            #${UI_ID} .am18-chip{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.08);color:inherit;border-radius:999px;padding:5px 10px;cursor:pointer;line-height:1.2}
            #${UI_ID} .am18-chip.is-active{font-weight:800;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
            #${UI_ID} .am18-chip:disabled{opacity:.45;cursor:wait}#${UI_ID} .am18-count{opacity:.62;font-size:.85em;margin-left:3px}
            #${UI_ID} .am18-family{min-width:120px;max-width:190px;padding:5px 8px;border-radius:8px}
            #${UI_ID} .am18-summary{margin-top:8px;font-size:.83em;opacity:.78;line-height:1.45}
            #${UI_ID} .am18-key{display:inline-block;margin-left:5px;padding:2px 7px;border-radius:999px;background:rgba(127,127,127,.09);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em}
            #${UI_ID} .am18-actions{display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap}#${UI_ID} .am18-action{border:0;background:transparent;color:inherit;opacity:.76;cursor:pointer;padding:2px 0;font-size:.83em}
            #${UI_ID} .am18-small{font-size:.76em;opacity:.62}
            #${UI_ID} .am18-manual{margin-top:9px;padding-top:9px;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            #${UI_ID} .am18-manual-note{font-size:.78em;opacity:.64;line-height:1.45;margin-bottom:7px}
            #${UI_ID} details.am18-site{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10));border-radius:9px;padding:6px 8px;margin:6px 0;background:rgba(127,127,127,.045)}
            #${UI_ID} details.am18-site>summary{cursor:pointer;font-size:.84em;font-weight:700}
            #${UI_ID} .am18-editor{display:grid;gap:7px;margin-top:8px}.am18-field{display:grid;gap:3px}.am18-field>span{font-size:.76em;opacity:.72}
            #${UI_ID} .am18-editor input{width:100%;min-width:0}.am18-auto{font-size:.76em;opacity:.62;word-break:break-word}
            #${UI_ID} .am18-buttons{display:flex;gap:8px;flex-wrap:wrap}
            @media(max-width:700px){#${UI_ID} .am18-label{min-width:100%}#${UI_ID} .am18-chip{padding:6px 11px}#${UI_ID} .am18-family{width:100%;max-width:none}}
        `;
        document.head.appendChild(style);
    }

    function renderManualPanel(box, active) {
        const s = settings();
        if (!s?.keywordManualOpen || !active) return;
        const panel = document.createElement('div');
        panel.className = 'am18-manual';
        const note = document.createElement('div');
        note.className = 'am18-manual-note';
        note.textContent = `只校正当前档：${active.family} ${active.version} · ${transportMode() === 'stream' ? '真流' : '假流'}。不用翻整站模型表，只填“关键模型名”即可。`;
        panel.appendChild(note);
        for (const profile of profiles().filter(isUsable)) {
            const id = String(profile.id);
            const currentCandidates = active.matches.get(id) || [];
            const recs = records(transportMode(), active.family).filter(r => String(r.profile.id) === id && r.version === active.version);
            if (!recs.length) continue;
            const details = document.createElement('details');
            details.className = 'am18-site';
            const summary = document.createElement('summary');
            summary.textContent = `${profile.name || '未命名站'}${currentCandidates.length ? ' · ✓ 已匹配' : ' · ⚠ 未匹配'}`;
            details.appendChild(summary);
            const editor = document.createElement('div');
            editor.className = 'am18-editor';
            const auto = document.createElement('div');
            auto.className = 'am18-auto';
            const autoKeywords = [...new Set(recs.map(r => r.keyword))];
            auto.textContent = `识别到的关键名：${autoKeywords.join(' / ')}`;
            const field = document.createElement('label');
            field.className = 'am18-field';
            field.innerHTML = '<span>手动关键模型名（留空 = 自动）</span>';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = active.keyword || '例如 gemini-3.7-flash';
            input.value = getManualKeyword(id, active.family, active.version, transportMode());
            field.appendChild(input);
            const hint = document.createElement('div');
            hint.className = 'am18-auto';
            hint.textContent = '会在这个站的真实模型 ID 里做包含匹配；前面的站点前缀不重要。';
            const buttons = document.createElement('div');
            buttons.className = 'am18-buttons';
            const save = document.createElement('button');
            save.type = 'button'; save.className = 'menu_button'; save.textContent = '保存校正';
            const reset = document.createElement('button');
            reset.type = 'button'; reset.className = 'menu_button'; reset.textContent = '恢复自动';
            buttons.append(save, reset);
            save.addEventListener('click', async () => {
                const key = manualKey(id, active.family, active.version, transportMode());
                const value = input.value.trim().toLowerCase();
                if (value) settings().keywordOverrides[key] = value;
                else delete settings().keywordOverrides[key];
                saveSettings();
                await reconcile();
                window.toastr?.success?.(`${profile.name || '这个站'} 的关键模型名已保存。`, '✎ Answer Me');
            });
            reset.addEventListener('click', async () => {
                delete settings().keywordOverrides[manualKey(id, active.family, active.version, transportMode())];
                saveSettings();
                input.value = '';
                await reconcile();
                window.toastr?.info?.('已恢复自动关键名匹配。', '✎ Answer Me');
            });
            editor.append(auto, field, hint, buttons);
            details.appendChild(editor);
            panel.appendChild(details);
        }
        box.appendChild(panel);
    }

    function renderRouter() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            const root = document.querySelector('#answer_me_settings');
            if (!root) return;
            installStyle();
            let box = root.querySelector(`#${UI_ID}`);
            if (!box) {
                box = document.createElement('div');
                box.id = UI_ID;
                const old = root.querySelector('#answer_me_model_router');
                if (old?.nextSibling) old.parentNode.insertBefore(box, old.nextSibling);
                else if (old) old.after(box);
                else root.prepend(box);
            }
            const mode = transportMode();
            const family = activeFamily(mode);
            const familyList = families(mode);
            const list = buildGroups(mode, family);
            const active = selectedGroup(mode);
            const stats = scanStats();
            box.replaceChildren();
            if (familyList.length > 1) {
                const familyRow = document.createElement('div');
                familyRow.className = 'am18-row';
                const label = document.createElement('div');
                label.className = 'am18-label';
                label.textContent = '模型系列';
                const select = document.createElement('select');
                select.className = 'am18-family';
                for (const item of familyList) {
                    const option = document.createElement('option');
                    option.value = item.name;
                    option.textContent = `${item.name} · ${item.count} 家`;
                    option.selected = item.name === family;
                    select.appendChild(option);
                }
                select.addEventListener('change', async () => {
                    select.disabled = true;
                    await setFamily(select.value);
                });
                familyRow.append(label, select);
                box.appendChild(familyRow);
            }
            const row1 = document.createElement('div');
            row1.className = 'am18-row';
            const label1 = document.createElement('div');
            label1.className = 'am18-label';
            label1.textContent = '今天吃哪个？';
            const chips = document.createElement('div');
            chips.className = 'am18-chips';
            for (const group of list) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am18-chip ${active?.key === group.key ? 'is-active' : ''}`;
                btn.innerHTML = `${group.version}<span class="am18-count">${group.profileCount}</span>`;
                btn.title = `${group.family} ${group.version} · ${group.keyword}`;
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const r = await selectGroup(group.key, mode);
                    if (!r.ok) window.toastr?.warning?.(r.reason, '🍚 Answer Me');
                });
                chips.appendChild(btn);
            }
            if (!list.length) {
                const empty = document.createElement('span');
                empty.textContent = `没有${mode === 'stream' ? '真流' : '假流'}可匹配模型`;
                empty.style.opacity = '.65';
                chips.appendChild(empty);
            }
            row1.append(label1, chips);
            box.appendChild(row1);
            const row2 = document.createElement('div');
            row2.className = 'am18-row';
            const label2 = document.createElement('div');
            label2.className = 'am18-label';
            label2.textContent = '传输方式';
            const modes = document.createElement('div');
            modes.className = 'am18-chips';
            for (const [value, text] of [['stream','🟢 真流式'],['fake','📦 假流式']]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am18-chip ${mode === value ? 'is-active' : ''}`;
                btn.textContent = text;
                btn.addEventListener('click', async () => {
                    if (value === transportMode() || applying) return;
                    btn.disabled = true;
                    await setTransport(value);
                });
                modes.appendChild(btn);
            }
            row2.append(label2, modes);
            box.appendChild(row2);
            const summary = document.createElement('div');
            summary.className = 'am18-summary';
            if (active) {
                summary.innerHTML = `当前：<strong>${active.family} ${active.version}</strong> · ${active.profileCount}/${stats.total} 家匹配 · ${mode === 'stream' ? '真流式' : '假流式'} <span class="am18-key">${active.keyword}</span>`;
            } else {
                summary.textContent = `当前：${family || '未选系列'} · ${mode === 'stream' ? '真流式' : '假流式'} · 暂无模型档`;
            }
            box.appendChild(summary);
            const actions = document.createElement('div');
            actions.className = 'am18-actions';
            const scan = document.createElement('button');
            scan.type = 'button';
            scan.className = 'am18-action';
            scan.textContent = '↻ 重扫模型';
            scan.addEventListener('click', async () => {
                scan.disabled = true;
                try {
                    await baseRouter?.scan?.(true);
                    await reconcile();
                    window.toastr?.success?.('模型表已重扫并重新提取关键模型名。', '🍚 Answer Me');
                } finally {
                    renderRouter();
                }
            });
            const manual = document.createElement('button');
            manual.type = 'button';
            manual.className = 'am18-action';
            const manualCount = Object.keys(settings()?.keywordOverrides || {}).length;
            manual.textContent = `${settings()?.keywordManualOpen ? '▾' : '▸'} 手动校正${manualCount ? `（${manualCount}）` : ''}`;
            manual.addEventListener('click', () => {
                settings().keywordManualOpen = !settings().keywordManualOpen;
                saveSettings();
                renderRouter();
            });
            const state = document.createElement('span');
            state.className = 'am18-small';
            state.textContent = `${stats.full}/${stats.total} 家已读完整模型表`;
            actions.append(scan, manual, state);
            box.appendChild(actions);
            renderManualPanel(box, active);
        }, 30);
    }

    async function reconcile() {
        const mode = transportMode();
        const s = settings();
        const family = activeFamily(mode);
        const list = buildGroups(mode, family);
        const wantedVersion = String(s?.selectedModelGroup || '').split(':').pop();
        const group = list.find(g => g.version === wantedVersion) || selectedGroup(mode) || list[0];
        if (group) await selectGroup(group.key, mode, { quiet: true });
        else {
            s.profileIds = [];
            s.lastModelAssignments = [];
            saveSettings();
            try { window.AnswerMe?.refresh?.(); } catch {}
            renderRouter();
        }
        try { await window.AnswerMeSiteSelector?.apply?.(); } catch {}
    }

    function installPublicApi() {
        window.AnswerMeModelRouterV13 = baseRouter;
        window.AnswerMeModelRouter = {
            version: VERSION,
            groups: () => buildGroups(transportMode(), activeFamily(transportMode())),
            classify: classifyModel,
            canonicalKeyword,
            autoTransport,
            scan: async force => {
                const result = await baseRouter?.scan?.(force);
                renderRouter();
                return result;
            },
            get selected() { return selectedGroup(transportMode()); },
            get transportMode() { return transportMode(); },
            get family() { return activeFamily(transportMode()); },
            select: async key => await selectGroup(key, transportMode()),
            setTransport: async mode => await setTransport(mode),
            setFamily,
            setKeyword(profileId, family, version, mode, keyword) {
                const key = manualKey(profileId, family, version, mode);
                const value = String(keyword || '').trim().toLowerCase();
                if (value) settings().keywordOverrides[key] = value;
                else delete settings().keywordOverrides[key];
                saveSettings();
                void reconcile();
                return true;
            },
        };
    }

    async function boot() {
        if (window[FLAG]) return;
        window[FLAG] = true;
        for (let i = 0; i < 120; i++) {
            if (ctx() && window.AnswerMeModelRouter?.groups) break;
            await sleep(100);
        }
        baseRouter = window.AnswerMeModelRouter;
        if (!baseRouter?.groups) throw new Error('基础模型扫描器未就绪');
        installStyle();
        installPublicApi();
        try { await baseRouter.scan?.(false); } catch {}
        await sleep(180);
        await reconcile();
        const timer = setInterval(() => {
            if (document.querySelector('#answer_me_settings') && !document.querySelector(`#${UI_ID}`)) renderRouter();
        }, 900);
        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
        console.log(`[💢 Answer Me] keyword router ${VERSION} ready · 关键模型名匹配 + 紧凑 UI`);
    }

    boot().catch(error => {
        console.error('[💢 Answer Me] keyword router v18 startup failed', error);
        window.toastr?.error?.(String(error?.message || error || '关键模型名路由启动失败'), '💢 Answer Me');
    });
})();