(() => {
    'use strict';

    const VERSION = '0.3.2-beta.14';
    const FLAG = '__answerMeTransportCatalogV14';
    const STYLE_ID = 'answer_me_transport_catalog_style_v14';
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
        if (typeof s.modelRouterManualOpen !== 'boolean') s.modelRouterManualOpen = false;
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
        return ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? '';
    }

    function transportMode() {
        return settings()?.transportMode === 'fake' ? 'fake' : 'stream';
    }

    // 站点把“假流”写进模型 ID 时，以模型 ID 为准；没有假流标记的默认归真流。
    function transportOfModel(model) {
        const raw = String(model || '');
        if (/(?:假流式|假流|伪流式|伪流|非流式|整包|fake[\s._-]*stream|non[\s._-]*stream|whole[\s._-]*(?:response|stream))/i.test(raw)) {
            return 'fake';
        }
        return 'stream';
    }

    function rawGroups() {
        try {
            const groups = baseRouter?.groups?.();
            return Array.isArray(groups) ? groups : [];
        } catch {
            return [];
        }
    }

    function filteredGroups(mode = transportMode()) {
        return rawGroups().map(group => {
            const matches = new Map();
            const models = new Set();
            if (group?.matches?.entries) {
                for (const [profileId, candidates] of group.matches.entries()) {
                    const filtered = (Array.isArray(candidates) ? candidates : [])
                        .filter(model => transportOfModel(model) === mode);
                    if (!filtered.length) continue;
                    matches.set(profileId, filtered);
                    filtered.forEach(model => models.add(model));
                }
            }
            return {
                ...group,
                matches,
                models,
                profileCount: matches.size,
                transportMode: mode,
            };
        }).filter(group => group.profileCount > 0);
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
        const currentInfo = baseRouter?.extractVersion?.(current) || {};

        const scored = candidates.map(model => {
            const info = baseRouter?.extractVersion?.(model) || {};
            let score = 0;
            if (info.family && currentInfo.family && info.family === currentInfo.family) score += 50;
            if (info.key === group.key) score += 20;
            for (const token of variantTokens(model)) if (currentTokens.has(token)) score += 8;
            // 同模式下尽量延续 flash/pro/image 等口味；不拿“假流式”文字本身做偏好。
            return { model, score };
        });
        scored.sort((a, b) => b.score - a.score || String(a.model).localeCompare(String(b.model)));
        return scored[0].model;
    }

    function siteKey(name) {
        return String(name || '').split(/[·|｜—–]/)[0].replace(/\s+/g, '').toLowerCase();
    }

    async function waitProfileApply(timeout = 6000) {
        const spinner = document.querySelector('#connection_profile_spinner');
        if (!spinner) {
            await sleep(450);
            return;
        }
        const started = Date.now();
        let sawBusy = !spinner.classList.contains('hidden');
        while (Date.now() - started < timeout) {
            if (!spinner.classList.contains('hidden')) sawBusy = true;
            if (sawBusy && spinner.classList.contains('hidden')) return;
            await sleep(80);
        }
        await sleep(180);
    }

    async function applyCurrentProfile(targets) {
        if (!targets?.length) return null;
        const all = profiles();
        const current = all.find(p => p.id === currentProfileId());
        const currentSite = siteKey(current?.name);
        const target = (current && targets.find(p => p.id === current.id))
            || (currentSite && targets.find(p => siteKey(p.name) === currentSite))
            || targets[0];
        if (!target) return null;

        const select = document.querySelector('#connection_profiles');
        if (!select) {
            ctx().extensionSettings.connectionManager.selectedProfile = target.id;
            saveSettings();
            return target;
        }

        select.value = target.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await waitProfileApply();
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

    function selectedGroup(mode = transportMode()) {
        const groups = filteredGroups(mode);
        const s = settings();
        let group = groups.find(g => g.key === s?.selectedModelGroup);
        if (group) return group;

        const current = profiles().find(p => p.id === currentProfileId());
        const key = current ? baseRouter?.extractVersion?.(current.model)?.key : '';
        group = groups.find(g => g.key === key);
        return group || groups[0] || null;
    }

    async function selectGroup(key, mode = transportMode(), { quiet = false } = {}) {
        if (applying) return { ok: false, reason: '正在切换模型，请稍等' };
        const group = filteredGroups(mode).find(g => g.key === key);
        if (!group) return { ok: false, reason: mode === 'fake' ? '这个版本没有假流模型' : '这个版本没有真流模型' };

        applying = true;
        try {
            const s = settings();
            const usable = profiles().filter(isUsable);
            const selected = [];
            const missing = [];
            const assignments = [];

            for (const profile of usable) {
                const candidates = group.matches.get(profile.id) || [];
                const model = chooseBestModel(profile, candidates, group);
                if (!model) {
                    missing.push(profile.name || profile.id);
                    continue;
                }
                profile.model = model;
                selected.push(profile);
                assignments.push({ profile: profile.name || profile.id, model, transportMode: mode });
            }

            if (!selected.length) return { ok: false, reason: '没有任何站提供这个“版本 + 流式类型”组合' };

            s.transportMode = mode;
            s.profileIds = selected.map(p => p.id);
            s.selectedModelGroup = group.key;
            s.lastModelAssignments = assignments;
            s.lastModelAssignmentsTransport = mode;
            saveSettings();
            try { window.AnswerMe?.refresh?.(); } catch {}

            setNativeStreamMode(mode);
            await applyCurrentProfile(selected);
            renderRouter();

            if (!quiet) {
                const suffix = missing.length ? `；${missing.length} 家没有这一档，已跳过` : '';
                window.toastr?.success?.(`${group.display} · ${mode === 'stream' ? '真流' : '假流'}队集合 · ${selected.length} 家${suffix}`, '🍚 Answer Me');
            }
            return { ok: true, group, selected, missing, assignments };
        } finally {
            applying = false;
        }
    }

    async function setTransport(mode, { quiet = false } = {}) {
        if (!['stream', 'fake'].includes(mode)) return { ok: false, reason: '未知传输方式' };
        const s = settings();
        if (!s) return { ok: false, reason: '设置尚未就绪' };
        const wantedKey = s.selectedModelGroup || selectedGroup(transportMode())?.key || '';
        s.transportMode = mode;
        saveSettings();
        setNativeStreamMode(mode);

        const sameVersion = filteredGroups(mode).find(g => g.key === wantedKey);
        if (sameVersion) return await selectGroup(sameVersion.key, mode, { quiet });

        // 没有同版本对应流式时绝不偷偷拿另一种流式模型继续跑。
        s.profileIds = [];
        s.lastModelAssignments = [];
        s.lastModelAssignmentsTransport = mode;
        saveSettings();
        try { window.AnswerMe?.refresh?.(); } catch {}
        renderRouter();
        const reason = `当前版本没有${mode === 'stream' ? '真流' : '假流'}模型，已清空参赛站，避免混流。`;
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
            #${UI_ID} .am14-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}#${UI_ID} .am14-row+.am14-row{margin-top:9px}
            #${UI_ID} .am14-label{font-weight:750;font-size:.9em;min-width:76px}#${UI_ID} .am14-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1}
            #${UI_ID} .am14-chip{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.08);color:inherit;border-radius:999px;padding:5px 10px;cursor:pointer;line-height:1.2}
            #${UI_ID} .am14-chip:hover{background:rgba(127,127,127,.15)}#${UI_ID} .am14-chip.is-active{font-weight:800;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
            #${UI_ID} .am14-chip:disabled{opacity:.48;cursor:wait}#${UI_ID} .am14-count{opacity:.62;font-size:.85em;margin-left:3px}
            #${UI_ID} .am14-summary{margin-top:8px;font-size:.83em;opacity:.74;line-height:1.45}#${UI_ID} .am14-models{margin-top:4px;font-size:.78em;opacity:.58;word-break:break-word}
            #${UI_ID} .am14-actions{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}#${UI_ID} .am14-action{border:0;background:transparent;color:inherit;opacity:.75;cursor:pointer;padding:2px 0;font-size:.83em}
            #${UI_ID} .am14-warn{font-size:.78em;opacity:.62}
            @media(max-width:700px){#${UI_ID} .am14-label{min-width:100%}#${UI_ID} .am14-chip{padding:6px 11px}#${UI_ID} .am14-row{align-items:flex-start}}
        `;
        document.head.appendChild(style);
    }

    function scanStats() {
        const s = settings();
        const usable = profiles().filter(isUsable);
        const full = usable.filter(p => s?.modelCatalog?.[p.id] && s.modelCatalog[p.id].fallback === false).length;
        return { full, total: usable.length };
    }

    function syncManualVisibility(root) {
        const s = settings();
        if (!root || !s) return;
        root.classList.toggle('am-router-manual-closed', !s.modelRouterManualOpen);
        const btn = root.querySelector('#answer_me_manual_toggle_v14');
        if (btn) btn.textContent = s.modelRouterManualOpen ? '▾ 收起手动点名' : '▸ 手动点名（备用）';
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
                else {
                    const note = root.querySelector('.answer-me-note');
                    if (note?.nextSibling) note.parentNode.insertBefore(box, note.nextSibling);
                    else root.prepend(box);
                }
            }

            const mode = transportMode();
            const groups = filteredGroups(mode);
            const active = selectedGroup(mode);
            const usableCount = profiles().filter(isUsable).length;
            const stats = scanStats();

            box.innerHTML = '';

            const row1 = document.createElement('div');
            row1.className = 'am14-row';
            const label1 = document.createElement('div');
            label1.className = 'am14-label';
            label1.textContent = '今天吃哪个？';
            const chips = document.createElement('div');
            chips.className = 'am14-chips';
            row1.append(label1, chips);

            for (const group of groups) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am14-chip ${active?.key === group.key ? 'is-active' : ''}`;
                btn.innerHTML = `${group.display}<span class="am14-count">${group.profileCount}</span>`;
                btn.title = [...group.models].join('\n');
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const result = await selectGroup(group.key, mode);
                    if (!result.ok) window.toastr?.warning?.(result.reason, '🍚 Answer Me');
                });
                chips.appendChild(btn);
            }
            if (!groups.length) {
                const empty = document.createElement('span');
                empty.textContent = `没有读到${mode === 'stream' ? '真流' : '假流'}模型`;
                empty.style.opacity = '.65';
                chips.appendChild(empty);
            }

            const row2 = document.createElement('div');
            row2.className = 'am14-row';
            const label2 = document.createElement('div');
            label2.className = 'am14-label';
            label2.textContent = '传输方式';
            const modes = document.createElement('div');
            modes.className = 'am14-chips';
            for (const [value, text] of [['stream', '🟢 真流式'], ['fake', '📦 假流式']]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am14-chip ${mode === value ? 'is-active' : ''}`;
                btn.textContent = text;
                btn.addEventListener('click', async () => {
                    if (value === transportMode() || applying) return;
                    btn.disabled = true;
                    await setTransport(value);
                });
                modes.appendChild(btn);
            }
            row2.append(label2, modes);

            const summary = document.createElement('div');
            summary.className = 'am14-summary';
            summary.textContent = active
                ? `当前：${active.display} · ${active.profileCount}/${usableCount} 家有这个版本的${mode === 'stream' ? '真流' : '假流'} · ${mode === 'stream' ? '真流式' : '假流式'}`
                : `当前：${mode === 'stream' ? '真流式' : '假流式'} · 暂无可用模型组`;

            const modelsLine = document.createElement('div');
            modelsLine.className = 'am14-models';
            const assignments = settings()?.lastModelAssignments;
            const assignmentMode = settings()?.lastModelAssignmentsTransport;
            if (Array.isArray(assignments) && assignments.length && assignmentMode === mode && active?.key === settings()?.selectedModelGroup) {
                modelsLine.textContent = assignments.map(x => `${x.profile}: ${x.model}`).join(' / ');
            } else if (active) {
                modelsLine.textContent = `本档实际模型名：${[...active.models].slice(0, 8).join(' / ')}${active.models.size > 8 ? ' …' : ''}`;
            }

            const actions = document.createElement('div');
            actions.className = 'am14-actions';
            const scan = document.createElement('button');
            scan.type = 'button';
            scan.className = 'am14-action';
            scan.textContent = '↻ 扫描各站模型';
            scan.addEventListener('click', async () => {
                scan.disabled = true;
                try {
                    await baseRouter?.scan?.(true);
                    const selected = selectedGroup(transportMode());
                    if (selected) await selectGroup(selected.key, transportMode(), { quiet: true });
                    window.toastr?.success?.('模型表已重扫，并按真流/假流重新分档。', '🍚 Answer Me');
                } finally {
                    renderRouter();
                }
            });

            const state = document.createElement('span');
            state.className = 'am14-warn';
            state.textContent = `${stats.full}/${stats.total} 家已读完整模型表 · 当前只统计${mode === 'stream' ? '真流' : '假流'}模型`;

            const manual = document.createElement('button');
            manual.type = 'button';
            manual.id = 'answer_me_manual_toggle_v14';
            manual.className = 'am14-action';
            manual.addEventListener('click', () => {
                const s = settings();
                s.modelRouterManualOpen = !s.modelRouterManualOpen;
                saveSettings();
                syncManualVisibility(root);
            });
            actions.append(scan, state, manual);

            box.append(row1, row2, summary, modelsLine, actions);
            syncManualVisibility(root);
        }, 35);
    }

    function installPublicApi() {
        window.AnswerMeModelRouterV13 = baseRouter;
        window.AnswerMeModelRouter = {
            version: VERSION,
            groups: () => filteredGroups(transportMode()),
            extractVersion: (...args) => baseRouter?.extractVersion?.(...args),
            transportOfModel,
            scan: async force => {
                const result = await baseRouter?.scan?.(force);
                renderRouter();
                return result;
            },
            get selected() { return selectedGroup(transportMode()); },
            get transportMode() { return transportMode(); },
            select: async key => await selectGroup(key, transportMode()),
            setTransport: async mode => await setTransport(mode),
        };
    }

    async function initialReconcile() {
        try { await baseRouter?.scan?.(false); } catch {}
        await sleep(250);
        const s = settings();
        const mode = transportMode();
        const key = s?.selectedModelGroup || selectedGroup(mode)?.key;
        if (key && filteredGroups(mode).some(g => g.key === key)) {
            await selectGroup(key, mode, { quiet: true });
        } else {
            renderRouter();
        }
    }

    async function boot() {
        if (window[FLAG]) return;
        window[FLAG] = true;

        for (let i = 0; i < 100; i++) {
            if (ctx() && window.AnswerMeModelRouter?.groups) break;
            await sleep(100);
        }
        baseRouter = window.AnswerMeModelRouter;
        if (!baseRouter?.groups) throw new Error('beta13 model router 未就绪');

        installStyle();
        installPublicApi();

        const timer = setInterval(() => {
            try { renderRouter(); } catch (error) { console.warn('[💢 Answer Me] v14 render failed', error); }
        }, 450);
        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });

        void initialReconcile();
        console.log(`[💢 Answer Me] ${VERSION} ready · 真流/假流按模型 ID 分档，不再混跑`);
    }

    boot().catch(error => {
        console.error('[💢 Answer Me] transport catalog v14 startup failed', error);
        window.toastr?.error?.(String(error?.message || error || '真流/假流分档启动失败'), '💢 Answer Me');
    });
})();