(() => {
    'use strict';

    const EXT = 'answerMe';
    const DISPLAY = '💢 Answer Me';
    const VERSION = '0.1.0-beta.1';

    const defaults = {
        enabled: false,
        profileIds: [],
        maxTokens: 0,
        hardTimeoutMs: 90000,
        keepStartedAsSwipes: true,
        killColdAfterWinner: true,
        showFloatingStatus: true,
    };

    let ctx = null;
    let settings = null;
    let currentGenerationType = null;
    let roundSeq = 0;
    let activeRound = null;
    let bound = false;
    let settingsMounted = false;

    const $ = window.jQuery;

    function log(...args) {
        console.log(`[${DISPLAY}]`, ...args);
    }

    function warn(...args) {
        console.warn(`[${DISPLAY}]`, ...args);
    }

    function toast(type, message, title = DISPLAY) {
        try {
            if (window.toastr?.[type]) {
                window.toastr[type](message, title, {
                    preventDuplicates: true,
                    timeOut: type === 'error' ? 9000 : 4500,
                });
            } else {
                log(`${title}: ${message}`);
            }
        } catch {
            log(`${title}: ${message}`);
        }
    }

    function getContext() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function ensureSettings() {
        ctx = getContext();
        if (!ctx) return false;

        ctx.extensionSettings[EXT] ??= {};
        settings = ctx.extensionSettings[EXT];

        for (const [key, value] of Object.entries(defaults)) {
            if (settings[key] === undefined) {
                settings[key] = structuredClone(value);
            }
        }

        if (!Array.isArray(settings.profileIds)) {
            settings.profileIds = [];
        }

        return true;
    }

    function saveSettings() {
        try {
            ctx?.saveSettingsDebounced?.();
        } catch (e) {
            warn('保存设置失败', e);
        }
    }

    function getProfiles() {
        if (!ensureSettings()) return [];
        const profiles = ctx.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(profiles) ? profiles : [];
    }

    function getService() {
        return ctx?.ConnectionManagerRequestService ?? null;
    }

    function getSelectedCurrentProfileId() {
        return ctx?.extensionSettings?.connectionManager?.selectedProfile ?? null;
    }

    function profileLabel(profile) {
        const model = profile?.model ? ` · ${profile.model}` : '';
        const api = profile?.api ? ` · ${profile.api}` : '';
        return `${profile?.name || '未命名连接'}${model}${api}`;
    }

    function isProfileUsable(profile) {
        const service = getService();
        if (!service || !profile?.id) return false;
        try {
            if (typeof service.isProfileSupported === 'function') {
                return service.isProfileSupported(profile);
            }
            return true;
        } catch {
            return false;
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function mountSettings() {
        if (settingsMounted || !ensureSettings()) return;

        const host = document.querySelector('#extensions_settings2')
            || document.querySelector('#extensions_settings')
            || document.querySelector('#extensions_settings_content');

        if (!host) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'answer_me_settings';
        wrapper.className = 'answer-me-settings';
        wrapper.innerHTML = `
            <div class="answer-me-head">
                <div>
                    <div class="answer-me-title">💢 Answer Me</div>
                    <div class="answer-me-subtitle">你们几个谁他妈先回我 · v${VERSION}</div>
                </div>
                <label class="answer-me-switch-row">
                    <input id="answer_me_enabled" type="checkbox">
                    <span>启用赛马</span>
                </label>
            </div>

            <div class="answer-me-note">
                第一条完整回复当主回复；已经开始吐正文的继续生成并收进 Swipe；主回复出现后，仍然一个正文 token 都没吐的请求直接处决。
            </div>

            <div class="answer-me-toolbar">
                <button id="answer_me_refresh" class="menu_button">刷新连接配置</button>
                <button id="answer_me_select_all" class="menu_button">全选可用站</button>
                <button id="answer_me_clear" class="menu_button">清空</button>
            </div>

            <div class="answer-me-profile-title">参赛 Connection Profiles</div>
            <div id="answer_me_profiles" class="answer-me-profiles"></div>

            <div class="answer-me-grid">
                <label>
                    <span>硬超时（秒）</span>
                    <input id="answer_me_timeout" type="number" min="15" max="300" step="5">
                </label>
                <label>
                    <span>最大输出 Token（0=沿用酒馆）</span>
                    <input id="answer_me_tokens" type="number" min="0" step="128">
                </label>
            </div>

            <label class="answer-me-check-row">
                <input id="answer_me_keep_started" type="checkbox">
                <span>已经开口的站继续吐完，完成后放进 Swipe</span>
            </label>
            <label class="answer-me-check-row">
                <input id="answer_me_kill_cold" type="checkbox">
                <span>出现主回复后，零正文 token 的冷暴力请求立即 Abort</span>
            </label>
            <label class="answer-me-check-row">
                <input id="answer_me_float" type="checkbox">
                <span>显示右下角赛马状态</span>
            </label>
        `;

        host.appendChild(wrapper);
        settingsMounted = true;

        const enabled = wrapper.querySelector('#answer_me_enabled');
        const timeout = wrapper.querySelector('#answer_me_timeout');
        const tokens = wrapper.querySelector('#answer_me_tokens');
        const keepStarted = wrapper.querySelector('#answer_me_keep_started');
        const killCold = wrapper.querySelector('#answer_me_kill_cold');
        const floatStatus = wrapper.querySelector('#answer_me_float');

        enabled.checked = !!settings.enabled;
        timeout.value = String(Math.round((settings.hardTimeoutMs || 90000) / 1000));
        tokens.value = String(settings.maxTokens || 0);
        keepStarted.checked = !!settings.keepStartedAsSwipes;
        killCold.checked = !!settings.killColdAfterWinner;
        floatStatus.checked = !!settings.showFloatingStatus;

        enabled.addEventListener('change', () => {
            settings.enabled = enabled.checked;
            saveSettings();
            if (!settings.enabled) abortWholeRound('插件已关闭');
            renderFloatingStatus();
        });

        timeout.addEventListener('change', () => {
            settings.hardTimeoutMs = Math.max(15000, Number(timeout.value || 90) * 1000);
            saveSettings();
        });

        tokens.addEventListener('change', () => {
            settings.maxTokens = Math.max(0, Number(tokens.value || 0));
            saveSettings();
        });

        keepStarted.addEventListener('change', () => {
            settings.keepStartedAsSwipes = keepStarted.checked;
            saveSettings();
        });

        killCold.addEventListener('change', () => {
            settings.killColdAfterWinner = killCold.checked;
            saveSettings();
        });

        floatStatus.addEventListener('change', () => {
            settings.showFloatingStatus = floatStatus.checked;
            saveSettings();
            renderFloatingStatus();
        });

        wrapper.querySelector('#answer_me_refresh').addEventListener('click', renderProfiles);
        wrapper.querySelector('#answer_me_clear').addEventListener('click', () => {
            settings.profileIds = [];
            saveSettings();
            renderProfiles();
        });
        wrapper.querySelector('#answer_me_select_all').addEventListener('click', () => {
            settings.profileIds = getProfiles().filter(isProfileUsable).map(x => x.id);
            saveSettings();
            renderProfiles();
        });

        renderProfiles();
        ensureFloatingPanel();
        renderFloatingStatus();
    }

    function renderProfiles() {
        if (!settingsMounted || !ensureSettings()) return;
        const box = document.querySelector('#answer_me_profiles');
        if (!box) return;

        const profiles = getProfiles();
        if (!profiles.length) {
            box.innerHTML = '<div class="answer-me-empty">还没有 Connection Profile。先在酒馆连接管理器里把几个站分别存成配置。</div>';
            return;
        }

        box.innerHTML = '';
        for (const profile of profiles) {
            const usable = isProfileUsable(profile);
            const row = document.createElement('label');
            row.className = `answer-me-profile ${usable ? '' : 'is-disabled'}`;
            row.innerHTML = `
                <input type="checkbox" value="${escapeHtml(profile.id)}" ${usable ? '' : 'disabled'}>
                <span class="answer-me-profile-main">
                    <span class="answer-me-profile-name">${escapeHtml(profile.name || '未命名')}</span>
                    <span class="answer-me-profile-meta">${escapeHtml([profile.model, profile.api].filter(Boolean).join(' · '))}</span>
                </span>
                <span class="answer-me-profile-state">${usable ? '可参赛' : '暂不支持'}</span>
            `;

            const checkbox = row.querySelector('input');
            checkbox.checked = usable && settings.profileIds.includes(profile.id);
            checkbox.addEventListener('change', () => {
                const set = new Set(settings.profileIds);
                checkbox.checked ? set.add(profile.id) : set.delete(profile.id);
                settings.profileIds = [...set];
                saveSettings();
            });
            box.appendChild(row);
        }
    }

    function ensureFloatingPanel() {
        if (document.querySelector('#answer_me_float_panel')) return;
        const panel = document.createElement('div');
        panel.id = 'answer_me_float_panel';
        panel.className = 'answer-me-float hidden';
        panel.innerHTML = `
            <div class="answer-me-float-head">
                <span>💢 Answer Me</span>
                <button type="button" id="answer_me_abort" title="终止本轮">×</button>
            </div>
            <div id="answer_me_float_body" class="answer-me-float-body"></div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('#answer_me_abort').addEventListener('click', () => {
            abortWholeRound('用户手动终止本轮');
            toast('info', '本轮赛马已全部扇停。');
        });
    }

    function statusIcon(candidate) {
        if (candidate.winner) return '🏆';
        if (candidate.finished) return '✅';
        if (candidate.aborted) return '💥';
        if (candidate.error) return '❌';
        if (candidate.started) return '🟢';
        return '⚫';
    }

    function statusText(candidate) {
        if (candidate.winner) return '抢答成功';
        if (candidate.finished) return '已完成 · Swipe';
        if (candidate.aborted) return '冷暴力，已扇死';
        if (candidate.error) return candidate.error;
        if (candidate.started) return '已经开口，准许继续说';
        return '零正文 token · 等待开口';
    }

    function renderFloatingStatus() {
        ensureFloatingPanel();
        const panel = document.querySelector('#answer_me_float_panel');
        const body = document.querySelector('#answer_me_float_body');
        if (!panel || !body) return;

        if (!settings?.showFloatingStatus || !settings?.enabled) {
            panel.classList.add('hidden');
            return;
        }

        if (!activeRound) {
            panel.classList.remove('hidden');
            body.innerHTML = '<div class="answer-me-idle">待机中 · 谁冷暴力谁挨肘</div>';
            return;
        }

        panel.classList.remove('hidden');
        const rows = [];
        for (const c of activeRound.candidates.values()) {
            const elapsed = c.finishedAt
                ? ((c.finishedAt - activeRound.startedAt) / 1000).toFixed(1)
                : ((Date.now() - activeRound.startedAt) / 1000).toFixed(1);
            rows.push(`
                <div class="answer-me-status-row ${c.winner ? 'is-winner' : ''}">
                    <span class="answer-me-status-icon">${statusIcon(c)}</span>
                    <span class="answer-me-status-name">${escapeHtml(c.name)}</span>
                    <span class="answer-me-status-msg">${escapeHtml(statusText(c))}</span>
                    <span class="answer-me-status-time">${elapsed}s</span>
                </div>
            `);
        }
        body.innerHTML = rows.join('') || '<div class="answer-me-idle">正在准备参赛选手…</div>';
    }

    function makeOriginalCandidate() {
        return {
            id: '__original__',
            profileId: getSelectedCurrentProfileId(),
            name: '当前酒馆请求',
            isOriginal: true,
            controller: null,
            started: false,
            finished: false,
            aborted: false,
            error: '',
            text: '',
            winner: false,
            finishedAt: 0,
        };
    }

    function makeSideCandidate(profile) {
        return {
            id: profile.id,
            profileId: profile.id,
            name: profile.name || profile.id,
            profile,
            isOriginal: false,
            controller: new AbortController(),
            started: false,
            finished: false,
            aborted: false,
            error: '',
            text: '',
            winner: false,
            finishedAt: 0,
        };
    }

    function abortCandidate(candidate, reason = 'aborted') {
        if (!candidate || candidate.finished || candidate.aborted) return;
        candidate.aborted = true;
        candidate.error = '';
        try {
            candidate.controller?.abort(reason);
        } catch {}
        renderFloatingStatus();
    }

    function abortWholeRound(reason = 'cancelled') {
        const round = activeRound;
        if (!round) return;
        clearTimeout(round.timeoutId);
        for (const c of round.candidates.values()) {
            if (!c.isOriginal) abortCandidate(c, reason);
        }
        if (!round.originalFinished && !round.suppressOriginalStop) {
            round.suppressOriginalStop = true;
            try { ctx?.stopGeneration?.(); } catch {}
        }
        activeRound = null;
        renderFloatingStatus();
    }

    function meaningful(text) {
        return String(text ?? '').trim().length > 0;
    }

    async function appendSwipe(text, sourceName) {
        if (!meaningful(text) || !ctx?.chat?.length) return;
        const index = ctx.chat.length - 1;
        const message = ctx.chat[index];
        if (!message || message.is_user || message.is_system) return;

        message.swipes = Array.isArray(message.swipes) ? message.swipes : [String(message.mes ?? '')];
        if (!message.swipes.includes(String(message.mes ?? ''))) {
            message.swipes.unshift(String(message.mes ?? ''));
        }
        if (message.swipes.includes(text)) return;

        message.swipes.push(text);
        message.swipe_info = Array.isArray(message.swipe_info) ? message.swipe_info : [];
        while (message.swipe_info.length < message.swipes.length) {
            message.swipe_info.push({
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: new Date(),
                extra: { answer_me_source: sourceName },
            });
        }

        await ctx.saveChat?.();
        try { await ctx.reloadCurrentChat?.(); } catch {}
        log(`已把 ${sourceName} 的回复收进 Swipe`);
    }

    async function installSideWinnerImmediately(round, candidate) {
        if (round !== activeRound || round.mainInstalled) return;
        round.mainInstalled = true;
        round.suppressOriginalStop = true;

        try {
            ctx.stopGeneration?.();
        } catch {}

        await new Promise(resolve => setTimeout(resolve, 80));

        const last = ctx.chat?.[ctx.chat.length - 1];
        if (last && !last.is_user && !last.is_system) {
            try { await ctx.deleteLastMessage?.(); } catch (e) { warn('删除原请求残留消息失败', e); }
        }

        round.insertingWinner = true;
        try {
            await ctx.saveReply?.({ type: 'normal', getMessage: candidate.text });
            await ctx.saveChat?.();
        } finally {
            round.insertingWinner = false;
        }

        for (const queued of round.queuedSwipes.splice(0)) {
            await appendSwipe(queued.text, queued.name);
        }
    }

    async function reorderOriginalIntoSwipe(round, originalText) {
        if (round !== activeRound || !round.winner || round.winner.isOriginal) return;
        if (!ctx?.chat?.length) return;

        const message = ctx.chat[ctx.chat.length - 1];
        if (!message || message.is_user || message.is_system) return;

        const winnerText = round.winner.text;
        const extras = [];
        if (meaningful(originalText) && originalText !== winnerText) extras.push(originalText);
        for (const q of round.queuedSwipes) {
            if (meaningful(q.text) && q.text !== winnerText && !extras.includes(q.text)) extras.push(q.text);
        }

        const oldSwipes = Array.isArray(message.swipes) ? message.swipes.filter(Boolean) : [];
        for (const sw of oldSwipes) {
            if (sw !== winnerText && !extras.includes(sw)) extras.push(sw);
        }

        message.mes = winnerText;
        message.swipes = [winnerText, ...extras];
        message.swipe_id = 0;
        const baseInfo = Array.isArray(message.swipe_info) && message.swipe_info[0]
            ? structuredClone(message.swipe_info[0])
            : {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: {},
            };
        message.swipe_info = message.swipes.map((_, i) => ({
            ...structuredClone(baseInfo),
            extra: {
                ...(baseInfo.extra || {}),
                answer_me_source: i === 0 ? round.winner.name : (i === 1 ? '当前酒馆请求' : '并行站点'),
            },
        }));

        round.queuedSwipes.length = 0;
        round.mainInstalled = true;
        await ctx.saveChat?.();
        try { await ctx.reloadCurrentChat?.(); } catch {}
    }

    function killColdCandidates(round) {
        if (!settings.killColdAfterWinner) return;
        for (const c of round.candidates.values()) {
            if (c.winner || c.finished || c.aborted || c.error) continue;
            if (c.started) continue;

            if (c.isOriginal) {
                if (!round.winner?.isOriginal) {
                    round.suppressOriginalStop = true;
                    try { ctx.stopGeneration?.(); } catch {}
                    c.aborted = true;
                }
            } else {
                abortCandidate(c, 'winner-selected-cold-request');
            }
        }
    }

    async function selectWinner(round, candidate) {
        if (round !== activeRound || round.winner || !meaningful(candidate.text)) return;
        candidate.winner = true;
        candidate.finished = true;
        candidate.finishedAt ||= Date.now();
        round.winner = candidate;
        renderFloatingStatus();

        toast('success', `${candidate.name} 抢答成功。没开口的现在挨肘。`, '🏆 Answer Me');
        killColdCandidates(round);

        if (candidate.isOriginal) {
            round.mainInstalled = true;
            return;
        }

        const original = round.candidates.get('__original__');
        if (!original?.started) {
            await installSideWinnerImmediately(round, candidate);
        }
        // 原请求已经吐字：让它继续。完成时再把它降级成 Swipe，赢家换到主回复。
    }

    async function sideFinished(round, candidate) {
        if (round !== activeRound || candidate.aborted) return;
        candidate.finished = true;
        candidate.finishedAt = Date.now();
        renderFloatingStatus();

        if (!round.winner) {
            await selectWinner(round, candidate);
            return;
        }

        if (round.winner === candidate) return;
        if (!settings.keepStartedAsSwipes) return;

        if (round.mainInstalled) {
            await appendSwipe(candidate.text, candidate.name);
        } else {
            round.queuedSwipes.push({ text: candidate.text, name: candidate.name });
        }
    }

    async function runSideCandidate(round, candidate, prompt, maxTokens) {
        const service = getService();
        if (!service) {
            candidate.error = '连接管理请求服务不可用';
            renderFloatingStatus();
            return;
        }

        try {
            const factory = await service.sendRequest(
                candidate.profileId,
                prompt,
                maxTokens,
                {
                    stream: true,
                    signal: candidate.controller.signal,
                    extractData: true,
                    // prompt 已经由当前酒馆完整组装，避免每个站再叠一份 preset / instruct。
                    includePreset: false,
                    includeInstruct: false,
                },
            );

            if (typeof factory !== 'function') {
                throw new Error('流式请求没有返回生成器');
            }

            for await (const chunk of factory()) {
                if (round !== activeRound || candidate.aborted) return;
                const next = String(chunk?.text ?? '');
                if (next.length > candidate.text.length) {
                    candidate.text = next;
                }
                // reasoning 不算开口；只有真正正文 text 才算。
                if (!candidate.started && meaningful(candidate.text)) {
                    candidate.started = true;
                    renderFloatingStatus();
                }
            }

            if (!candidate.aborted) {
                if (!meaningful(candidate.text)) {
                    candidate.error = '空回';
                    renderFloatingStatus();
                    return;
                }
                await sideFinished(round, candidate);
            }
        } catch (e) {
            if (candidate.controller.signal.aborted || candidate.aborted) {
                candidate.aborted = true;
                candidate.error = '';
            } else {
                candidate.error = String(e?.message || e || '请求失败').slice(0, 120);
                warn(`${candidate.name} 请求失败`, e);
            }
            renderFloatingStatus();
        }
    }

    function chosenSideProfiles() {
        const currentId = getSelectedCurrentProfileId();
        const wanted = new Set(settings.profileIds);
        return getProfiles().filter(profile =>
            wanted.has(profile.id)
            && profile.id !== currentId
            && isProfileUsable(profile)
        );
    }

    function makeRound(generateData) {
        const id = ++roundSeq;
        const round = {
            id,
            type: currentGenerationType,
            startedAt: Date.now(),
            winner: null,
            mainInstalled: false,
            originalFinished: false,
            suppressOriginalStop: false,
            insertingWinner: false,
            queuedSwipes: [],
            candidates: new Map(),
            timeoutId: null,
            prompt: structuredClone(generateData?.prompt ?? ''),
        };

        const original = makeOriginalCandidate();
        round.candidates.set(original.id, original);
        for (const profile of chosenSideProfiles()) {
            const c = makeSideCandidate(profile);
            round.candidates.set(c.id, c);
        }

        return round;
    }

    async function startRace(generateData, dryRun) {
        if (dryRun || !ensureSettings() || !settings.enabled) return;
        if (!['normal', 'regenerate'].includes(currentGenerationType)) return;
        if (activeRound) abortWholeRound('新一轮生成开始');

        const sides = chosenSideProfiles();
        if (!sides.length) return;

        const round = makeRound(generateData);
        activeRound = round;
        renderFloatingStatus();

        const maxTokens = settings.maxTokens > 0
            ? settings.maxTokens
            : Number(ctx.getMaxResponseTokens?.() || ctx.chatCompletionSettings?.openai_max_tokens || 2048);

        round.timeoutId = setTimeout(() => {
            if (activeRound !== round) return;
            for (const c of round.candidates.values()) {
                if (!c.finished && !c.aborted && !c.isOriginal) {
                    abortCandidate(c, 'hard-timeout');
                    if (!c.started) c.error = '硬超时，已抬走';
                }
            }
            renderFloatingStatus();
            if (!round.winner) {
                toast('error', '全员超时/失败。本轮没有任何一个正常回复。', '💢 Answer Me · 全军覆没');
            }
        }, settings.hardTimeoutMs);

        log(`第 ${round.id} 轮开赛`, sides.map(profileLabel));
        for (const candidate of round.candidates.values()) {
            if (!candidate.isOriginal) {
                runSideCandidate(round, candidate, round.prompt, maxTokens);
            }
        }
    }

    function onGenerationStarted(type) {
        currentGenerationType = type;
    }

    function onStreamToken() {
        const round = activeRound;
        if (!round || round.originalFinished) return;
        const original = round.candidates.get('__original__');
        if (!original || original.aborted || original.finished) return;
        original.started = true;
        renderFloatingStatus();
    }

    async function onMessageReceived() {
        const round = activeRound;
        if (!round || round.insertingWinner || round.originalFinished) return;
        if (!ctx?.chat?.length) return;

        const message = ctx.chat[ctx.chat.length - 1];
        if (!message || message.is_user || message.is_system) return;

        const original = round.candidates.get('__original__');
        if (!original || original.aborted) return;

        original.text = String(message.mes ?? '');
        original.finished = meaningful(original.text);
        original.finishedAt = Date.now();
        round.originalFinished = true;
        renderFloatingStatus();

        if (!original.finished) {
            original.error = '空回';
            renderFloatingStatus();
            return;
        }

        if (!round.winner) {
            await selectWinner(round, original);
        } else if (!round.winner.isOriginal) {
            await reorderOriginalIntoSwipe(round, original.text);
        }

        for (const q of round.queuedSwipes.splice(0)) {
            await appendSwipe(q.text, q.name);
        }
    }

    function onGenerationStopped() {
        const round = activeRound;
        if (!round) return;
        if (round.suppressOriginalStop) return;
        abortWholeRound('用户停止了当前生成');
    }

    function onChatChanged() {
        abortWholeRound('聊天切换');
    }

    function bindEvents() {
        if (bound || !ensureSettings()) return false;
        const source = ctx.eventSource;
        const events = ctx.eventTypes || ctx.event_types;
        if (!source || !events) return false;

        source.on(events.GENERATION_STARTED, onGenerationStarted);
        source.on(events.GENERATE_AFTER_DATA, startRace);
        source.on(events.STREAM_TOKEN_RECEIVED, onStreamToken);
        source.on(events.MESSAGE_RECEIVED, onMessageReceived);
        source.on(events.GENERATION_STOPPED, onGenerationStopped);
        source.on(events.CHAT_CHANGED, onChatChanged);

        bound = true;
        log(`v${VERSION} 已绑定 SillyTavern 事件。`);
        return true;
    }

    function exposeDebugApi() {
        window.AnswerMe = {
            version: VERSION,
            get settings() { return settings; },
            get round() { return activeRound; },
            profiles: getProfiles,
            refresh: renderProfiles,
            abort: () => abortWholeRound('debug abort'),
        };
    }

    function init() {
        if (!ensureSettings()) return false;
        bindEvents();
        mountSettings();
        exposeDebugApi();
        return bound;
    }

    if (!init()) {
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            if (init() || tries >= 60) {
                clearInterval(timer);
                if (!bound) {
                    toast('error', '启动失败：没有拿到 SillyTavern 扩展接口。');
                }
            }
        }, 500);
    }
})();
