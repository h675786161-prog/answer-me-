(() => {
    'use strict';

    const VERSION = '0.2.6-beta.8';
    const PREFIX = 'answer-me:checkpoint:';
    const MAX_AGE_MS = 6 * 60 * 60 * 1000;
    const SNAPSHOT_MS = 700;

    let lastSerialized = '';
    let restoring = false;

    function ctx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function api() {
        return window.AnswerMe ?? null;
    }

    function getChatId(c) {
        try {
            return c?.getCurrentChatId?.() ?? c?.chatId ?? c?.characterId ?? 'unknown';
        } catch {
            return c?.chatId ?? c?.characterId ?? 'unknown';
        }
    }

    function key(c) {
        return `${PREFIX}${encodeURIComponent(String(getChatId(c)))}`;
    }

    function lastUser(chat) {
        if (!Array.isArray(chat)) return null;
        for (let i = chat.length - 1; i >= 0; i--) {
            const m = chat[i];
            if (m?.is_user && !m?.is_system) return { index: i, text: String(m.mes ?? '') };
        }
        return null;
    }

    function hasAssistantAfter(chat, index) {
        if (!Array.isArray(chat)) return false;
        for (let i = index + 1; i < chat.length; i++) {
            const m = chat[i];
            if (m && !m.is_user && !m.is_system && String(m.mes ?? '').trim()) return true;
        }
        return false;
    }

    function candidateSnapshot(candidate) {
        return {
            id: candidate?.id ?? '',
            name: candidate?.isOriginal ? '当前酒馆请求' : (candidate?.name || candidate?.profile?.name || '未命名站'),
            isOriginal: !!candidate?.isOriginal,
            started: !!candidate?.started,
            finished: !!candidate?.finished,
            aborted: !!candidate?.aborted,
            error: String(candidate?.error || ''),
            winner: !!candidate?.winner,
            text: String(candidate?.text ?? ''),
            finishedAt: Number(candidate?.finishedAt || 0),
        };
    }

    function buildSnapshot() {
        const c = ctx();
        const round = api()?.round;
        if (!c || !round) return null;

        const anchor = lastUser(c.chat);
        if (!anchor) return null;

        const candidates = [...round.candidates.values()].map(candidateSnapshot);
        if (!candidates.some(x => x.text.trim())) return null;

        return {
            version: VERSION,
            savedAt: Date.now(),
            chatId: String(getChatId(c)),
            anchorIndex: anchor.index,
            anchorText: anchor.text,
            roundId: round.id,
            retryNo: round.retryNo || 0,
            winnerId: round.winner?.id ?? null,
            mainInstalled: !!round.mainInstalled,
            candidates,
        };
    }

    function saveCheckpoint() {
        try {
            const c = ctx();
            const snap = buildSnapshot();
            if (!c || !snap) return;

            const serialized = JSON.stringify(snap);
            if (serialized === lastSerialized) return;
            localStorage.setItem(key(c), serialized);
            lastSerialized = serialized;
        } catch (error) {
            console.warn('[💢 Answer Me] checkpoint save failed', error);
        }
    }

    function loadCheckpoint(c) {
        try {
            const raw = localStorage.getItem(key(c));
            if (!raw) return null;
            const snap = JSON.parse(raw);
            if (!snap?.savedAt || Date.now() - snap.savedAt > MAX_AGE_MS) {
                localStorage.removeItem(key(c));
                return null;
            }
            return snap;
        } catch {
            return null;
        }
    }

    function clearCheckpoint(c) {
        try {
            localStorage.removeItem(key(c));
            lastSerialized = '';
        } catch {}
    }

    function sameAnchor(c, snap) {
        if (!Array.isArray(c?.chat) || !snap) return false;
        const exact = c.chat[snap.anchorIndex];
        if (exact?.is_user && String(exact.mes ?? '') === String(snap.anchorText ?? '')) return true;
        const current = lastUser(c.chat);
        return !!current && current.text === String(snap.anchorText ?? '');
    }

    function chooseBest(snap) {
        const list = (snap?.candidates || []).filter(x => String(x?.text || '').trim());
        if (!list.length) return null;

        return list.find(x => x.winner)
            || list.find(x => x.finished && !x.aborted && !x.error)
            || [...list].sort((a, b) => String(b.text).length - String(a.text).length)[0];
    }

    async function appendSwipe(c, text, sourceName) {
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
                answer_me_recovered: true,
            },
        });
    }

    async function restoreIfNeeded() {
        if (restoring) return;
        const c = ctx();
        if (!c?.chat?.length) return;

        const snap = loadCheckpoint(c);
        if (!snap || !sameAnchor(c, snap)) return;

        // 正常完成且已经被 SillyTavern 保存时，不重复插入。
        if (hasAssistantAfter(c.chat, snap.anchorIndex)) {
            if (!api()?.round) clearCheckpoint(c);
            return;
        }

        const best = chooseBest(snap);
        if (!best?.text?.trim()) return;

        restoring = true;
        try {
            await c.saveReply?.({ type: 'normal', getMessage: best.text });

            const message = c.chat?.[c.chat.length - 1];
            if (message && !message.is_user && !message.is_system) {
                message.extra = {
                    ...(message.extra || {}),
                    answer_me_source: best.name,
                    answer_me_recovered: true,
                    answer_me_recovered_partial: !best.finished,
                };
            }

            // 已经完整返回的其他站顺手保成 Swipe；未完成残稿不污染 Swipe。
            for (const item of snap.candidates || []) {
                if (item === best || item.id === best.id) continue;
                if (!item.finished || item.aborted || item.error || !String(item.text || '').trim()) continue;
                await appendSwipe(c, item.text, item.name || '恢复的备选站');
            }

            await c.saveChat?.();
            clearCheckpoint(c);

            const kind = best.finished ? '完整回复' : '刷新前残稿';
            window.toastr?.warning?.(
                `${best.name} 的${kind}已经从本地检查点捞回来了。${best.finished ? '' : '这条可能停在半句，但不会再凭空消失。'}`,
                '🛟 Answer Me · 刷新捞尸成功',
                { timeOut: 7000 },
            );
        } catch (error) {
            console.warn('[💢 Answer Me] checkpoint restore failed', error);
        } finally {
            restoring = false;
        }
    }

    async function waitAndRestore() {
        for (let i = 0; i < 80; i++) {
            if (ctx()?.chat && api()) break;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        await new Promise(resolve => setTimeout(resolve, 600));
        await restoreIfNeeded();
    }

    const timer = setInterval(() => {
        const c = ctx();
        const round = api()?.round;

        if (round) {
            saveCheckpoint();
            return;
        }

        // 一轮正常结束并已经落盘后，旧检查点就没有继续保留的必要。
        const snap = c ? loadCheckpoint(c) : null;
        if (c && snap && sameAnchor(c, snap) && hasAssistantAfter(c.chat, snap.anchorIndex)) {
            clearCheckpoint(c);
        }
    }, SNAPSHOT_MS);

    window.addEventListener('beforeunload', saveCheckpoint);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveCheckpoint();
    });

    window.AnswerMeRecovery = {
        version: VERSION,
        save: saveCheckpoint,
        restore: restoreIfNeeded,
        inspect: () => {
            const c = ctx();
            return c ? loadCheckpoint(c) : null;
        },
        clear: () => {
            const c = ctx();
            if (c) clearCheckpoint(c);
        },
    };

    waitAndRestore().catch(error => console.warn('[💢 Answer Me] recovery startup failed', error));
    console.log(`[💢 Answer Me] recovery ${VERSION} ready · 刷新前自动保存赛马回复`);
})();
