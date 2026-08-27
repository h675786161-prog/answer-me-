(() => {
    'use strict';

    const VERSION = '0.2.2-beta.4';
    const SETTINGS_SELECTORS = ['#extensions_settings2', '#extensions_settings', '#extensions_settings_content'];
    const BRIDGE_FLAG = '__answerMeChatCompletionBridgeV4';
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
        // Module script 下 document.currentScript 可能为空，所以直接从已加载的扩展 script 标签找自己。
        const script = [...document.querySelectorAll('script[src]')]
            .find(el => String(el.src).includes('/answer-me-/bootstrap.js'));
        if (script?.src) return new URL('.', script.src);

        // SillyTavern 第三方扩展固定路径兜底。
        return new URL('/scripts/extensions/third-party/answer-me-/', window.location.origin);
    }

    function refreshDisplayedVersion() {
        const subtitle = document.querySelector('#answer_me_settings .answer-me-subtitle');
        if (subtitle) subtitle.textContent = `你们几个谁他妈先回我 · v${VERSION}`;
        if (window.AnswerMe && typeof window.AnswerMe === 'object') {
            try { window.AnswerMe.version = VERSION; } catch {}
        }
    }

    function markCurrentProfile() {
        const ctx = window.SillyTavern?.getContext?.();
        const currentId = ctx?.extensionSettings?.connectionManager?.selectedProfile;
        const box = document.querySelector('#answer_me_profiles');
        if (!box || !currentId) return;

        for (const row of box.querySelectorAll('.answer-me-profile')) {
            const checkbox = row.querySelector('input[type="checkbox"]');
            const state = row.querySelector('.answer-me-profile-state');
            if (!checkbox || checkbox.value !== currentId) continue;
            if (state) state.textContent = '当前酒馆 · 自动参赛';
            row.dataset.answerMeCurrent = '1';
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
                // OpenAI / Custom Chat Completion 走 CHAT_COMPLETION_SETTINGS_READY，
                // 不会走核心原本监听的 GENERATE_AFTER_DATA。
                // 把酒馆已经组装好的 messages 原样桥接过去，避免重复拼 preset。
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

    function showLoadedIndicator() {
        const panel = document.querySelector('#answer_me_float_panel');
        if (!panel) return;
        if (panel.classList.contains('hidden')) {
            const meta = panel.querySelector('#answer_me_float_meta');
            const body = panel.querySelector('#answer_me_float_body');
            if (meta) meta.textContent = '已加载 · 赛马未启用';
            if (body) body.innerHTML = '<div class="answer-me-idle">💢 Answer Me 已就位 · 去扩展设置开启赛马</div>';
            panel.classList.remove('hidden');
            panel.dataset.answerMeBootIndicator = '1';
        }
    }

    async function loadCore() {
        await waitUntilReady();

        const coreUrl = new URL('index-v2.js', extensionBaseUrl());
        coreUrl.searchParams.set('answer_me_v', VERSION);

        const script = document.createElement('script');
        script.src = coreUrl.href;
        script.async = false;
        script.dataset.answerMeCore = VERSION;

        script.addEventListener('load', () => {
            console.log(`[💢 Answer Me] bootstrap ${VERSION}: core loaded`);
            setTimeout(() => {
                refreshDisplayedVersion();
                bindChatCompletionBridge();
                markCurrentProfile();
                showLoadedIndicator();

                const box = document.querySelector('#answer_me_profiles');
                if (box) {
                    new MutationObserver(() => markCurrentProfile())
                        .observe(box, { childList: true, subtree: true });
                }
            }, 100);
        });

        script.addEventListener('error', (event) => {
            console.error(`[💢 Answer Me] bootstrap ${VERSION}: core load failed`, event);
            window.toastr?.error?.('核心脚本加载失败，请更新扩展后刷新页面。', '💢 Answer Me');
        });

        document.head.appendChild(script);
    }

    loadCore().catch(error => {
        console.error(`[💢 Answer Me] bootstrap ${VERSION}: startup failed`, error);
        window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
    });
})();
