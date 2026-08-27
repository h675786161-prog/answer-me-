(() => {
    'use strict';

    const EXT = 'answerMe';
    const DISPLAY = '💢 Answer Me';
    const VERSION = '0.2.0-beta.2';
    const RETRY_DELAYS = [2000, 5000, 12000, 25000];

    const defaults = {
        enabled: false,
        profileIds: [],
        maxTokens: 0,
        coldTimeoutMs: 90000,
        keepStartedAsSwipes: true,
        killColdAfterWinner: true,
        showFloatingStatus: true,
        autoRetryEnabled: true,
        maxRetryRounds: 4,
    };

    let ctx = null;
    let settings = null;
    let currentGenerationType = null;
    let currentGenerationIsAutoRetry = false;
    let roundSeq = 0;
    let activeRound = null;
    let bound = false;
    let settingsMounted = false;
    let lastResult = '';

    const retryState = {
        count: 0,
        timer: null,
        dueAt: 0,
        nextGenerationIsRetry: false,
        lastReason: '',
    };

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

        // beta.1 -> beta.2 migration: 原“硬超时”改成“冷暴力等待上限”。
        if (settings.coldTimeoutMs === undefined && settings.hardTimeoutMs !== undefined) {
            settings.coldTimeoutMs = settings.hardTimeoutMs;
        }

        for (const [key, value] of Object.entries(defaults)) {
            if (settings[key] === undefined) {
                settings[key] = structuredClone(value);
            }
        }

        if (!Array.isArray(settings.profileIds)) settings.profileIds = [];
        settings.maxRetryRounds = Math.max(0, Math.min(8, Number(settings.maxRetryRounds ?? 4)));
        settings.coldTimeoutMs = Math.max(15000, Number(settings.coldTimeoutMs || 90000));
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

    function meaningful(text) {
        return String(text ?? '').trim().length > 0;
    }

    function clearRetryTimer() {
        if (retryState.timer) {
            clearTimeout(retryState.timer);
            retryState.timer = null;
        }
        retryState.dueAt = 0;
    }

    function resetRetryChain(reason = '') {
        clearRetryTimer();
        retryState.count = 0;
        retryState.nextGenerationIsRetry = false;
        retryState.lastReason = '';
        if (reason) log(`重试链已清空：${reason}`);
    }

    function cancelRetryChain(reason = '') {
        resetRetryChain(reason || 'cancelled');
        renderFloatingStatus();
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
                第一条完整回复当主回复；已经吐正文的继续生成并收进 Swipe；赢家出现后仍然零正文 token 的冷暴力请求直接处决。全军覆没时才启动「💢你他妈倒是回我啊」。
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
                    <span>冷暴力等待上限（秒）</span>
                    <input id="answer_me_timeout" type="number" min="15" max="300" step="5">
                </label>
                <label>
                    <span>最大输出 Token（0=沿用酒馆）</span>
                    <input id="answer_me_tokens" type="number" min="0" step="128">
                </label>
                <label>
                    <span>全军覆没后最多再肘几轮</span>
                    <input id="answer_me_retry_rounds" type="number" min="0" max="8" step="1">
                </label>
                <div class="answer-me-grid-note">
                    <span>重试退避</span>
                    <strong>2s → 5s → 12s → 25s</strong>
                </div>
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
                <input id="answer_me_auto_retry" type="checkbox">
                <span>全军覆没后自动重试整轮赛马</span>
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
        const retryRounds = wrapper.querySelector('#answer_me_retry_rounds');
        const keepStarted = wrapper.querySelector('#answer_me_keep_started');
        const killCold = wrapper.querySelector('#answer_me_kill_cold');
        const autoRetry = wrapper.querySelector('#answer_me_auto_retry');
        const floatStatus = wrapper.querySelector('#answer_me_float');

        enabled.checked = !!settings.enabled;
        timeout.value = String(Math.round(settings.coldTimeoutMs / 1000));
        tokens.value = String(settings.maxTokens || 0);
        retryRounds.value = String(settings.maxRetryRounds ?? 4);
        keepStarted.checked = !!settings.keepStartedAsSwipes;
        killCold.checked = !!settings.killColdAfterWinner;
        autoRetry.checked = !!settings.autoRetryEnabled;
        floatStatus.checked = !!settings.showFloatingStatus;

        enabled.addEventListener('change', () => {
            settings.enabled = enabled.checked;
            saveSettings();
            if (!settings.enabled) {
                abortWholeRound('插件已关闭', true);
                cancelRetryChain('插件已关闭');
            }
            renderFloatingStatus();
        });

        timeout.addEventListener('change', () => {
            settings.coldTimeoutMs = Math.max(15000, Number(timeout.value || 90) * 1000);
            timeout.value = String(Math.round(settings.coldTimeoutMs / 1000));
            saveSettings();
        });

        tokens.addEventListener('change', () => {
            settings.maxTokens = Math.max(0, Number(tokens.value || 0));
            saveSettings();
        });

        retryRounds.addEventListener('change', () => {
            settings.maxRetryRounds = Math.max(0, Math.min(8, Number(retryRounds.value || 0)));
            retryRounds.value = String(settings.maxRetryRounds);
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

        autoRetry.addEventListener('change', () => {
            settings.autoRetryEnabled = autoRetry.checked;
            if (!settings.autoRetryEnabled) cancelRetryChain('自动重试已关闭');
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
                <button type="button" id="answer_me_abort" title="终止本轮和自动重试">×</button>
            </div>
            <div id="answer_me_float_meta" class="answer-me-float-meta"></div>
            <div id="answer_me_float_body" class="answer-me-float-body"></div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('#answer_me_abort').addEventListener('click', () => {
            abortWholeRound('用户手动终止本轮', true);
            cancelRetryChain('用户手动终止');
            toast('info', '本轮赛马和后续追杀重试都已扇停。');
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
        if (candidate.aborted) return candidate.error || '冷暴力，已扇死';
        if (candidate.error) return candidate.error;
        if (candidate.started) return '已经开口，准许继续说';
        return '零正文 token · 冷暴力观察中';
    }

    function renderFloatingStatus() {
        ensureFloatingPanel();
        const panel = document.querySelector('#answer_me_float_panel');
        const body = document.querySelector('#answer_me_float_body');
        const meta = document.querySelector('#answer_me_float_meta');
        if (!panel || !body || !meta) return;

        if (!settings?.showFloatingStatus || !settings?.enabled) {
            panel.classList.add('hidden');
            return;
        }

        panel.classList.remove('hidden');

        if (!activeRound) {
            if (retryState.timer && retryState.dueAt) {
                const left = Math.max(0, (retryState.dueAt - Date.now()) / 1000).toFixed(1);
                meta.textContent = `💢 全军覆没 · ${left}s 后第 ${retryState.count + 1} 次追杀`;
                body.innerHTML = `<div class="answer-me-idle">${escapeHtml(retryState.lastReason || '没有任何站正常回复')}</div>`;
            } else {
                meta.textContent = lastResult || '待机';
                body.innerHTML = '<div class="answer-me-idle">谁冷暴力谁挨肘</div>';
            }
            return;
        }

        const retryTag = activeRound.retryNo > 0 ? ` · 第 ${activeRound.retryNo} 次追杀` : '';
        meta.textContent = `第 ${activeRound.id} 轮${retryTag}`;

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

    function candidateTerminal(candidate) {
        return !!(candidate?.finished || candidate?.aborted || candidate?.error);
    }

    function allCandidatesTerminal(round) {
        return [...round.candidates.values()].every(candidateTerminal);
    }

    function abortCandidate(candidate, reason = '已 Abort') {
        if (!candidate || candidate.finished || candidate.aborted) return;
        candidate.aborted = true;
        candidate.error = reason;
        candidate.finishedAt ||= Date.now();
        try {
            candidate.controller?.abort(reason);
        } catch {}
        renderFloatingStatus();
    }

    function abortWholeRound(reason = 'cancelled', stopOriginal = false) {
        const round = activeRound;
        if (!round) return;
        clearTimeout(round.timeoutId);

        for (const c of round.candidates.values()) {
            if (!c.isOriginal && !candidateTerminal(c)) {
                abortCandidate(c, reason);
            }
        }

        const original = round.candidates.get('__original__');
        if (original && !candidateTerminal(original)) {
            original.aborted = true;
            original.error = reason;
            original.finishedAt = Date.now();
        }

        if (stopOriginal && !round.originalFinished && !round.suppressOriginalStop) {
            round.suppressOriginalStop = true;
            try { ctx?.stopGeneration?.(); } catch {}
        }

        activeRound = null;
        renderFloatingStatus();
    }

    async function appendSwipe(text, sourceName) {
        if (!meaningful(text) || !ctx?.chat?.length) return;
        const index = ctx.chat.length - 1;
        const message = ctx.chat[index];
        if (!message || message.is_user || message.is_system) return;

        const mainText = String(message.mes ?? '');
        message.swipes = Array.isArray(message.swipes) ? message.swipes : [mainText];
        if (!message.swipes.includes(mainText)) message.swipes.unshift(mainText);
        if (message.swipes.includes(text)) return;

        const baseInfo = Array.isArray(message.swipe_info) && message.swipe_info[0]
            ? structuredClone(message.swipe_info[0])
            : {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: {},
            };

        message.swipes.push(text);
        message.swipe_info = Array.isArray(message.swipe_info) ? message.swipe_info : [];
        while (message.swipe_info.length < message.swipes.length - 1) {
            message.swipe_info.push(structuredClone(baseInfo));
        }
        message.swipe_info.push({
            ...structuredClone(baseInfo),
            gen_finished: new Date(),
            extra: {
                ...(baseInfo.extra || {}),
                answer_me_source: sourceName,
            },
        });

        await ctx.saveChat?.();
        try { await ctx.reloadCurrentChat?.(); } catch {}
        log(`已把 ${sourceName} 的回复收进 Swipe`);
    }

    async function flushQueuedSwipes(round) {
        if (!round?.mainInstalled) return;
        const queued = round.queuedSwipes.splice(0);
        for (const q of queued) {
            await appendSwipe(q.text, q.name);
        }
    }

    async function installSideWinnerImmediately(round, candidate) {
        if (round !== activeRound || round.mainInstalled) return;
        round.mainInstalled = true;
        round.suppressOriginalStop = true;

        try { ctx.stopGeneration?.(); } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));

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

        await flushQueuedSwipes(round);
        await maybeFinalizeRound(round);
    }

    async function reorderOriginalIntoSwipe(round, originalText) {
        if (round !== activeRound || !round.winner || round.winner.isOriginal) return;
        if (!ctx?.chat?.length) return;

        const message = ctx.chat[ctx.chat.length - 1];
        if (!message || message.is_user || message.is_system) return;

        const winnerText = round.winner.text;
        const extras = [];
        if (meaningful(originalText) && originalText !== winnerText) extras.push({ text: originalText, name: '当前酒馆请求' });
        for (const q of round.queuedSwipes) {
            if (meaningful(q.text) && q.text !== winnerText && !extras.some(x => x.text === q.text)) extras.push(q);
        }

        const oldSwipes = Array.isArray(message.swipes) ? message.swipes.filter(Boolean) : [];
        for (const sw of oldSwipes) {
            if (sw !== winnerText && !extras.some(x => x.text === sw)) extras.push({ text: sw, name: '原有 Swipe' });
        }

        const baseInfo = Array.isArray(message.swipe_info) && message.swipe_info[0]
            ? structuredClone(message.swipe_info[0])
            : {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: {},
            };

        message.mes = winnerText;
        message.swipes = [winnerText, ...extras.map(x => x.text)];
        message.swipe_id = 0;
        message.swipe_info = message.swipes.map((_, i) => ({
            ...structuredClone(baseInfo),
            extra: {
                ...(baseInfo.extra || {}),
                answer_me_source: i === 0 ? round.winner.name : extras[i - 1]?.name,
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
            if (c.winner || candidateTerminal(c) || c.started) continue;

            if (c.isOriginal) {
                if (!round.winner?.isOriginal) {
                    round.suppressOriginalStop = true;
                    c.aborted = true;
                    c.error = '冷暴力，已扇死';
                    c.finishedAt = Date.now();
                    try { ctx.stopGeneration?.(); } catch {}
                }
            } else {
                abortCandidate(c, '冷暴力，已扇死');
            }
        }
    }

    async function selectWinner(round, candidate) {
        if (round !== activeRound || round.winner || !meaningful(candidate.text)) return;

        candidate.winner = true;
        candidate.finished = true;
        candidate.error = '';
        candidate.finishedAt ||= Date.now();
        round.winner = candidate;

        clearRetryTimer();
        retryState.count = 0;
        retryState.lastReason = '';
        lastResult = `🏆 ${candidate.name} 刚刚抢答成功`;
        renderFloatingStatus();

        toast('success', `${candidate.name} 抢答成功。没开口的现在挨肘。`, '🏆 Answer Me');
        killColdCandidates(round);

        if (candidate.isOriginal) {
            round.mainInstalled = true;
            await flushQueuedSwipes(round);
            await maybeFinalizeRound(round);
            return;
        }

        const original = round.candidates.get('__original__');
        if (!original?.started) {
            await installSideWinnerImmediately(round, candidate);
        }
        // 当前酒馆已经吐正文：不杀。等它完整结束后，把它降为 Swipe。
    }

    async function sideFinished(round, candidate) {
        if (round !== activeRound || candidate.aborted) return;

        candidate.finished = true;
        candidate.error = '';
        candidate.finishedAt = Date.now();
        renderFloatingStatus();

        if (!round.winner) {
            await selectWinner(round, candidate);
            return;
        }

        if (round.winner === candidate) {
            await maybeFinalizeRound(round);
            return;
        }

        if (settings.keepStartedAsSwipes) {
            if (round.mainInstalled) {
                await appendSwipe(candidate.text, candidate.name);
            } else {
                round.queuedSwipes.push({ text: candidate.text, name: candidate.name });
            }
        }

        await maybeFinalizeRound(round);
    }

    async function markSideFailure(round, candidate, reason) {
        if (round !== activeRound || candidate.finished || candidate.aborted) return;
        candidate.error = reason;
        candidate.finishedAt = Date.now();
        renderFloatingStatus();
        await maybeHandleTotalFailure(round, reason);
    }

    async function runSideCandidate(round, candidate, prompt, maxTokens) {
        const service = getService();
        if (!service) {
            await markSideFailure(round, candidate, '连接管理请求服务不可用');
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
                    // prompt 已由当前酒馆完整组装；只借 Profile 的连接、模型和 Secret。
                    includePreset: false,
                    includeInstruct: false,
                },
            );

            if (typeof factory !== 'function') throw new Error('流式请求没有返回生成器');

            for await (const chunk of factory()) {
                if (round !== activeRound || candidate.aborted) return;

                const next = String(chunk?.text ?? '');
                if (next.length > candidate.text.length) candidate.text = next;

                // reasoning 不算开口。ConnectionManager 的 stream.text 是正文累计文本。
                if (!candidate.started && meaningful(candidate.text)) {
                    candidate.started = true;
                    renderFloatingStatus();
                }
            }

            if (candidate.aborted || round !== activeRound) return;

            if (!meaningful(candidate.text)) {
                await markSideFailure(round, candidate, '空回');
                return;
            }

            await sideFinished(round, candidate);
        } catch (e) {
            if (candidate.controller.signal.aborted || candidate.aborted) {
                candidate.aborted = true;
                candidate.finishedAt ||= Date.now();
                if (!candidate.error) candidate.error = '已 Abort';
                renderFloatingStatus();
                await maybeHandleTotalFailure(round, candidate.error);
                return;
            }

            const msg = String(e?.message || e || '请求失败').slice(0, 120);
            warn(`${candidate.name} 请求失败`, e);
            await markSideFailure(round, candidate, msg);
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
        const round = {
            id: ++roundSeq,
            retryNo: retryState.count,
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
            failureHandled: false,
            finalized: false,
            prompt: structuredClone(generateData?.prompt ?? ''),
        };

        const original = makeOriginalCandidate();
        round.candidates.set(original.id, original);
        for (const profile of chosenSideProfiles()) {
            round.candidates.set(profile.id, makeSideCandidate(profile));
        }

        return round;
    }

    async function maybeFinalizeRound(round) {
        if (round !== activeRound || round.finalized || !round.winner) return;
        if (!allCandidatesTerminal(round)) return;

        round.finalized = true;
        clearTimeout(round.timeoutId);
        await flushQueuedSwipes(round);

        setTimeout(() => {
            if (activeRound === round) {
                activeRound = null;
                renderFloatingStatus();
            }
        }, 700);
    }

    function retryDelayFor(count) {
        return RETRY_DELAYS[Math.min(count, RETRY_DELAYS.length - 1)] ?? 25000;
    }

    function scheduleAutoRetry(reason) {
        if (!settings?.enabled || !settings?.autoRetryEnabled) return false;
        if (retryState.timer) return true;
        if (retryState.count >= settings.maxRetryRounds) {
            toast('error', `已经追着肘了 ${settings.maxRetryRounds} 轮还是全军覆没。\n最后原因：${reason}`, '💢 Answer Me · 宣告抢救失败');
            lastResult = `☠️ 连续 ${settings.maxRetryRounds} 次追杀仍全军覆没`;
            renderFloatingStatus();
            return false;
        }

        const delay = retryDelayFor(retryState.count);
        retryState.lastReason = reason;
        retryState.dueAt = Date.now() + delay;

        toast(
            'warning',
            `全员都没给正常回复。第 ${retryState.count + 1}/${settings.maxRetryRounds} 次整轮追杀将在 ${delay / 1000}s 后执行。`,
            '💢 你他妈倒是回我啊',
        );

        retryState.timer = setTimeout(async () => {
            retryState.timer = null;
            retryState.dueAt = 0;

            if (!settings?.enabled || !settings?.autoRetryEnabled) return;

            if (activeRound && !activeRound.winner) {
                clearTimeout(activeRound.timeoutId);
                activeRound = null;
            }

            retryState.count += 1;
            retryState.nextGenerationIsRetry = true;
            renderFloatingStatus();

            try {
                await ctx.generate('regenerate');
            } catch (e) {
                const msg = String(e?.message || e || '重试请求失败').slice(0, 160);
                warn('整轮自动重试本身抛错', e);

                const round = activeRound;
                if (round && !round.winner) {
                    const original = round.candidates.get('__original__');
                    if (original && !candidateTerminal(original)) {
                        original.error = `原请求报错：${msg}`;
                        original.finishedAt = Date.now();
                        round.originalFinished = true;
                    }
                    await maybeHandleTotalFailure(round, msg);
                } else {
                    retryState.nextGenerationIsRetry = false;
                    scheduleAutoRetry(`重试请求自身报错：${msg}`);
                }
            }
        }, delay);

        renderFloatingStatus();
        return true;
    }

    async function maybeHandleTotalFailure(round, reason = '全员失败') {
        if (round !== activeRound || round.winner || round.failureHandled) return;
        if (!allCandidatesTerminal(round)) return;

        round.failureHandled = true;
        clearTimeout(round.timeoutId);
        lastResult = '☠️ 本轮全军覆没';

        const scheduled = scheduleAutoRetry(reason);
        if (!scheduled) {
            toast('error', '所有参赛请求都失败/空回/被超时处决，本轮没有正常回复。', '💢 Answer Me · 全军覆没');
        }

        if (activeRound === round) {
            activeRound = null;
        }
        renderFloatingStatus();
    }

    function startColdTimer(round) {
        round.timeoutId = setTimeout(async () => {
            if (activeRound !== round || round.winner) return;

            const original = round.candidates.get('__original__');

            for (const c of round.candidates.values()) {
                if (candidateTerminal(c) || c.started) continue;

                if (c.isOriginal) {
                    c.aborted = true;
                    c.error = '冷暴力超时，已扇死';
                    c.finishedAt = Date.now();
                    round.originalFinished = true;
                    round.suppressOriginalStop = true;
                    try { ctx.stopGeneration?.(); } catch {}
                } else {
                    abortCandidate(c, '冷暴力超时，已扇死');
                }
            }

            // 已经开始吐正文的请求不受这个计时器影响，允许慢慢吐。
            if (original?.started && !candidateTerminal(original)) {
                original.error = '';
            }

            renderFloatingStatus();
            await maybeHandleTotalFailure(round, '全部未开口请求均已冷暴力超时');
        }, settings.coldTimeoutMs);
    }

    async function startRace(generateData, dryRun) {
        if (dryRun || !ensureSettings() || !settings.enabled) return;
        if (!['normal', 'regenerate'].includes(currentGenerationType)) return;

        if (activeRound) abortWholeRound('新一轮生成开始', false);

        const sides = chosenSideProfiles();
        if (!sides.length) return;

        const round = makeRound(generateData);
        activeRound = round;
        renderFloatingStatus();

        const maxTokens = settings.maxTokens > 0
            ? settings.maxTokens
            : Number(ctx.getMaxResponseTokens?.() || ctx.chatCompletionSettings?.openai_max_tokens || 2048);

        startColdTimer(round);

        log(`第 ${round.id} 轮开赛${round.retryNo ? `（第 ${round.retryNo} 次追杀）` : ''}`, sides.map(profileLabel));
        for (const candidate of round.candidates.values()) {
            if (!candidate.isOriginal) {
                runSideCandidate(round, candidate, round.prompt, maxTokens);
            }
        }
    }

    function onGenerationStarted(type) {
        currentGenerationType = type;

        if (retryState.nextGenerationIsRetry) {
            currentGenerationIsAutoRetry = true;
            retryState.nextGenerationIsRetry = false;
            return;
        }

        currentGenerationIsAutoRetry = false;
        // 用户主动开始了新生成：上一条追杀链到此为止。
        resetRetryChain('用户开始新一轮生成');
    }

    function onStreamToken() {
        const round = activeRound;
        if (!round || round.originalFinished) return;

        const original = round.candidates.get('__original__');
        if (!original || original.aborted || original.finished) return;

        // 不把 reasoning token 算作“开口”。只有聊天消息正文真正出现才算。
        const last = ctx?.chat?.[ctx.chat.length - 1];
        if (last && !last.is_user && !last.is_system && meaningful(last.mes)) {
            original.started = true;
            original.text = String(last.mes ?? '');
            renderFloatingStatus();
        }
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
        original.error = original.finished ? '' : '空回';
        original.finishedAt = Date.now();
        round.originalFinished = true;
        renderFloatingStatus();

        if (!original.finished) {
            await maybeHandleTotalFailure(round, '当前酒馆空回');
            return;
        }

        if (!round.winner) {
            await selectWinner(round, original);
        } else if (!round.winner.isOriginal) {
            await reorderOriginalIntoSwipe(round, original.text);
            await flushQueuedSwipes(round);
            await maybeFinalizeRound(round);
        }
    }

    async function onGenerationEnded() {
        const round = activeRound;
        if (!round || round.originalFinished || round.insertingWinner) return;

        // 稍等 MESSAGE_RECEIVED / 流式保存先落地。
        await new Promise(resolve => setTimeout(resolve, 180));
        if (round !== activeRound || round.originalFinished || round.insertingWinner) return;

        const original = round.candidates.get('__original__');
        if (!original || candidateTerminal(original)) return;

        const last = ctx?.chat?.[ctx.chat.length - 1];
        if (last && !last.is_user && !last.is_system && meaningful(last.mes)) {
            // 某些后端结束事件先于 MESSAGE_RECEIVED；主动补一次结算。
            await onMessageReceived();
            return;
        }

        if (round.suppressOriginalStop && round.winner) return;

        original.error = '原请求结束但没有正常回复';
        original.finishedAt = Date.now();
        round.originalFinished = true;
        renderFloatingStatus();

        if (round.winner && !round.winner.isOriginal && !round.mainInstalled) {
            await installSideWinnerImmediately(round, round.winner);
            return;
        }

        await maybeHandleTotalFailure(round, original.error);
    }

    function onGenerationStopped() {
        const round = activeRound;

        if (round?.suppressOriginalStop) return;

        // 不是插件自己 stop 的，就当用户说“都给我闭嘴”。
        if (round) abortWholeRound('用户停止了当前生成', false);
        cancelRetryChain('用户手动停止生成');
    }

    function onChatChanged() {
        abortWholeRound('聊天切换', false);
        cancelRetryChain('聊天切换');
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
        source.on(events.GENERATION_ENDED, onGenerationEnded);
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
            get retry() { return retryState; },
            profiles: getProfiles,
            refresh: renderProfiles,
            abort: () => {
                abortWholeRound('debug abort', true);
                cancelRetryChain('debug abort');
            },
            retryNow: async () => {
                clearRetryTimer();
                retryState.count = Math.max(0, retryState.count);
                retryState.nextGenerationIsRetry = true;
                return await ctx.generate('regenerate');
            },
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
                if (!bound) toast('error', '启动失败：没有拿到 SillyTavern 扩展接口。');
            }
        }, 500);
    }

    // 让倒计时数字自己动，不需要每次状态变化才刷新。
    setInterval(() => {
        if (settings?.enabled && settings?.showFloatingStatus && (activeRound || retryState.timer)) {
            renderFloatingStatus();
        }
    }, 500);
})();