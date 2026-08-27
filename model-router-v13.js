(() => {
    'use strict';

    const VERSION = '0.3.1-beta.13';
    const ROUTER_FLAG = '__answerMeModelRouterV13';
    const SERVICE_FLAG = '__answerMeTransportWrappedV13';
    const STYLE_ID = 'answer_me_model_router_style_v13';
    const CATALOG_TTL = 6 * 60 * 60 * 1000;
    const SCAN_CONCURRENCY = 3;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    let scanPromise = null;
    let renderTimer = null;

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
        if (!s.modelCatalog || typeof s.modelCatalog !== 'object' || Array.isArray(s.modelCatalog)) s.modelCatalog = {};
        return s;
    }

    function saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch {}
    }

    function profiles() {
        const list = ctx()?.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(list) ? list : [];
    }

    function currentProfileId() {
        return ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? '';
    }

    function isUsable(profile) {
        const service = ctx()?.ConnectionManagerRequestService;
        if (!profile?.id || !service) return false;
        try {
            return typeof service.isProfileSupported === 'function'
                ? service.isProfileSupported(profile)
                : true;
        } catch {
            return false;
        }
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

    function extractVersion(model) {
        const raw = String(model || '').trim();
        const lower = raw.toLowerCase();
        if (!raw) return { key: 'unknown:', label: '未标模型', version: '', family: '', raw };

        const family = familyOf(raw);
        const familyNeedle = family ? family.toLowerCase() : '';
        const start = familyNeedle ? Math.max(0, lower.indexOf(familyNeedle)) : 0;
        const windowText = lower.slice(start, start + 64);

        let m = windowText.match(/(?:^|[^0-9])(\d{1,2})\.(\d{1,2})(?=[^0-9]|$)/);
        if (!m) m = windowText.match(/(?:^|[^0-9])(\d{1,2})[-_](\d{1,2})(?=[^0-9]|$)/);
        if (!m) {
            const all = [...lower.matchAll(/(?:^|[^0-9])(\d{1,2})[._-](\d{1,2})(?=[^0-9]|$)/g)]
                .map(x => [Number(x[1]), Number(x[2])])
                .filter(([major, minor]) => major >= 1 && major <= 9 && minor >= 0 && minor <= 9);
            if (all.length) m = [null, String(all[0][0]), String(all[0][1])];
        }

        if (m) {
            const version = `${Number(m[1])}.${Number(m[2])}`;
            return { key: `${family || 'Model'}:${version}`, label: version, version, family, raw };
        }

        const single = windowText.match(/(?:^|[^0-9])(\d)(?=[^0-9]|$)/);
        if (single && family) {
            const version = String(Number(single[1]));
            return { key: `${family}:${version}`, label: version, version, family, raw };
        }

        return { key: `raw:${lower}`, label: raw, version: '', family, raw };
    }

    function normalizeModelList(json, fallback = '') {
        let list = [];
        if (Array.isArray(json)) list = json;
        else if (Array.isArray(json?.data)) list = json.data;
        else if (Array.isArray(json?.models)) list = json.models;
        else if (Array.isArray(json?.data?.data)) list = json.data.data;

        const ids = list.map(item => {
            if (typeof item === 'string') return item;
            return item?.id ?? item?.name ?? item?.model ?? '';
        }).map(x => String(x || '').trim()).filter(Boolean);

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
        if (!apiMap || apiMap.selected !== 'openai' || !apiMap.source) {
            return fallbackCatalog(profile, '此连接类型暂不支持自动扫模型');
        }

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
                method: 'POST',
                headers: c.getRequestHeaders(),
                cache: 'no-cache',
                body: JSON.stringify(body),
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || json?.error === true) {
                return fallbackCatalog(profile, `模型列表请求失败 ${response.status || ''}`.trim());
            }
            const models = normalizeModelList(json, profile.model);
            if (!models.length) return fallbackCatalog(profile, '站点没有返回模型列表');
            return { models, scannedAt: Date.now(), fallback: false, error: '' };
        } catch (error) {
            return fallbackCatalog(profile, error?.message || error || '扫描失败');
        }
    }

    function catalogEntry(profile) {
        const s = settings();
        const cached = s?.modelCatalog?.[profile.id];
        if (cached && Array.isArray(cached.models)) {
            const models = [...new Set([...cached.models, profile.model].filter(Boolean).map(String))];
            return { ...cached, models };
        }
        return fallbackCatalog(profile, '尚未扫描');
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
            const list = profiles().filter(isUsable);
            const targets = list.filter(p => force || !cacheFresh(p));
            if (!targets.length) return list;

            renderRouter({ scanning: true });
            const scanned = await mapLimited(targets, SCAN_CONCURRENCY, fetchModelsForProfile);
            scanned.forEach((entry, index) => {
                const profile = targets[index];
                s.modelCatalog[profile.id] = entry;
            });
            saveSettings();
            return list;
        })().finally(() => {
            scanPromise = null;
            renderRouter();
        });
        return scanPromise;
    }

    function catalogGroups() {
        const usable = profiles().filter(isUsable);
        const map = new Map();

        for (const profile of usable) {
            const entry = catalogEntry(profile);
            for (const model of entry.models) {
                const info = extractVersion(model);
                if (!info.version) continue;
                if (!map.has(info.key)) {
                    map.set(info.key, {
                        ...info,
                        matches: new Map(),
                        models: new Set(),
                        profileCount: 0,
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
            group.display = collisions.get(group.label) > 1 && group.family
                ? `${group.family} ${group.label}`
                : group.label;
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
        const known = ['flash', 'pro', 'preview', 'thinking', 'lite', 'mini', 'turbo', 'opus', 'sonnet', 'haiku'];
        return new Set(known.filter(token => lower.includes(token)));
    }

    function chooseBestModel(profile, candidates, group) {
        if (!Array.isArray(candidates) || !candidates.length) return '';
        const current = String(profile?.model || '');
        const currentFamily = familyOf(current);
        const currentTokens = variantTokens(current);

        const scored = candidates.map(model => {
            const info = extractVersion(model);
            let score = 0;
            if (info.family && currentFamily && info.family === currentFamily) score += 50;
            for (const token of variantTokens(model)) if (currentTokens.has(token)) score += 8;
            if (String(model).toLowerCase().includes('flash')) score += 1;
            if (info.key === group.key) score += 10;
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

    function transportMode() {
        return settings()?.transportMode === 'fake' ? 'fake' : 'stream';
    }

    function validateFakeText(text) {
        const quality = window.AnswerMeQuality;
        if (quality?.isValidReply && !quality.isValidReply(text)) {
            throw new Error(quality.reason?.(text) || '空回');
        }
        if (!String(text || '').trim()) throw new Error('空回');
    }

    function wrapTransportService() {
        const service = ctx()?.ConnectionManagerRequestService;
        if (!service?.sendRequest || service[SERVICE_FLAG]) return !!service?.[SERVICE_FLAG];

        const original = service.sendRequest.bind(service);
        service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
            if (transportMode() !== 'fake' || !custom?.stream) {
                return await original(profileId, prompt, maxTokens, custom, overridePayload);
            }

            const result = await original(profileId, prompt, maxTokens, { ...custom, stream: false }, overridePayload);
            const text = String(result?.content ?? result?.text ?? '');
            const reasoning = String(result?.reasoning ?? '');
            validateFakeText(text);

            return function fakeStreamFactory() {
                return (async function*() {
                    yield { text, swipes: [], state: { reasoning, answer_me_fake_stream: true } };
                })();
            };
        };

        service[SERVICE_FLAG] = true;
        console.log(`[💢 Answer Me] model router ${VERSION}: fake-stream transport wrapped`);
        return true;
    }

    async function selectGroup(key) {
        const group = catalogGroups().find(g => g.key === key);
        if (!group) return { ok: false, reason: '没有这个模型组' };

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
            assignments.push({ profile: profile.name || profile.id, model });
        }

        if (!selected.length) return { ok: false, reason: '没有任何站提供这个模型' };

        s.profileIds = selected.map(p => p.id);
        s.selectedModelGroup = group.key;
        s.lastModelAssignments = assignments;
        saveSettings();
        try { window.AnswerMe?.refresh?.(); } catch {}

        await applyCurrentProfile(selected);
        setNativeStreamMode(transportMode());
        renderRouter();
        return { ok: true, group, selected, missing, assignments };
    }

    function selectedGroup() {
        const gs = catalogGroups();
        const s = settings();
        let group = gs.find(g => g.key === s?.selectedModelGroup);
        if (group) return group;

        const current = profiles().find(p => p.id === currentProfileId());
        if (current) {
            const key = extractVersion(current.model).key;
            group = gs.find(g => g.key === key);
        }
        return group || gs[0] || null;
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #answer_me_model_router{margin:10px 0 12px;padding:10px;border-radius:11px;background:rgba(127,127,127,.07);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            .am-router-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.am-router-row+.am-router-row{margin-top:9px}
            .am-router-label{font-weight:750;font-size:.9em;min-width:76px}.am-router-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1}
            .am-router-chip{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.08);color:inherit;border-radius:999px;padding:5px 10px;cursor:pointer;line-height:1.2}
            .am-router-chip:hover{background:rgba(127,127,127,.15)}.am-router-chip.is-active{font-weight:800;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
            .am-router-summary{margin-top:8px;font-size:.83em;opacity:.74;line-height:1.45}.am-router-models{margin-top:4px;font-size:.78em;opacity:.58;word-break:break-word}
            .am-router-actions{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.am-router-scan,.am-router-manual{border:0;background:transparent;color:inherit;opacity:.75;cursor:pointer;padding:2px 0;font-size:.83em}
            .am-router-scan:disabled{opacity:.38;cursor:wait}.am-router-warn{font-size:.78em;opacity:.62}.am-router-count{opacity:.62;font-size:.85em;margin-left:3px}
            #answer_me_settings.am-router-manual-closed .answer-me-toolbar,#answer_me_settings.am-router-manual-closed .answer-me-profile-title,#answer_me_settings.am-router-manual-closed #answer_me_profiles{display:none!important}
            @media(max-width:700px){.am-router-label{min-width:100%}.am-router-chip{padding:6px 11px}.am-router-row{align-items:flex-start}}
        `;
        document.head.appendChild(style);
    }

    function syncManualVisibility(root) {
        const s = settings();
        if (!root || !s) return;
        root.classList.toggle('am-router-manual-closed', !s.modelRouterManualOpen);
        const btn = root.querySelector('#answer_me_manual_toggle');
        if (btn) btn.textContent = s.modelRouterManualOpen ? '▾ 收起手动点名' : '▸ 手动点名（备用）';
    }

    function renderRouter({ scanning = false } = {}) {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            const root = document.querySelector('#answer_me_settings');
            if (!root) return;
            installStyle();

            let box = root.querySelector('#answer_me_model_router');
            if (!box) {
                box = document.createElement('div');
                box.id = 'answer_me_model_router';
                const note = root.querySelector('.answer-me-note');
                if (note?.nextSibling) note.parentNode.insertBefore(box, note.nextSibling);
                else root.prepend(box);
            }

            const gs = catalogGroups();
            const active = selectedGroup();
            const mode = transportMode();
            const usableCount = profiles().filter(isUsable).length;
            const scannedCount = profiles().filter(isUsable).filter(p => !catalogEntry(p).fallback).length;

            box.innerHTML = '';
            const row1 = document.createElement('div');
            row1.className = 'am-router-row';
            const label1 = document.createElement('div');
            label1.className = 'am-router-label';
            label1.textContent = '今天吃哪个？';
            const chips = document.createElement('div');
            chips.className = 'am-router-chips';
            row1.append(label1, chips);

            for (const g of gs) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am-router-chip ${active?.key === g.key ? 'is-active' : ''}`;
                btn.innerHTML = `${g.display}<span class="am-router-count">${g.profileCount}</span>`;
                btn.title = [...g.models].join('\n');
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    const result = await selectGroup(g.key);
                    if (!result.ok) {
                        window.toastr?.warning?.(result.reason, '🍚 Answer Me');
                        return;
                    }
                    const suffix = result.missing.length ? `；${result.missing.length} 家没有这个版本，已跳过` : '';
                    window.toastr?.success?.(`${g.display} 队已集合 · ${result.selected.length} 家${suffix}`, '🍚 Answer Me');
                });
                chips.appendChild(btn);
            }

            if (!gs.length) {
                const empty = document.createElement('span');
                empty.textContent = scanning || scanPromise ? '正在读取各站模型…' : '暂时没读到可分类模型';
                empty.style.opacity = '.65';
                chips.appendChild(empty);
            }

            const row2 = document.createElement('div');
            row2.className = 'am-router-row';
            const label2 = document.createElement('div');
            label2.className = 'am-router-label';
            label2.textContent = '传输方式';
            const modes = document.createElement('div');
            modes.className = 'am-router-chips';
            for (const [value, text] of [['stream', '🟢 真流式'], ['fake', '📦 假流式']]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am-router-chip ${mode === value ? 'is-active' : ''}`;
                btn.textContent = text;
                btn.addEventListener('click', () => {
                    const s = settings();
                    s.transportMode = value;
                    saveSettings();
                    setNativeStreamMode(value);
                    renderRouter();
                    window.toastr?.info?.(value === 'stream' ? '全队改走真流式。' : '全队改走假流式/整包请求。', '💢 Answer Me');
                });
                modes.appendChild(btn);
            }
            row2.append(label2, modes);

            const summary = document.createElement('div');
            summary.className = 'am-router-summary';
            summary.textContent = active
                ? `当前：${active.display} · ${active.profileCount}/${usableCount} 家有这个版本 · ${mode === 'stream' ? '真流式' : '假流式'}`
                : `当前：尚未选模型 · ${usableCount} 家连接`;

            const assignments = settings()?.lastModelAssignments;
            const modelsLine = document.createElement('div');
            modelsLine.className = 'am-router-models';
            if (Array.isArray(assignments) && assignments.length && active?.key === settings()?.selectedModelGroup) {
                modelsLine.textContent = assignments.map(x => `${x.profile}: ${x.model}`).join(' / ');
            } else if (active) {
                modelsLine.textContent = `候选实际模型名：${[...active.models].slice(0, 8).join(' / ')}${active.models.size > 8 ? ' …' : ''}`;
            }

            const actions = document.createElement('div');
            actions.className = 'am-router-actions';
            const scan = document.createElement('button');
            scan.type = 'button';
            scan.className = 'am-router-scan';
            scan.textContent = scanPromise ? '↻ 正在扫描…' : '↻ 扫描各站模型';
            scan.disabled = !!scanPromise;
            scan.addEventListener('click', async () => {
                await scanAll(true);
                window.toastr?.success?.('各站模型列表已重新读取。', '🍚 Answer Me');
            });
            const scanState = document.createElement('span');
            scanState.className = 'am-router-warn';
            scanState.textContent = `${scannedCount}/${usableCount} 家已读完整模型表`;

            const manual = document.createElement('button');
            manual.type = 'button';
            manual.id = 'answer_me_manual_toggle';
            manual.className = 'am-router-manual';
            manual.addEventListener('click', () => {
                const s = settings();
                s.modelRouterManualOpen = !s.modelRouterManualOpen;
                saveSettings();
                syncManualVisibility(root);
            });
            actions.append(scan, scanState, manual);

            box.append(row1, row2, summary, modelsLine, actions);
            syncManualVisibility(root);
        }, 30);
        return true;
    }

    function bindNativeStreamMirror() {
        const input = document.querySelector('#stream_toggle');
        if (!input || input.dataset.answerMeRouterBoundV13 === '1') return;
        input.dataset.answerMeRouterBoundV13 = '1';
        input.addEventListener('change', () => {
            const s = settings();
            if (!s) return;
            s.transportMode = input.checked ? 'stream' : 'fake';
            saveSettings();
            renderRouter();
        });
    }

    async function initialApply() {
        setNativeStreamMode(transportMode());
        await scanAll(false);
        const active = selectedGroup();
        if (!active) return;
        if (!settings().selectedModelGroup) await selectGroup(active.key);
        else renderRouter();
    }

    window.AnswerMeModelRouter = {
        version: VERSION,
        groups: catalogGroups,
        extractVersion,
        scan: scanAll,
        get selected() { return selectedGroup(); },
        get transportMode() { return transportMode(); },
        select: async key => await selectGroup(key),
        setTransport: mode => {
            if (!['stream', 'fake'].includes(mode)) return false;
            settings().transportMode = mode;
            saveSettings();
            setNativeStreamMode(mode);
            renderRouter();
            return true;
        },
    };

    async function boot() {
        if (window[ROUTER_FLAG]) return;
        window[ROUTER_FLAG] = true;
        for (let i = 0; i < 100 && !ctx(); i++) await sleep(100);
        wrapTransportService();

        let initialized = false;
        const timer = setInterval(() => {
            try {
                wrapTransportService();
                bindNativeStreamMirror();
                if (document.querySelector('#answer_me_settings')) {
                    renderRouter();
                    if (!initialized) {
                        initialized = true;
                        void initialApply();
                    }
                }
            } catch (error) {
                console.warn('[💢 Answer Me] model router sweep failed', error);
            }
        }, 400);

        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
        console.log(`[💢 Answer Me] model router ${VERSION} ready · per-site model catalog + global stream mode`);
    }

    boot().catch(error => console.error('[💢 Answer Me] model router startup failed', error));
})();
