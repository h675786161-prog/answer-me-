(() => {
    'use strict';

    const VERSION = '0.2.5-beta.7';
    const SETTINGS_SELECTORS = ['#extensions_settings2', '#extensions_settings', '#extensions_settings_content'];
    const BRIDGE_FLAG = '__answerMeChatCompletionBridgeV4';
    const COLLAPSE_KEY = 'answerMe.settingsCollapsed';
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function findSettingsHost() {
        for (const selector of SETTINGS_SELECTORS) {
            const node = document.querySelector(selector);
            if (node) return node;
        }
        return null;
    }

    async function waitUntilReady() {
        while (!window.SillyTavern?.getContext?.()) await sleep(200);
        while (!findSettingsHost()) await sleep(250);
    }

    function extensionBaseUrl() {
        const script = [...document.querySelectorAll('script[src]')].find(el => String(el.src).includes('/answer-me-/bootstrap.js'));
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

    function markCurrentProfile() {
        const ctx = window.SillyTavern?.getContext?.();
        const currentId = ctx?.extensionSettings?.connectionManager?.selectedProfile;
        const box = document.querySelector('#answer_me_profiles');
        if (!box || !currentId) return;
        for (const row of box.querySelectorAll('.answer-me-profile')) {
            const checkbox = row.querySelector('input[type="checkbox"]');
            const state = row.querySelector('.answer-me-profile-state');
            if (!checkbox || checkbox.value !== currentId) continue;
            if (state && state.textContent !== '当前酒馆 · 自动参赛') state.textContent = '当前酒馆 · 自动参赛';
            row.dataset.answerMeCurrent = '1';
        }
    }

    function installSettingsCollapse() {
        const wrapper = document.querySelector('#answer_me_settings');
        const head = wrapper?.querySelector('.answer-me-head');
        if (!wrapper || !head || wrapper.dataset.answerMeCollapseBound === '1') return false;
        wrapper.dataset.answerMeCollapseBound = '1';
        if (!document.querySelector('#answer_me_collapse_style')) {
            const style = document.createElement('style');
            style.id = 'answer_me_collapse_style';
            style.textContent = `.answer-me-settings.answer-me-collapsed > :not(.answer-me-head){display:none!important}.answer-me-collapse-btn{flex:0 0 auto;min-width:34px;height:32px;padding:0 9px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));border-radius:9px;background:rgba(127,127,127,.08);color:inherit;cursor:pointer;font-size:1.05em;line-height:1}.answer-me-collapse-btn:hover{background:rgba(127,127,127,.15)}.answer-me-title-block{min-width:0;flex:1;cursor:pointer}.answer-me-settings.answer-me-collapsed{padding-bottom:9px}.answer-me-settings.answer-me-collapsed .answer-me-head{margin-bottom:0}@media(max-width:700px){.answer-me-collapse-btn{min-width:32px;height:30px;padding:0 8px}}`;
            document.head.appendChild(style);
        }
        const titleBlock = head.firstElementChild;
        if (titleBlock) titleBlock.classList.add('answer-me-title-block');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer-me-collapse-btn';
        button.setAttribute('aria-label', '折叠 Answer Me 设置');
        head.appendChild(button);
        const readStored = () => { try { const stored = localStorage.getItem(COLLAPSE_KEY); return stored === null ? true : stored === '1'; } catch { return true; } };
        const setCollapsed = (collapsed, persist = true) => {
            wrapper.classList.toggle('answer-me-collapsed', collapsed);
            button.textContent = collapsed ? '▸' : '▾';
            button.title = collapsed ? '展开 Answer Me 设置' : '折叠 Answer Me 设置';
            button.setAttribute('aria-expanded', String(!collapsed));
            if (persist) { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {} }
        };
        const toggle = () => setCollapsed(!wrapper.classList.contains('answer-me-collapsed'));
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggle(); });
        titleBlock?.addEventListener('click', event => { event.preventDefault(); toggle(); });
        setCollapsed(readStored(), false);
        return true;
    }

    function installRacePopupMode() {
        const panel = document.querySelector('#answer_me_float_panel');
        if (!panel || panel.dataset.answerMePopupBound === '1') return false;
        panel.dataset.answerMePopupBound = '1';
        if (!document.querySelector('#answer_me_popup_style')) {
            const style = document.createElement('style');
            style.id = 'answer_me_popup_style';
            style.textContent = `#answer_me_float_panel.answer-me-race-popup{z-index:2147483000!important;animation:answerMePopIn .16s ease-out}@keyframes answerMePopIn{from{opacity:0;transform:translateY(-8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}@media(max-width:700px){#answer_me_float_panel.answer-me-float{position:fixed!important;top:calc(env(safe-area-inset-top,0px) + 64px)!important;left:8px!important;right:8px!important;bottom:auto!important;width:auto!important;max-width:none!important;max-height:44vh!important;border-radius:14px!important;box-shadow:0 10px 34px rgba(0,0,0,.32)!important}#answer_me_float_panel .answer-me-float-body{max-height:calc(44vh - 68px)!important}#answer_me_float_panel .answer-me-status-row{grid-template-columns:22px minmax(72px,.85fr) minmax(92px,1.25fr) auto!important;font-size:.88em!important}}`;
            document.head.appendChild(style);
        }
        const syncVisibility = () => {
            const api = window.AnswerMe, settings = api?.settings, round = api?.round, retry = api?.retry;
            const shouldShow = !!settings?.enabled && !!settings?.showFloatingStatus && (!!round || !!retry?.timer);
            panel.classList.toggle('hidden', !shouldShow);
            panel.classList.toggle('answer-me-race-popup', shouldShow);
        };
        const observer = new MutationObserver(syncVisibility);
        observer.observe(panel, { childList: true, subtree: true, characterData: true });
        panel._answerMePopupObserver = observer;
        syncVisibility();
        return true;
    }

    function bindChatCompletionBridge() {
        const ctx = window.SillyTavern?.getContext?.();
        const source = ctx?.eventSource;
        const events = ctx?.eventTypes || ctx?.event_types;
        if (!source || !events || window[BRIDGE_FLAG]) return !!window[BRIDGE_FLAG];
        const chatReadyEvent = events.CHAT_COMPLETION_SETTINGS_READY;
        const afterDataEvent = events.GENERATE_AFTER_DATA;
        if (!chatReadyEvent || !afterDataEvent) return false;

        let lastNativeAfterDataAt = 0;
        let lastNativePromptSig = '';
        const sig = payload => {
            try {
                const p = payload?.prompt;
                if (Array.isArray(p)) return `a:${p.length}:${JSON.stringify(p.slice(-2)).slice(0,1200)}`;
                return `s:${String(p ?? '').slice(-1200)}`;
            } catch { return ''; }
        };

        source.on(afterDataEvent, payload => {
            if (payload?.__answerMeBridge) return;
            lastNativeAfterDataAt = Date.now();
            lastNativePromptSig = sig(payload);
        });

        source.on(chatReadyEvent, async generateData => {
            try {
                const prompt = Array.isArray(generateData?.messages) ? structuredClone(generateData.messages) : (generateData?.prompt ?? '');
                const payload = { prompt, __answerMeBridge: true };
                const bridgeSig = sig(payload);
                const readyAt = Date.now();
                await sleep(160);
                const nativeJustFired = lastNativeAfterDataAt >= readyAt - 40 && Date.now() - lastNativeAfterDataAt < 500;
                const samePrompt = !lastNativePromptSig || !bridgeSig || lastNativePromptSig === bridgeSig;
                if (nativeJustFired && samePrompt) {
                    console.debug('[💢 Answer Me] native GENERATE_AFTER_DATA detected; bridge skipped duplicate emit');
                    return;
                }
                await source.emit(afterDataEvent, payload, false);
            } catch (error) {
                console.error('[💢 Answer Me] Chat Completion bridge failed', error);
            }
        });

        window[BRIDGE_FLAG] = true;
        console.log(`[💢 Answer Me] ${VERSION}: Chat Completion bridge bound with native-event dedupe`);
        return true;
    }

    function hideIdlePanel() {
        const panel = document.querySelector('#answer_me_float_panel');
        if (!panel) return;
        const api = window.AnswerMe;
        if (!api?.round && !api?.retry?.timer) panel.classList.add('hidden');
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
                refreshDisplayedVersion(); bindChatCompletionBridge(); markCurrentProfile(); installSettingsCollapse(); installRacePopupMode(); hideIdlePanel();
                const box = document.querySelector('#answer_me_profiles');
                if (box && box.dataset.answerMeCurrentObserver !== '1') {
                    box.dataset.answerMeCurrentObserver = '1';
                    new MutationObserver(() => markCurrentProfile()).observe(box, { childList: true, subtree: true });
                }
            }, 100);
        });
        script.addEventListener('error', event => { console.error(`[💢 Answer Me] bootstrap ${VERSION}: core load failed`, event); window.toastr?.error?.('核心脚本加载失败，请更新扩展后刷新页面。', '💢 Answer Me'); });
        document.head.appendChild(script);
    }

    loadCore().catch(error => { console.error(`[💢 Answer Me] bootstrap ${VERSION}: startup failed`, error); window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me'); });
})();