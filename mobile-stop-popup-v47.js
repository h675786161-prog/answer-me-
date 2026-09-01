(() => {
  'use strict';

  const VERSION = '0.6.3-beta.47';
  const FLAG = '__answerMeMobileStopPopupV47';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  let lastManualStopAt = 0;

  function settings() {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    return c.extensionSettings.answerMe;
  }

  function stopText(el) {
    if (!(el instanceof Element)) return '';
    return [
      el.id,
      typeof el.className === 'string' ? el.className : '',
      el.getAttribute('title'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-action'),
      el.getAttribute('data-command'),
      el.textContent,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function isStopIntent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path.slice(0, 8)) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('#answer_me_abort,#mes_stop,.mes_stop,[data-answer-me-stop]')) return true;
      const interactive = node.matches?.('button,[role="button"],input[type="button"],input[type="submit"]');
      if (!interactive) continue;
      const text = stopText(node);
      if (/(?:^|[\s_\-])(stop|pause)(?:[\s_\-]|$)|停止|暂停|中止/.test(text)) return true;
    }
    return false;
  }

  function markManualStop(event) {
    if (!isStopIntent(event)) return;
    const now = Date.now();
    if (now - lastManualStopAt < 450) return;
    lastManualStopAt = now;

    document.documentElement.dataset.answerMeManualStopV47 = String(now);
    try { window.AnswerMe?.abort?.(); } catch (error) {
      console.warn(`[💢 Answer Me] ${VERSION}: manual stop race abort failed`, error);
    }
  }

  for (const type of ['pointerdown', 'touchstart', 'click']) {
    document.addEventListener(type, markManualStop, { capture: true, passive: true });
  }

  function installMobileStyle() {
    if (document.querySelector('#answer_me_mobile_popup_style_v47')) return;
    const style = document.createElement('style');
    style.id = 'answer_me_mobile_popup_style_v47';
    style.textContent = `
      @media (max-width: 700px) {
        #answer_me_float_panel.answer-me-float {
          position: fixed !important;
          z-index: 2147482000 !important;
          left: 8px !important;
          right: 8px !important;
          bottom: max(76px, calc(env(safe-area-inset-bottom, 0px) + 64px)) !important;
          width: auto !important;
          max-width: none !important;
          max-height: min(46dvh, 420px) !important;
          transform: none !important;
          pointer-events: auto !important;
        }
        #answer_me_float_panel .answer-me-float-body {
          max-height: calc(min(46dvh, 420px) - 62px) !important;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        #answer_me_float_panel #answer_me_abort {
          width: 36px !important;
          height: 36px !important;
          min-width: 36px !important;
          touch-action: manipulation;
        }
      }
      @media (max-width: 430px) {
        #answer_me_float_panel.answer-me-float {
          left: 6px !important;
          right: 6px !important;
          bottom: max(72px, calc(env(safe-area-inset-bottom, 0px) + 60px)) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function refreshPopupAfterRaceEvent() {
    const s = settings();
    if (!s?.enabled || !s?.showFloatingStatus) return;
    setTimeout(() => {
      const round = window.AnswerMe?.round;
      if (round) round.dismissed = false;
      try { window.AnswerMe?.refresh?.(); } catch {}
    }, 0);
  }

  function bindRaceRefresh() {
    const c = ctx();
    const events = c?.eventTypes || c?.event_types;
    if (!c?.eventSource || !events) return false;
    if (events.CHAT_COMPLETION_SETTINGS_READY) c.eventSource.on(events.CHAT_COMPLETION_SETTINGS_READY, refreshPopupAfterRaceEvent);
    if (events.GENERATE_AFTER_DATA) c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => { if (!dryRun) refreshPopupAfterRaceEvent(); });
    return true;
  }

  installMobileStyle();
  if (!bindRaceRefresh()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (bindRaceRefresh() || tries >= 120) clearInterval(timer);
    }, 100);
  }

  console.log(`[💢 Answer Me] mobile stop/popup ${VERSION} ready · manual stop cancels retries, mobile popup gets top-layer safe-area layout`);
})();
