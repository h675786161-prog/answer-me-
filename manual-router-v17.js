(() => {
    'use strict';

    const VERSION = '0.3.5-beta.17';
    const FLAG = '__answerMeManualRouterV17';
    const STYLE_ID = 'answer_me_manual_router_style_v17';
    // 沿用 v14 的 DOM id，给 site-selector-v16 当稳定锚点；beta17 不再加载 transport-catalog-v14。
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
        if (!s.modelClassifierOverrides || typeof s.modelClassifierOverrides !== 'object' || Array.isArray(s.modelClassifierOverrides)) s.modelClassifierOverrides = {};
        if (typeof s.modelClassifierOpen !== 'boolean') s.modelClassifierOpen = false;
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

    function profileById(id) {
        return profiles().find(p => String(p?.id) === String(id));
    }

    function modelList(profile) {
        const cached = settings()?.modelCatalog?.[profile?.id];
        const all = Array.isArray(cached?.models) ? [...cached.models] : [];
        if (profile?.model) all.push(profile.model);
        return [...new Set(all.map(x => String(x || '').trim()).filter(Boolean))];
    }

    function overrideKey(profileId, model) {
        return `${encodeURIComponent(String(profileId))}::${encodeURIComponent(String(model))}`;
    }

    function getOverride(profileId, model) {
        return settings()?.modelClassifierOverrides?.[overrideKey(profileId, model)] || null;
    }

    function familyOf(model) {
        const s = String(model || '').toLowerCase();
        const families = [
            ['gemini', 'Gemini'], ['gpt', 'GPT'], ['claude', 'Claude'], ['glm', 'GLM'],
            ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['grok', 'Grok'], ['kimi', 'Kimi'],
            ['mistral', 'Mistral'], ['llama', 'Llama'], ['gemma', 'Gemma'],
        ];
        return families.find(([needle]) => s.includes(needle))?.[1] || '';
    }

    function autoTransport(model) {
        const raw = String(model || '');
        return /(?:假流式|假流|伪流式|伪流|非流式|整包|fake[\s._-]*stream|non[\s._-]*stream|whole[\s._-]*(?:response|stream))/i.test(raw)
            ? 'fake'
            : 'stream';
    }

    function autoInfo(model) {
        const info = baseRouter?.extractVersion?.(model) || {};
        return {
            version: String(info.version || ''),
            family: String(info.family || familyOf(model) || ''),
            raw: String(model || ''),
        };
    }

    function classify(profileId, model) {
        const auto = autoInfo(model);
        const override = getOverride(profileId, model) || {};
        const transport = ['stream', 'fake', 'ignore'].includes(override.transport)
            ? override.transport
            : autoTransport(model);
        const version = String(override.version || '').trim() || auto.version;
        const family = auto.family || familyOf(model);
        if (transport === 'ignore' || !version) {
            return { ignored: true, version, family, transport, auto, override };
        }
        return {
            ignored: false,
            version,
            family,
            transport,
            auto,
            override,
            key: `${family || 'Model'}:${version}`,
            label: version,
        };
    }

    function transportMode() {
        return settings()?.transportMode === 'fake' ? 'fake' : 'stream';
    }

    function groups(mode = transportMode()) {
        const map = new Map();
        for (const profile of profiles().filter(isUsable)) {
            for (const model of modelList(profile)) {
                const info = classify(profile.id, model);
                if (info.ignored || info.transport !== mode) continue;
                if (!map.has(info.key)) {
                    map.set(info.key, {
                        key: info.key,
                        label: info.label,
                        version: info.version,
                        family: info.family,
                        matches: new Map(),
                        models: new Set(),
                        profileCount: 0,
                        transportMode: mode,
                    });
                }
                const group = map.get(info.key);
                if (!group.matches.has(profile.id)) group.matches.set(profile.id, []);
                group.matches.get(profile.id).push(model);
                group.models.add(model);
            }
        }

        const arr = [...map.values()];
        for (const group of arr) group.profileCount = group.matches.size;
        const collisions = new Map();
        for (const group of arr) collisions.set(group.label, (collisions.get(group.label) || 0) + 1);
        for (const group of arr) {
            group.display = collisions.get(group.label) > 1 && group.family ? `${group.family} ${group.label}` : group.label;
        }
        arr.sort((a, b) => {
            const av = Number.parseFloat(a.version);
            const bv = Number.parseFloat(b.version);
            if (Number.isFinite(av) && Number.isFinite(bv) && av !== bv) return bv - av;
            if (Number.isFinite(av) !== Number.isFinite(bv)) return Number.isFinite(av) ? -1 : 1;
            return a.display.localeCompare(b.display, 'zh-CN');
        });
        return arr;
    }

    function variantTokens(model) {
        const lower = String(model || '').toLowerCase();
        const known = ['flash', 'pro', 'preview', 'thinking', 'lite', 'mini', 'turbo', 'opus', 'sonnet', 'haiku', 'image'];
        return new Set(known.filter(token => lower.includes(token)));
    }

    function chooseBestModel(profile, candidates, group) {
        if (!Array.isArray(candidates) || !candidates.length) return '';
        const current = String(profile?.model || '');
        const currentTokens = variantTokens(current);
        const scored = candidates.map(model => {
            let score = model === current ? 80 : 0;
            const info = classify(profile.id, model);
            if (info.key === group.key) score += 20;
            for (const token of variantTokens(model)) if (currentTokens.has(token)) score += 8;
            if (getOverride(profile.id, model)) score += 60;
            return { model, score };
        });
        scored.sort((a, b) => b.score - a.score || String(a.model).localeCompare(String(b.model)));
        return scored[0].model;
    }

    function selectedGroup(mode = transportMode()) {
        const list = groups(mode);
        const s = settings();
        let group = list.find(g => g.key === s?.selectedModelGroup);
        if (group) return group;
        const current = profileById(currentProfileId());
        if (current?.model) {
            const info = classify(current.id, current.model);
            group = list.find(g => g.key === info.key);
        }
        return group || list[0] || null;
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
        const target = targets.find(p => p.id === current?.id)
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

    async function selectGroup(key, mode = transportMode(), { quiet = false } = {}) {
        if (applying) return { ok: false, reason: '正在切换模型，请稍等' };
        const group = groups(mode).find(g => g.key === key);
        if (!group) return { ok: false, reason: '没有这个“版本 + 流式类型”组合' };

        applying = true;
        try {
            const s = settings();
            const assignments = [];
            const allEligible = [];
            for (const profile of profiles().filter(isUsable)) {
                const candidates = group.matches.get(profile.id) || [];
                const model = chooseBestModel(profile, candidates, group);
                if (!model) continue;
                profile.model = model;
                allEligible.push(profile);
                assignments.push({ profile: profile.name || profile.id, model, transportMode: mode });
            }
            if (!allEligible.length) return { ok: false, reason: '没有任何站提供这一档' };

            const allowedIds = allowedIdsForGroup(group);
            const allowedProfiles = allEligible.filter(p => allowedIds.includes(String(p.id)));
            s.transportMode = mode;
            s.selectedModelGroup = group.key;
            s.profileIds = allowedIds;
            s.lastModelAssignments = assignments.filter(x => allowedProfiles.some(p => (p.name || p.id) === x.profile));
            s.lastModelAssignmentsTransport = mode;
            saveSettings();
            setNativeStreamMode(mode);
            try { window.AnswerMe?.refresh?.(); } catch {}
            await applyCurrentProfile(allowedProfiles.length ? allowedProfiles : allEligible);
            renderRouter();
            if (!quiet) window.toastr?.success?.(`${group.display} · ${mode === 'stream' ? '真流' : '假流'} · ${allowedIds.length} 家上场`, '🍚 Answer Me');
            return { ok: true, group, selected: allowedProfiles, assignments };
        } finally {
            applying = false;
        }
    }

    async function setTransport(mode, { quiet = false } = {}) {
        if (!['stream', 'fake'].includes(mode)) return { ok: false, reason: '未知传输方式' };
        const s = settings();
        const wantedKey = s?.selectedModelGroup || selectedGroup(transportMode())?.key || '';
        s.transportMode = mode;
        saveSettings();
        setNativeStreamMode(mode);
        const same = groups(mode).find(g => g.key === wantedKey);
        if (same) return await selectGroup(same.key, mode, { quiet });
        s.profileIds = [];
        s.lastModelAssignments = [];
        saveSettings();
        try { window.AnswerMe?.refresh?.(); } catch {}
        renderRouter();
        const reason = `当前版本没有${mode === 'stream' ? '真流' : '假流'}模型。`;
        if (!quiet) window.toastr?.warning?.(reason, '💢 Answer Me');
        return { ok: false, reason };
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #answer_me_model_router{display:none!important}
            #${UI_ID}{margin:10px 0 12px;padding:10px;border-radius:11px;background:rgba(127,127,127,.07);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            #${UI_ID} .am17-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}#${UI_ID} .am17-row+.am17-row{margin-top:9px}
            #${UI_ID} .am17-label{font-weight:750;font-size:.9em;min-width:76px}#${UI_ID} .am17-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1}
            #${UI_ID} .am17-chip{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.08);color:inherit;border-radius:999px;padding:5px 10px;cursor:pointer;line-height:1.2}
            #${UI_ID} .am17-chip.is-active{font-weight:800;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}#${UI_ID} .am17-count{opacity:.62;font-size:.85em;margin-left:3px}
            #${UI_ID} .am17-summary{margin-top:8px;font-size:.83em;opacity:.74;line-height:1.45}#${UI_ID} .am17-models{margin-top:4px;font-size:.78em;opacity:.58;word-break:break-word}
            #${UI_ID} .am17-actions{display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap}#${UI_ID} .am17-action{border:0;background:transparent;color:inherit;opacity:.76;cursor:pointer;padding:2px 0;font-size:.83em}
            #${UI_ID} .am17-manual{margin-top:9px;padding-top:9px;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            #${UI_ID} .am17-manual-note{font-size:.78em;opacity:.64;line-height:1.45;margin-bottom:7px}
            #${UI_ID} details.am17-site-editor{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10));border-radius:9px;padding:6px 8px;margin:6px 0;background:rgba(127,127,127,.045)}
            #${UI_ID} details.am17-site-editor>summary{cursor:pointer;font-size:.84em;font-weight:700}
            #${UI_ID} .am17-editor{margin-top:8px;display:grid;gap:7px}#${UI_ID} .am17-editor select,#${UI_ID} .am17-editor input{width:100%;min-width:0}
            #${UI_ID} .am17-auto{font-size:.76em;opacity:.62;word-break:break-word}.am17-field{display:grid;gap:3px}.am17-field>span{font-size:.76em;opacity:.72}
            #${UI_ID} .am17-editor-actions{display:flex;gap:8px;flex-wrap:wrap}.am17-small{font-size:.76em;opacity:.68}
            @media(max-width:700px){#${UI_ID} .am17-label{min-width:100%}#${UI_ID} .am17-chip{padding:6px 11px}}
        `;
        document.head.appendChild(style);
    }

    function scanStats() {
        const s = settings();
        const usable = profiles().filter(isUsable);
        const full = usable.filter(p => s?.modelCatalog?.[p.id] && s.modelCatalog[p.id].fallback === false).length;
        return { full, total: usable.length };
    }

    function overrideCountForProfile(profile) {
        return modelList(profile).filter(model => !!getOverride(profile.id, model)).length;
    }

    function fillSiteEditor(details, profile) {
        if (details.dataset.loaded === '1') return;
        details.dataset.loaded = '1';
        const models = modelList(profile);
        const editor = document.createElement('div');
        editor.className = 'am17-editor';
        const modelField = document.createElement('label');
        modelField.className = 'am17-field';
        modelField.innerHTML = '<span>实际模型 ID</span>';
        const modelSelect = document.createElement('select');
        for (const model of models) {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === profile.model) option.selected = true;
            modelSelect.appendChild(option);
        }
        modelField.appendChild(modelSelect);

        const autoLine = document.createElement('div');
        autoLine.className = 'am17-auto';
        const versionField = document.createElement('label');
        versionField.className = 'am17-field';
        versionField.innerHTML = '<span>手动版本（留空 = 自动）</span>';
        const versionInput = document.createElement('input');
        versionInput.type = 'text';
        versionInput.placeholder = '例如 3.7';
        versionField.appendChild(versionInput);

        const transportField = document.createElement('label');
        transportField.className = 'am17-field';
        transportField.innerHTML = '<span>手动流式分类</span>';
        const transportSelect = document.createElement('select');
        for (const [value, text] of [['auto','自动'],['stream','真流'],['fake','假流'],['ignore','忽略这个模型']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            transportSelect.appendChild(option);
        }
        transportField.appendChild(transportSelect);

        const actions = document.createElement('div');
        actions.className = 'am17-editor-actions';
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'menu_button'; save.textContent = '保存这个修正';
        const reset = document.createElement('button');
        reset.type = 'button'; reset.className = 'menu_button'; reset.textContent = '恢复自动';
        actions.append(save, reset);

        const refreshFields = () => {
            const model = modelSelect.value;
            const auto = autoInfo(model);
            const ov = getOverride(profile.id, model) || {};
            autoLine.textContent = `自动识别：${auto.version || '未识别版本'} · ${autoTransport(model) === 'stream' ? '真流' : '假流'} · ${model}`;
            versionInput.value = ov.version || '';
            transportSelect.value = ov.transport || 'auto';
        };
        modelSelect.addEventListener('change', refreshFields);
        save.addEventListener('click', async () => {
            const model = modelSelect.value;
            const version = versionInput.value.trim();
            const transport = transportSelect.value;
            const key = overrideKey(profile.id, model);
            if (!version && transport === 'auto') delete settings().modelClassifierOverrides[key];
            else settings().modelClassifierOverrides[key] = { version, transport };
            saveSettings();
            await reconcileAfterOverride();
            window.toastr?.success?.(`${profile.name || '这个站'} 的识别修正已保存。`, '✎ Answer Me');
        });
        reset.addEventListener('click', async () => {
            delete settings().modelClassifierOverrides[overrideKey(profile.id, modelSelect.value)];
            saveSettings();
            refreshFields();
            await reconcileAfterOverride();
            window.toastr?.info?.('已恢复自动识别。', '✎ Answer Me');
        });

        editor.append(modelField, autoLine, versionField, transportField, actions);
        details.appendChild(editor);
        refreshFields();
    }

    function buildManualPanel(parent) {
        const s = settings();
        if (!s?.modelClassifierOpen) return;
        const panel = document.createElement('div');
        panel.className = 'am17-manual';
        const note = document.createElement('div');
        note.className = 'am17-manual-note';
        note.textContent = '自动识别错了就只修错的那一条：选站 → 选实际模型 ID → 手动指定版本/真流假流。修正会持久保存，其他模型继续自动识别。';
        panel.appendChild(note);
        for (const profile of profiles().filter(isUsable)) {
            const details = document.createElement('details');
            details.className = 'am17-site-editor';
            const summary = document.createElement('summary');
            const count = overrideCountForProfile(profile);
            summary.textContent = `${profile.name || '未命名站'} · ${modelList(profile).length} 个模型${count ? ` · 已修正 ${count}` : ''}`;
            details.appendChild(summary);
            details.addEventListener('toggle', () => {
                if (details.open) fillSiteEditor(details, profile);
            });
            panel.appendChild(details);
        }
        parent.appendChild(panel);
    }

    function renderRouter() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            const root = document.querySelector('#answer_me_settings');
            if (!root) return;
            installStyle();
            document.querySelector('#answer_me_model_router_v17')?.remove();
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
            const list = groups(mode);
            const active = selectedGroup(mode);
            const stats = scanStats();
            box.replaceChildren();

            const row1 = document.createElement('div'); row1.className = 'am17-row';
            const label1 = document.createElement('div'); label1.className = 'am17-label'; label1.textContent = '今天吃哪个？';
            const chips = document.createElement('div'); chips.className = 'am17-chips'; row1.append(label1, chips);
            for (const group of list) {
                const btn = document.createElement('button'); btn.type = 'button';
                btn.className = `am17-chip ${active?.key === group.key ? 'is-active' : ''}`;
                btn.innerHTML = `${group.display}<span class="am17-count">${group.profileCount}</span>`;
                btn.title = [...group.models].join('\n');
                btn.addEventListener('click', async () => { btn.disabled = true; const r = await selectGroup(group.key, mode); if (!r.ok) window.toastr?.warning?.(r.reason, '🍚 Answer Me'); });
                chips.appendChild(btn);
            }
            if (!list.length) {
                const empty = document.createElement('span'); empty.textContent = `没有${mode === 'stream' ? '真流' : '假流'}模型`; empty.style.opacity = '.65'; chips.appendChild(empty);
            }

            const row2 = document.createElement('div'); row2.className = 'am17-row';
            const label2 = document.createElement('div'); label2.className = 'am17-label'; label2.textContent = '传输方式';
            const modes = document.createElement('div'); modes.className = 'am17-chips';
            for (const [value, text] of [['stream','🟢 真流式'],['fake','📦 假流式']]) {
                const btn = document.createElement('button'); btn.type = 'button';
                btn.className = `am17-chip ${mode === value ? 'is-active' : ''}`; btn.textContent = text;
                btn.addEventListener('click', async () => { if (value === transportMode() || applying) return; btn.disabled = true; await setTransport(value); });
                modes.appendChild(btn);
            }
            row2.append(label2, modes);

            const summary = document.createElement('div'); summary.className = 'am17-summary';
            summary.textContent = active ? `当前：${active.display} · ${active.profileCount}/${stats.total} 家有这一档 · ${mode === 'stream' ? '真流式' : '假流式'}` : `当前：${mode === 'stream' ? '真流式' : '假流式'} · 暂无模型组`;
            const modelsLine = document.createElement('div'); modelsLine.className = 'am17-models';
            const assignments = settings()?.lastModelAssignments || [];
            if (assignments.length) modelsLine.textContent = assignments.map(x => `${x.profile}: ${x.model}`).join(' / ');

            const actions = document.createElement('div'); actions.className = 'am17-actions';
            const scan = document.createElement('button'); scan.type = 'button'; scan.className = 'am17-action'; scan.textContent = '↻ 扫描各站模型';
            scan.addEventListener('click', async () => { scan.disabled = true; try { await baseRouter?.scan?.(true); await reconcileAfterOverride(); window.toastr?.success?.('模型表已重扫。', '🍚 Answer Me'); } finally { renderRouter(); } });
            const manual = document.createElement('button'); manual.type = 'button'; manual.className = 'am17-action';
            const totalOverrides = Object.keys(settings()?.modelClassifierOverrides || {}).length;
            manual.textContent = `${settings()?.modelClassifierOpen ? '▾' : '▸'} 手动校正识别${totalOverrides ? `（${totalOverrides}）` : ''}`;
            manual.addEventListener('click', () => { settings().modelClassifierOpen = !settings().modelClassifierOpen; saveSettings(); renderRouter(); });
            const state = document.createElement('span'); state.className = 'am17-small'; state.textContent = `${stats.full}/${stats.total} 家已读完整模型表`;
            actions.append(scan, manual, state);

            box.append(row1, row2, summary, modelsLine, actions);
            buildManualPanel(box);
        }, 30);
    }

    async function reconcileAfterOverride() {
        const s = settings();
        const mode = transportMode();
        const key = s?.selectedModelGroup;
        const same = groups(mode).find(g => g.key === key);
        if (same) await selectGroup(same.key, mode, { quiet: true });
        else {
            const fallback = selectedGroup(mode);
            if (fallback) await selectGroup(fallback.key, mode, { quiet: true });
            else { s.profileIds = []; saveSettings(); try { window.AnswerMe?.refresh?.(); } catch {} }
        }
        renderRouter();
        try { await window.AnswerMeSiteSelector?.apply?.(); } catch {}
    }

    function installPublicApi() {
        window.AnswerMeModelRouterV13 = baseRouter;
        window.AnswerMeModelRouter = {
            version: VERSION,
            groups: () => groups(transportMode()),
            extractVersion: (...args) => baseRouter?.extractVersion?.(...args),
            classify,
            autoTransport,
            scan: async force => { const result = await baseRouter?.scan?.(force); renderRouter(); return result; },
            get selected() { return selectedGroup(transportMode()); },
            get transportMode() { return transportMode(); },
            select: async key => await selectGroup(key, transportMode()),
            setTransport: async mode => await setTransport(mode),
            setOverride(profileId, model, value = {}) {
                const key = overrideKey(profileId, model);
                const version = String(value.version || '').trim();
                const transport = ['stream','fake','ignore'].includes(value.transport) ? value.transport : 'auto';
                if (!version && transport === 'auto') delete settings().modelClassifierOverrides[key];
                else settings().modelClassifierOverrides[key] = { version, transport };
                saveSettings(); void reconcileAfterOverride(); return true;
            },
            clearOverride(profileId, model) { delete settings().modelClassifierOverrides[overrideKey(profileId, model)]; saveSettings(); void reconcileAfterOverride(); return true; },
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
        if (!baseRouter?.groups) throw new Error('beta13 model router 未就绪');
        installStyle();
        installPublicApi();
        try { await baseRouter.scan?.(false); } catch {}
        await sleep(180);
        await reconcileAfterOverride();
        const timer = setInterval(() => {
            if (document.querySelector('#answer_me_settings') && !document.querySelector(`#${UI_ID}`)) renderRouter();
        }, 800);
        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
        console.log(`[💢 Answer Me] manual router ${VERSION} ready · 自动识别 + 手动覆盖`);
    }

    boot().catch(error => {
        console.error('[💢 Answer Me] manual router v17 startup failed', error);
        window.toastr?.error?.(String(error?.message || error || '手动识别路由启动失败'), '💢 Answer Me');
    });
})();
