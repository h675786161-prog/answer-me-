(() => {
    'use strict';

    const VERSION = '0.2.5-beta.7';
    const CHECK_MS = 1000;
    const DEFAULT_STALL_MS = 30000;
    const RETRY_DELAYS = [2000, 5000, 12000, 25000];

    let roundId = null;
    let progress = new Map();
    let retryTimer = null;
    let stallRetryCount = 0;
    let nextRoundOwnedByStallRetry = false;
    let busy = false;

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
        if (!Number.isFinite(Number(s.stallTimeoutMs))) s.stallTimeoutMs = DEFAULT_STALL_MS;
        s.stallTimeoutMs = Math.max(10000, Math.min(120000, Number(s.stallTimeoutMs)));
        return s;
    }

    function saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch {}
    }

    function toast(type, message, title = '💢 Answer Me') {
        try {
            window.toastr?.[type]?.(message, title, {
                preventDuplicates: true,
                timeOut: type === 'error' ? 7000 : 4200,
            });
        } catch {}
    }

    function installSetting() {
        const grid = document.querySelector('#answer_me_settings .answer-me-grid');
        if (!grid || document.querySelector('#answer_me_stall_timeout')) return false;

        const s = settings();
        if (!s) return false;

        const label = document.createElement('label');
        label.innerHTML = `
            <span>已开口失联上限（秒）</span>
            <input id="answer_me_stall_timeout" type="number" min="10" max="120" step="5">
        `;
        grid.appendChild(label);

        const input = label.querySelector('input');
        input.value = String(Math.round(s.stallTimeoutMs / 1000));
        input.addEventListener('change', () => {
            s.stallTimeoutMs = Math.max(10000, Math.min(120000, Number(input.value || 30) * 1000));
            input.value = String(Math.round(s.stallTimeoutMs / 1000));
            saveSettings();
        });
        return true;
    }

    function terminal(c) {
        return !!(c?.finished || c?.aborted || c?.error);
    }

    function allTerminal(round) {
        try { return [...round.candidates.values()].every(terminal); } catch { return false; }
    }

    function candidateName(c) {
        if (!c) return '未知站';
        if (c.isOriginal) return '当前酒馆请求';
        return c.name || c.profile?.name || '未命名站';
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

    async function appendSwipe(text, sourceName) {
        const c = ctx();
        if (!c?.chat?.length || !String(text || '').trim()) return;
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
            },
        });

        await c.saveChat?.();
        try { await c.reloadCurrentChat?.(); } catch {}
    }

    async function flushQueuedSwipes(round) {
        if (!round?.mainInstalled || !Array.isArray(round.queuedSwipes)) return;
        const queued = round.queuedSwipes.splice(0);
        for (const item of queued) {
            if (item?.text) await appendSwipe(item.text, item.name || '备选站');
        }
    }

    async function promoteSideWinner(round) {
        const c = ctx();
        const winner = round?.winner;
        if (!c || !winner || winner.isOriginal || round.mainInstalled) return;

        round.insertingWinner = true;
        try {
            const last = c.chat?.[c.chat.length - 1];
            if (last && !last.is_user && !last.is_system) {
                try { await c.deleteLastMessage?.(); } catch {}
            }
            await c.saveReply?.({ type: 'normal', getMessage: winner.text });
            await c.saveChat?.();
            round.mainInstalled = true;
            await flushQueuedSwipes(round);
        } finally {
            round.insertingWinner = false;
        }
    }

    async function killStalled(round, candidate) {
        const reason = '吐一半装死 · 已扇死';
        const now = Date.now();
        if (!candidate || terminal(candidate)) return;

        candidate.aborted = true;
        candidate.error = reason;
        candidate.finishedAt = now;

        if (candidate.isOriginal) {
            round.originalFinished = true;
            round.suppressOriginalStop = true;
            try { ctx()?.stopGeneration?.(); } catch {}

            if (round.winner && !round.winner.isOriginal && !round.mainInstalled) {
                await new Promise(resolve => setTimeout(resolve, 80));
                await promoteSideWinner(round);
            }
        } else {
            try { candidate.controller?.abort(reason); } catch {}
        }

        toast('warning', `${candidateName(candidate)} 连续没有新正文，绿灯保护撤销。`, '💥 吐一半装死，已扇死');
    }

    function clearRetryTimer() {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
    }

    function scheduleStallRetry(reason) {
        const a = api();
        const s = settings();
        if (!a || !s?.autoRetryEnabled) return;

        const max = Math.max(0, Number(s.maxRetryRounds ?? 4));
        if (stallRetryCount >= max) {
            toast('error', `已经因“吐一半装死”追杀 ${max} 轮，今晚先判它死刑。`, '💢 Answer Me');
            return;
        }
        if (retryTimer) return;

        const delay = RETRY_DELAYS[Math.min(stallRetryCount, RETRY_DELAYS.length - 1)];
        const no = stallRetryCount + 1;
        toast('warning', `${reason}。${delay / 1000}s 后第 ${no}/${max} 次整轮追杀。`, '💢 你他妈倒是回我啊');

        retryTimer = setTimeout(async () => {
            retryTimer = null;
            stallRetryCount = no;
            nextRoundOwnedByStallRetry = true;
            try {
                await api()?.retryNow?.();
            } catch (error) {
                console.warn('[💢 Answer Me] stall retry failed', error);
                scheduleStallRetry('重试请求自己也装死了');
            }
        }, delay);
    }

    async function settleIfDone(round) {
        if (!round || !allTerminal(round)) return;

        if (round.winner) {
            if (!round.winner.isOriginal && !round.mainInstalled) {
                await promoteSideWinner(round);
            }
            await flushQueuedSwipes(round);
            api()?.abort?.();
            return;
        }

        api()?.abort?.();
        scheduleStallRetry('全员都没能完整说完');
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

            if (round.id !== roundId) {
                roundId = round.id;
                progress = new Map();
                if (nextRoundOwnedByStallRetry) {
                    nextRoundOwnedByStallRetry = false;
                } else {
                    stallRetryCount = 0;
                    clearRetryTimer();
                }
            }

            if (round.winner) {
                stallRetryCount = 0;
                clearRetryTimer();
            }

            const now = Date.now();
            const stallMs = Math.max(10000, Number(s.stallTimeoutMs || DEFAULT_STALL_MS));
            let killed = false;

            for (const candidate of round.candidates.values()) {
                if (!candidate?.started || terminal(candidate)) continue;
                const changedAt = markProgress(candidate, now);
                if (now - changedAt < stallMs) continue;

                await killStalled(round, candidate);
                killed = true;
            }

            if (killed) await settleIfDone(round);
        } finally {
            busy = false;
        }
    }

    const timer = setInterval(() => {
        sweep().catch(error => console.warn('[💢 Answer Me] stall guard sweep failed', error));
    }, CHECK_MS);

    window.addEventListener('beforeunload', () => {
        clearInterval(timer);
        clearRetryTimer();
    }, { once: true });

    console.log(`[💢 Answer Me] stall guard ${VERSION} ready · 默认 30s 无新正文即扇死`);
})();
