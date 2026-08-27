(() => {
    'use strict';

    const VERSION = '0.2.9-beta.11';
    const DEFAULT_MIN = 6;
    const CHECK_MS = 120;
    const WRAP_FLAG = '__answerMeQualityWrappedV11';
    const EVENT_FLAG = '__answerMeQualityEventsV11';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function ctx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function settings() {
        const c = ctx();
        if (!c) return null;
        c.extensionSettings.answerMe ??= {};
        const s = c.extensionSettings.answerMe;
        if (!Number.isFinite(Number(s.minMeaningfulChars))) s.minMeaningfulChars = DEFAULT_MIN;
        s.minMeaningfulChars = Math.max(1, Math.min(30, Number(s.minMeaningfulChars)));
        return s;
    }

    function saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch {}
    }

    function normalize(text) {
        let raw = String(text ?? '')
            .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
            .replace(/\u00A0/g, ' ')
            .trim();

        if (!raw) return '';

        // 哭包/多数预设若显式给了 <content>，正文只认 content 里面的东西。
        const contentMatches = [...raw.matchAll(/<content\b[^>]*>([\s\S]*?)<\/content>/gi)];
        if (contentMatches.length) {
            raw = contentMatches.map(m => m[1]).join('\n');
        }

        // reasoning / 思维链绝不算正文。
        raw = raw
            .replace(/<(?:think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|analysis)>/gi, ' ')
            // details 通常是状态栏、选项、小剧场等组件；只用于“是否空回”的判断，不改真正保存的文本。
            .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, ' ')
            .replace(/```(?:html|xml|text|txt|markdown|md)?/gi, ' ')
            .replace(/```/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&(?:nbsp|ensp|emsp);/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return raw;
    }

    function semanticCount(text) {
        const normalized = normalize(text);
        if (!normalized) return 0;
        try {
            return (normalized.match(/[\p{L}\p{N}]/gu) || []).length;
        } catch {
            return (normalized.match(/[A-Za-z0-9\u3400-\u9FFF]/g) || []).length;
        }
    }

    function isKnownGarbage(text) {
        const normalized = normalize(text).toLowerCase().replace(/\s+/g, '');
        return [
            '', '...', '……', '…', '.', '..', '-', '--', 'null', 'undefined', 'none',
            '[done]', 'done', 'error', 'empty', '空回', '无回复', '暂无回复', 'n/a', 'na',
        ].includes(normalized);
    }

    function isValidReply(text) {
        if (isKnownGarbage(text)) return false;
        const min = Math.max(1, Number(settings()?.minMeaningfulChars || DEFAULT_MIN));
        return semanticCount(text) >= min;
    }

    function reason(text) {
        const n = semanticCount(text);
        const min = Math.max(1, Number(settings()?.minMeaningfulChars || DEFAULT_MIN));
        return n <= 0 ? '空回：没有有效正文' : `空回：有效正文不足（${n}/${min}）`;
    }

    function installSetting() {
        const grid = document.querySelector('#answer_me_settings .answer-me-grid');
        if (!grid || document.querySelector('#answer_me_min_meaningful')) return false;
        const s = settings();
        if (!s) return false;

        const label = document.createElement('label');
        label.innerHTML = `
            <span>最少有效正文字符</span>
            <input id="answer_me_min_meaningful" type="number" min="1" max="30" step="1">
        `;
        grid.appendChild(label);

        const input = label.querySelector('input');
        input.value = String(s.minMeaningfulChars);
        input.addEventListener('change', () => {
            s.minMeaningfulChars = Math.max(1, Math.min(30, Number(input.value || DEFAULT_MIN)));
            input.value = String(s.minMeaningfulChars);
            saveSettings();
        });
        return true;
    }

    function wrapConnectionService() {
        const c = ctx();
        const service = c?.ConnectionManagerRequestService;
        if (!service?.sendRequest || service[WRAP_FLAG]) return !!service?.[WRAP_FLAG];

        const original = service.sendRequest.bind(service);
        service.sendRequest = async function(...args) {
            const result = await original(...args);
            const custom = args[3] || {};
            if (!custom?.stream || typeof result !== 'function') return result;

            return function wrappedFactory() {
                const iterator = result();
                return (async function*() {
                    let lastText = '';
                    for await (const chunk of iterator) {
                        lastText = String(chunk?.text ?? lastText ?? '');
                        yield chunk;
                    }
                    if (!isValidReply(lastText)) {
                        throw new Error(reason(lastText));
                    }
                })();
            };
        };

        service[WRAP_FLAG] = true;
        console.log(`[💢 Answer Me] quality guard ${VERSION}: ConnectionManager stream wrapped`);
        return true;
    }

    function bindOriginalFinalGuard() {
        const c = ctx();
        const source = c?.eventSource;
        const events = c?.eventTypes || c?.event_types;
        if (!source || !events || window[EVENT_FLAG]) return !!window[EVENT_FLAG];

        const received = events.MESSAGE_RECEIVED;
        if (received) {
            source.on(received, () => {
                try {
                    const round = window.AnswerMe?.round;
                    if (!round || round.insertingWinner) return;
                    const last = c.chat?.[c.chat.length - 1];
                    if (!last || last.is_user || last.is_system) return;
                    const text = String(last.mes ?? '');
                    if (isValidReply(text)) return;

                    last.extra = {
                        ...(last.extra || {}),
                        answer_me_quality_rejected: true,
                        answer_me_quality_reason: reason(text),
                    };
                    last.mes = '';
                    const original = round.candidates?.get?.('__original__');
                    if (original) original.text = '';
                    console.warn('[💢 Answer Me] 当前酒馆回复被判为空回：', reason(text));
                } catch (error) {
                    console.warn('[💢 Answer Me] original quality guard failed', error);
                }
            });
        }

        window[EVENT_FLAG] = true;
        return true;
    }

    // 防止“已经吐了几个垃圾字符 + SSE 又不关门”被 soft-settle 当成赢家。
    // 不改 started，只临时把 candidate.text 清空；如果后续真继续吐，核心下一 chunk 会恢复累计正文。
    function scrubInvalidLiveCandidates() {
        const round = window.AnswerMe?.round;
        if (!round?.candidates?.values) return;
        for (const candidate of round.candidates.values()) {
            if (!candidate || candidate.finished || candidate.aborted || candidate.error || candidate.winner) continue;
            if (candidate.isOriginal) continue;
            const text = String(candidate.text ?? '');
            if (!text || isValidReply(text)) continue;
            candidate._answerMeRejectedPreview = text;
            candidate.text = '';
        }
    }

    window.AnswerMeQuality = {
        version: VERSION,
        normalize,
        semanticCount,
        isValidReply,
        reason,
    };

    async function boot() {
        for (let i = 0; i < 80; i++) {
            if (ctx()) break;
            await sleep(100);
        }
        wrapConnectionService();
        bindOriginalFinalGuard();

        const timer = setInterval(() => {
            try {
                installSetting();
                wrapConnectionService();
                bindOriginalFinalGuard();
                scrubInvalidLiveCandidates();
            } catch (error) {
                console.warn('[💢 Answer Me] quality guard sweep failed', error);
            }
        }, CHECK_MS);

        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
        console.log(`[💢 Answer Me] quality guard ${VERSION} ready · 空回不能拿冠军`);
    }

    boot().catch(error => console.error('[💢 Answer Me] quality guard startup failed', error));
})();
