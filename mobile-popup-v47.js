(() => {
  'use strict';

  const VERSION = '0.6.3-beta.47';
  const FLAG = '__answerMeMobilePopupV47';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const STYLE_ID = 'answer_me_mobile_popup_v47_style';
  const ctx = () => window.SillyTavern?.getContext?.() ?? null;

  function mountStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @media (max-width: 700px) {
        #answer_me_float_panel.answer-me-float:not(.hidden) {
          display: block !important;
          position: fixed !important;
          left: 50% !important;
          right: auto !important;
          bottom: max(72px, calc(env(safe-area-inset-bottom, 0px) + 64px)) !important;
          transform: translateX(-50%) !important;
          width: min(326px, calc(100vw - 16px)) !important;
          max-width: calc(100vw - 16px) !important;
          max-height: min(44dvh, 420px) !important;
          z-index: 2147483000 !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        #answer_me_float_panel .answer-me-float-body {
          max-height: calc(min(44dvh, 420px) - 60px) !important;
          -webkit-overflow-scrolling: touch;
        }
      }
      @media (max-width: 430px) {
        #answer_me_float_panel.answer-me-float:not(.hidden) {
          width: calc(100vw - 14px) !important;
          max-width: calc(100vw - 14px) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function refreshSoon() {
    mountStyle();
    const s = ctx()?.extensionSettings?.answerMe;
    if (s?.showFloatingStatus === false) return;
    for (const delay of [0, 60, 180, 420]) {
      setTimeout(() => {
        try { window.AnswerMe?.refresh?.(); } catch {}
      }, delay);
    }
  }

  async function bindEvents() {
    for (let i = 0; i < 120; i += 1) {
      const c = ctx();
      const events = c?.eventTypes || c?.event_types;
      if (c?.eventSource && events) {
        if (events.GENERATION_STARTED) c.eventSource.on(events.GENERATION_STARTED, refreshSoon);
        if (events.CHAT_COMPLETION_SETTINGS_READY) c.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, refreshSoon);
        if (events.GENERATE_AFTER_DATA) c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => { if (!dryRun) refreshSoon(); });
        if (events.GENERATION_ENDED) c.eventSource.on(events.GENERATION_ENDED, refreshSoon);
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  mountStyle();
  void bindEvents();
  window.addEventListener('resize', refreshSoon, { passive: true });
  window.addEventListener('orientationchange', refreshSoon, { passive: true });
  console.log(`[💢 Answer Me] mobile popup ${VERSION} ready · safe-area + high-z-index + delayed refresh`);
})();
