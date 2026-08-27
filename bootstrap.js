(() => {
    'use strict';

    const VERSION = '0.2.1-beta.3';
    const capturedSrc = document.currentScript?.src || '';
    const SETTINGS_SELECTORS = ['#extensions_settings2', '#extensions_settings', '#extensions_settings_content'];

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function findSettingsHost() {
        for (const selector of SETTINGS_SELECTORS) {
            const node = document.querySelector(selector);
            if (node) return node;
        }
        return null;
    }

    async function waitUntilReady() {
        // SillyTavern 的第三方扩展脚本有时会比设置区 DOM 更早执行。
        // 旧版 Answer Me 在这个时间窗里会成功绑定事件，但 mountSettings() 直接错过，
        // 结果就是：扩展明明装上了，右下角面板和设置栏都像没出生一样。
        while (!window.SillyTavern?.getContext?.()) {
            await sleep(200);
        }

        while (!findSettingsHost()) {
            await sleep(250);
        }
    }

    function showLoadedIndicator() {
        const panel = document.querySelector('#answer_me_float_panel');
        if (!panel) return;

        // 主脚本默认“启用赛马=false”，所以它会把面板隐藏。
        // beta.3 首次加载时仍显示一个明确的待机提示，避免用户误以为扩展没加载。
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

        const baseUrl = capturedSrc ? new URL('.', capturedSrc) : new URL('./', window.location.href);
        const coreUrl = new URL('index-v2.js', baseUrl);
        coreUrl.searchParams.set('answer_me_v', VERSION);

        const script = document.createElement('script');
        script.src = coreUrl.href;
        script.async = false;
        script.dataset.answerMeCore = VERSION;

        script.addEventListener('load', () => {
            console.log(`[💢 Answer Me] bootstrap ${VERSION}: core loaded`);
            // 给主脚本 mountSettings / ensureFloatingPanel 一点时间。
            setTimeout(showLoadedIndicator, 100);
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
