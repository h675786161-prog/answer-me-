(() => {
    'use strict';

    const VERSION = '0.2.7-beta.9';
    const CHECK_MS = 500;
    const DEFAULT_SOFT_MS = 12000;

    let seenRoundId = null;
    let progress = new Map();
    let busy = false;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function ctx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function api() {
        return window.AnswerMe ?? null;
    }

    function settings() {
        const c = ctx();
        if (!c) return null;
        c.extensionSettings.answerMe ??= {};
        const s = c.extensionSettings.answerMe;
        if (!Number.isFinite(Number(s.softSettleMs))) s.softSettleMs = DEFAULT_SOFT_MS;
        s.softSettleMs = Math.max(5000, Math.min(60000, Number(s.softSettleMs)));
        return s;
    }

    function saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch {}
    }

    function toast(type, message, title = '💢 Answer Me') {
        try {
            window.toastr?.[type]?.(message, title, {
                preventDuplicates: true,
                timeOut: type === 'error' ? 7000 : 4500,
            });
        } catch {}
    }

    function terminal(candidate) {
        return !!(candidate?.finished || candidate?.aborted || candidate?.error);
    }

    function meaningful(text) {
        return String(text ?? '').trim().length > 0;
    }

    function candidateName(candidate) {
        if (!candidate) return '未知站';
        if (candidate.isOriginal) return '当前酒馆请求';
        return candidate.name || candidate.profile?.name || '未命名站';
    }

    function latestAssistantText(c) {
        const last = c?.chat?.[c.chat.length - 1];
        if (!last || last.is_user || last.is_system) return '';
        return String(last.mes ?? '');
    }

    function syncOriginal(round) {
        const c = ctx();
        const original = round?.candidates?.get?.('__original__');
        if (!c || !original || terminal(original)) return;
        const text = latestAssistantText(c);
        if (!meaningful(text)) return;
        original.started = true;
        original.text = text;
    }

    function markProgress(candidate, now) {
        const text = String(candidate?.text ?? '');
        const prev = progress.get(candidate.id);
        if (!prev || prev.text !== text) {
            progress.set(candidate.id, { text, changedAt: now });
            return now;
        }
        return prev.changedAt;
    }

    function installSetting() {
        const grid = document.querySelector('#answer_me_settings .answer-me-grid');
        if (!grid || document.querySelector('#answer_me_soft_settle')) return false;
        const s = settings();
        if (!s) return false;

        const label = document.createElement('label');
        label.innerHTML = `
            <span>已开口无新正文判定（秒）</span>
            <input id="answer_me_soft_settle" type="number" min="5" max="60" step="1">
        `;
        grid.appendChild(label);

        const input = label.querySelector('input');
        input.value = String(Math.round(s.softSettleMs / 1000));
        input.addEventListener('change', () => {
            s.softSettleMs = Math.max(5000, Math.min(60000, Number(input.value || 12) * 1000));
            input.value = String(Math.round(s.softSettleMs / 1000));
            saveSettings();
        });
        return true;
    }

    async function appendSwipe(text, sourceName) {
        const c = ctx();
        text = String(text || '').trim();
        if (!c?.chat?.length || !text) return;
        const message = c.chat[c.chat.length - 1];
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
                answer_me_soft_settled: true,
            },
        });
    }

    async function flushQueuedSwipes(round) {
        if (!round?.mainInstalled || !Array.isArray(round.queuedSwipes)) return;
        const queued = round.queuedSwipes.splice(0);
        for (const item of queued) {
            if (item?.text) await appendSwipe(item.text, item.name || '备选站');
        }
        try { await ctx()?.saveChat?.(); } catch {}
    }

    function queueSwipe(round, candidate) {
        if (!round || !candidate || !meaningful(candidate.text)) return;
        round.queuedSwipes = Array.isArray(round.queuedSwipes) ? round.queuedSwipes : [];
        if (!round.queuedSwipes.some(x => x.text === candidate.text)) {
            round.queuedSwipes.push({ text: candidate.text, name: candidateName(candidate) });
        }
    }

    function killZeroTokenAfterWinner(round) {
        if (!round?.winner) return;
        for (const candidate of round.candidates.values()) {
            if (candidate === round.winner || terminal(candidate) || candidate.started || meaningful(candidate.text)) continue;
            candidate.aborted = true;
            candidate.error = '零正文 token · 冷暴力，已扇死';
            candidate.finishedAt = Date.now();
            try { candidate.controller?.abort?.('Answer Me: cold after winner'); } catch {}
        }
    }

    async function installSideWinnerImmediately(round, candidate) {
        const c = ctx();
        if (!c || !round || round.mainInstalled || !meaningful(candidate?.text)) return;

        round.mainInstalled = true;
        round.suppressOriginalStop = true;
        try { c.stopGeneration?.(); } catch {}
        await sleep(120);

        const last = c.chat?.[c.chat.length - 1];
        if (last && !last.is_user && !last.is_system) {
            try { await c.deleteLastMessage?.(); } catch {}
        }

        round.insertingWinner = true;
        try {
            await c.saveReply?.({ type: 'normal', getMessage: candidate.text });
            await c.saveChat?.();
        } finally {
            round.insertingWinner = false;
        }

        await flushQueuedSwipes(round);
    }

    function chooseSoftWinner(round, candidate) {
        if (round.winner || !meaningful(candidate?.text)) return false;
        candidate.winner = true;
        candidate.finished = true;
        candidate.error = '';
        candidate.finishedAt ||= Date.now();
        candidate.softSettled = true;
        candidate.softSettledAt = Date.now();
        round.winner = candidate;
        killZeroTokenAfterWinner(round);
        toast('success', `${candidateName(candidate)} 正文已停止增长，按“已说完但没挂电话”软结算。`, '✂️ Answer Me · 强制挂电话');
        return true;
    }

    async function softSettleSide(round, candidate) {
        if (!round || !candidate || terminal(candidate) || !meaningful(candidate.text)) return;

        candidate.softSettled = true;
        candidate.softSettledAt = Date.now();
        candidate.finished = true;
        candidate.error = '';
        candidate.finishedAt = Date.now();

        if (!round.winner) {
            chooseSoftWinner(round, candidate);
            const original = round.candidates.get('__original__');
            if (!original?.started && !meaningful(original?.text)) {
                await installSideWinnerImmediately(round, candidate);
            }
            return;
        }

        if (round.winner !== candidate) {
            queueSwipe(round, candidate);
            candidate.softQueued = true;
            try { candidate.controller?.abort?.('Answer Me: soft settled as swipe'); } catch {}
        }
    }

    async function softStopOriginal(round, original) {
        const c = ctx();
        if (!c || !round || !original || terminal(original)) return;
        const text = latestAssistantText(c) || String(original.text || '');
        if (!meaningful(text)) return;

        original.started = true;
        original.text = text;
        original.softSettled = true;
        original.softSettledAt = Date.now();

        round.suppressOriginalStop = true;
        toast('warning', '当前酒馆正文已经停止增长，主动结束悬空流并保存现有正文。', '✂️ Answer Me · 强制挂电话');
        try { c.stopGeneration?.(); } catch {}
    }

    function allSettledEnough(round) {
        if (!round?.winner) return false;
        for (const candidate of round.candidates.values()) {
            if (candidate === round.winner) continue;
            if (terminal(candidate) || candidate.softQueued) continue;
            return false;
        }
        return true;
    }

    async function maybeCloseRound(round) {
        const a = api();
        if (!a || a.round !== round || !round?.winner || !round.mainInstalled) return;
        if (!allSettledEnough(round)) return;

        await flushQueuedSwipes(round);
        try { await ctx()?.saveChat?.(); } catch {}

        for (const candidate of round.candidates.values()) {
            if (!candidate?.isOriginal) {
                try { candidate.controller?.abort?.('Answer Me: round safely persisted'); } catch {}
            }
        }

        await sleep(120);
        if (api()?.round === round) api()?.abort?.();
    }

    async function sweep() {
        if (busy) return;
        busy = true;
        try {
            installSetting();
            const a = api();
            const s = settings();
            const round = a?.round;
            if (!a || !s || !round) return;

            if (seenRoundId !== round.id) {
                seenRoundId = round.id;
                progress = new Map();
            }

            syncOriginal(round);
            const now = Date.now();
            const softMs = Math.max(5000, Number(s.softSettleMs || DEFAULT_SOFT_MS));

            if (round.winner) killZeroTokenAfterWinner(round);

            for (const candidate of round.candidates.values()) {
                if (!candidate || terminal(candidate)) continue;
                const text = String(candidate.text ?? '');
                if (!meaningful(text)) continue;

                candidate.started = true;
                const changedAt = markProgress(candidate, now);
                if (now - changedAt < softMs) continue;

                if (candidate.isOriginal) {
                    await softStopOriginal(round, candidate);
                } else {
                    await softSettleSide(round, candidate);
                }
            }

            await maybeCloseRound(round);
        } catch (error) {
            console.warn('[💢 Answer Me] soft settle sweep failed', error);
        } finally {
            busy = false;
        }
    }

    const timer = setInterval(() => { void sweep(); }, CHECK_MS);
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });

    console.log(`[💢 Answer Me] soft settle ${VERSION} ready · ${DEFAULT_SOFT_MS / 1000}s 无新正文即“强制挂电话”`);
})();
