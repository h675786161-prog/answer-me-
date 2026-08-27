(() => {
    'use strict';

    const VERSION = '0.3.0-beta.12';
    const ROUTER_FLAG = '__answerMeModelRouterV12';
    const SERVICE_FLAG = '__answerMeTransportWrappedV12';
    const STYLE_ID = 'answer_me_model_router_style';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
            ['mistral', 'Mistral'], ['llama', 'Llama'],
        ];
        return families.find(([needle]) => s.includes(needle))?.[1] || '';
    }

    function extractVersion(model) {
        const raw = String(model || '').trim();
        const lower = raw.toLowerCase();
        if (!raw) return { key: 'unknown:', label: '未标模型', version: '', family: '' };

        const family = familyOf(raw);
        const familyNeedle = family ? family.toLowerCase() : '';
        const start = familyNeedle ? Math.max(0, lower.indexOf(familyNeedle)) : 0;
        const windowText = lower.slice(start, start + 48);

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
            const key = `${family || 'Model'}:${version}`;
            return { key, label: version, version, family, raw };
        }

        const single = windowText.match(/(?:^|[^0-9])(\d)(?=[^0-9]|$)/);
        if (single && family) {
            const version = String(Number(single[1]));
            return { key: `${family}:${version}`, label: version, version, family, raw };
        }

        return { key: `raw:${lower}`, label: raw, version: '', family, raw };
    }

    function groups() {
        const map = new Map();
        for (const p of profiles().filter(isUsable)) {
            const info = extractVersion(p.model);
            if (!map.has(info.key)) {
                map.set(info.key, { ...info, profiles: [], models: new Set() });
            }
            const g = map.get(info.key);
            g.profiles.push(p);
            if (p.model) g.models.add(String(p.model));
        }

        const arr = [...map.values()];
        const labelCollisions = new Map();
        for (const g of arr) labelCollisions.set(g.label, (labelCollisions.get(g.label) || 0) + 1);
        for (const g of arr) {
            g.display = labelCollisions.get(g.label) > 1 && g.family ? `${g.family} ${g.label}` : g.label;
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

    function siteKey(name) {
        return String(name || '')
            .split(/[·|｜—–]/)[0]
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    async function waitProfileApply(timeout = 5000) {
        const spinner = document.querySelector('#connection_profile_spinner');
        if (!spinner) {
            await sleep(400);
            return;
        }
        const started = Date.now();
        let sawBusy = !spinner.classList.contains('hidden');
        while (Date.now() - started < timeout) {
            if (!spinner.classList.contains('hidden')) sawBusy = true;
            if (sawBusy && spinner.classList.contains('hidden')) return;
            await sleep(80);
        }
        await sleep(150);
    }

    async function switchCurrentProfile(targets) {
        if (!targets?.length) return null;
        const currentId = currentProfileId();
        if (targets.some(p => p.id === currentId)) return targets.find(p => p.id === currentId);

        const all = profiles();
        const current = all.find(p => p.id === currentId);
        const currentSite = siteKey(current?.name);
        const target = (currentSite && targets.find(p => siteKey(p.name) === currentSite)) || targets[0];
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

    function applySelectedProfiles(group) {
        const s = settings();
        if (!s || !group) return;
        s.profileIds = group.profiles.map(p => p.id);
        s.selectedModelGroup = group.key;
        saveSettings();
        try { window.AnswerMe?.refresh?.(); } catch {}
    }

    function setNativeStreamMode(mode) {
        const wantStream = mode === 'stream';
        const selectors = ['#stream_toggle', '#streaming'];
        for (const selector of selectors) {
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

    function wrapTransportService() {
        const service = ctx()?.ConnectionManagerRequestService;
        if (!service?.sendRequest || service[SERVICE_FLAG]) return !!service?.[SERVICE_FLAG];

        const original = service.sendRequest.bind(service);
        service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
            if (transportMode() !== 'fake' || !custom?.stream) {
                return await original(profileId, prompt, maxTokens, custom, overridePayload);
            }

            const result = await original(
                profileId,
                prompt,
                maxTokens,
                { ...custom, stream: false },
                overridePayload,
            );

            const text = String(result?.content ?? result?.text ?? '');
            const reasoning = String(result?.reasoning ?? '');
            return function fakeStreamFactory() {
                return (async function*() {
                    yield {
                        text,
                        swipes: [],
                        state: { reasoning, answer_me_fake_stream: true },
                    };
                })();
            };
        };

        service[SERVICE_FLAG] = true;
        console.log(`[💢 Answer Me] model router ${VERSION}: transport wrapper ready`);
        return true;
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #answer_me_model_router{margin:10px 0 12px;padding:10px;border-radius:11px;background:rgba(127,127,127,.07);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            .am-router-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
            .am-router-row+.am-router-row{margin-top:9px}
            .am-router-label{font-weight:750;font-size:.9em;min-width:76px}
            .am-router-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1}
            .am-router-chip{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.08);color:inherit;border-radius:999px;padding:5px 10px;cursor:pointer;line-height:1.2}
            .am-router-chip:hover{background:rgba(127,127,127,.15)}
            .am-router-chip.is-active{font-weight:800;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
            .am-router-summary{margin-top:8px;font-size:.83em;opacity:.72;line-height:1.45}
            .am-router-models{margin-top:4px;font-size:.78em;opacity:.57;word-break:break-word}
            .am-router-manual{margin-top:8px;border:0;background:transparent;color:inherit;opacity:.72;cursor:pointer;padding:2px 0;font-size:.83em}
            #answer_me_settings.am-router-manual-closed .answer-me-toolbar,
            #answer_me_settings.am-router-manual-closed .answer-me-profile-title,
            #answer_me_settings.am-router-manual-closed #answer_me_profiles{display:none!important}
            @media(max-width:700px){.am-router-label{min-width:100%;}.am-router-chip{padding:6px 11px}.am-router-row{align-items:flex-start}}
        `;
        document.head.appendChild(style);
    }

    function selectedGroup() {
        const gs = groups();
        const s = settings();
        let g = gs.find(x => x.key === s?.selectedModelGroup);
        if (g) return g;
        const current = profiles().find(p => p.id === currentProfileId());
        if (current) {
            const key = extractVersion(current.model).key;
            g = gs.find(x => x.key === key);
        }
        return g || gs[0] || null;
    }

    function syncManualVisibility(root) {
        const s = settings();
        if (!root || !s) return;
        root.classList.toggle('am-router-manual-closed', !s.modelRouterManualOpen);
        const btn = root.querySelector('#answer_me_manual_toggle');
        if (btn) btn.textContent = s.modelRouterManualOpen ? '▾ 收起手动点名' : '▸ 手动点名（备用）';
    }

    function renderRouter() {
        const root = document.querySelector('#answer_me_settings');
        if (!root) return false;
        installStyle();

        let box = root.querySelector('#answer_me_model_router');
        if (!box) {
            box = document.createElement('div');
            box.id = 'answer_me_model_router';
            const note = root.querySelector('.answer-me-note');
            if (note?.nextSibling) note.parentNode.insertBefore(box, note.nextSibling);
            else root.prepend(box);
        }

        const gs = groups();
        const active = selectedGroup();
        const mode = transportMode();

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
            btn.textContent = g.display;
            btn.title = [...g.models].join('\n');
            btn.addEventListener('click', async () => {
                applySelectedProfiles(g);
                await switchCurrentProfile(g.profiles);
                setNativeStreamMode(transportMode());
                renderRouter();
                window.toastr?.success?.(`${g.display} 队已集合 · ${g.profiles.length} 家`, '🍚 Answer Me');
            });
            chips.appendChild(btn);
        }

        if (!gs.length) {
            const empty = document.createElement('span');
            empty.textContent = '没读到可用 Connection Profile';
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
                if (!s) return;
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
            ? `当前：${active.display} · ${active.profiles.length} 家可用 · ${mode === 'stream' ? '真流式' : '假流式'}`
            : '当前没有可用模型组';

        const modelsLine = document.createElement('div');
        modelsLine.className = 'am-router-models';
        modelsLine.textContent = active ? `实际模型名：${[...active.models].join(' / ')}` : '';

        const manual = document.createElement('button');
        manual.type = 'button';
        manual.id = 'answer_me_manual_toggle';
        manual.className = 'am-router-manual';
        manual.addEventListener('click', () => {
            const s = settings();
            if (!s) return;
            s.modelRouterManualOpen = !s.modelRouterManualOpen;
            saveSettings();
            syncManualVisibility(root);
        });

        box.append(row1, row2, summary, modelsLine, manual);
        syncManualVisibility(root);
        return true;
    }

    function bindNativeStreamMirror() {
        const input = document.querySelector('#stream_toggle');
        if (!input || input.dataset.answerMeRouterBound === '1') return;
        input.dataset.answerMeRouterBound = '1';
        input.addEventListener('change', () => {
            const s = settings();
            if (!s) return;
            s.transportMode = input.checked ? 'stream' : 'fake';
            saveSettings();
            renderRouter();
        });
    }

    async function initialApply() {
        const g = selectedGroup();
        if (!g) return;
        const s = settings();
        if (!s.selectedModelGroup) {
            applySelectedProfiles(g);
        }
        setNativeStreamMode(transportMode());
    }

    window.AnswerMeModelRouter = {
        version: VERSION,
        groups,
        extractVersion,
        get selected() { return selectedGroup(); },
        get transportMode() { return transportMode(); },
        select: async key => {
            const g = groups().find(x => x.key === key);
            if (!g) return false;
            applySelectedProfiles(g);
            await switchCurrentProfile(g.profiles);
            setNativeStreamMode(transportMode());
            renderRouter();
            return true;
        },
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
                if (renderRouter() && !initialized) {
                    initialized = true;
                    void initialApply();
                }
            } catch (error) {
                console.warn('[💢 Answer Me] model router sweep failed', error);
            }
        }, 350);

        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
        console.log(`[💢 Answer Me] model router ${VERSION} ready · 模型组 + 真/假流全局切换`);
    }

    boot().catch(error => console.error('[💢 Answer Me] model router startup failed', error));
})();
