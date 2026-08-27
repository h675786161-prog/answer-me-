(() => {
    'use strict';

    const VERSION = '0.3.0-beta.5';
    const SETTINGS_SELECTORS = ['#extensions_settings2', '#extensions_settings', '#extensions_settings_content'];
    const BRIDGE_FLAG = '__answerMeChatCompletionBridgeV5';
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function findSettingsHost() {
        for (const selector of SETTINGS_SELECTORS) {
            const node = document.querySelector(selector);
            if (node) return node;
        }
        return null;
    }

    async function waitUntilReady() {
        while (!window.SillyTavern?.getContext?.()) {
            await sleep(200);
        }
        while (!findSettingsHost()) {
            await sleep(250);
        }
    }

    function extensionBaseUrl() {
        const script = [...document.querySelectorAll('script[src]')]
            .find(el => String(el.src).includes('/answer-me-/bootstrap.js'));
        if (script?.src) return new URL('.', script.src);
        return new URL('/scripts/extensions/third-party/answer-me-/', window.location.origin);
    }

    function refreshDisplayedVersion() {
        const subtitle = document.querySelector('#answer_me_settings .answer-me-subtitle');
        if (subtitle) subtitle.textContent = `你们几个谁他妈先回我 · v${VERSION}`;
        if (window.AnswerMe && typeof window.AnswerMe === 'object') {
            try { window.AnswerMe.version = VERSION; } catch {}
        }
    }

    function bindChatCompletionBridge() {
        const ctx = window.SillyTavern?.getContext?.();
        const source = ctx?.eventSource;
        const events = ctx?.eventTypes || ctx?.event_types;
        if (!source || !events || window[BRIDGE_FLAG]) return !!window[BRIDGE_FLAG];

        const chatReadyEvent = events.CHAT_COMPLETION_SETTINGS_READY;
        const afterDataEvent = events.GENERATE_AFTER_DATA;
        if (!chatReadyEvent || !afterDataEvent) return false;

        source.on(chatReadyEvent, async (generateData) => {
            try {
                const prompt = Array.isArray(generateData?.messages)
                    ? structuredClone(generateData.messages)
                    : (generateData?.prompt ?? '');
                await source.emit(afterDataEvent, { prompt }, false);
            } catch (error) {
                console.error('[💢 Answer Me] Chat Completion bridge failed', error);
            }
        });

        window[BRIDGE_FLAG] = true;
        console.log(`[💢 Answer Me] ${VERSION}: Chat Completion bridge bound`);
        return true;
    }

    function loadScript(url, marker) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url.href;
            script.async = false;
            script.dataset.answerMePart = marker;
            script.addEventListener('load', () => resolve(script), { once: true });
            script.addEventListener('error', reject, { once: true });
            document.head.appendChild(script);
        });
    }

    async function loadAll() {
        await waitUntilReady();
        const base = extensionBaseUrl();

        const coreUrl = new URL('index-v2.js', base);
        coreUrl.searchParams.set('answer_me_v', VERSION);
        await loadScript(coreUrl, 'core');

        refreshDisplayedVersion();
        bindChatCompletionBridge();

        const uxUrl = new URL('ux-v5.js', base);
        uxUrl.searchParams.set('answer_me_v', VERSION);
        await loadScript(uxUrl, 'ux');

        refreshDisplayedVersion();
        console.log(`[💢 Answer Me] bootstrap ${VERSION}: core + UX loaded`);
    }

    loadAll().catch(error => {
        console.error(`[💢 Answer Me] bootstrap ${VERSION}: startup failed`, error);
        window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
    });
})();