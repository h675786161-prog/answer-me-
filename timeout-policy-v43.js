(() => {
  'use strict';

  const VERSION = '0.5.9-beta.43';
  const FLAG = '__answerMeTimeoutPolicyV43';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const nativeSetTimeout = window.setTimeout.bind(window);
  const fnToString = Function.prototype.toString;

  function settings() {
    return window.SillyTavern?.getContext?.()?.extensionSettings?.answerMe ?? null;
  }

  function configuredColdMs() {
    const raw = Number(settings()?.coldTimeoutMs || 90000);
    return Math.max(15000, Math.min(300000, Number.isFinite(raw) ? raw : 90000));
  }

  function patchStatusText() {
    const seconds = Math.round(configuredColdMs() / 1000);
    document.querySelectorAll('#answer_me_float_body .answer-me-status-msg').forEach(node => {
      const text = String(node.textContent || '');
      if (/^等待真流开口 · 最多 \d+s$/.test(text)) {
        node.textContent = `等待真流开口 · 最多 ${seconds}s`;
      }
    });
  }

  // race-core-v35 has a legacy hidden 30–45 s cap for the first stream event.
  // Keep the core otherwise untouched, but when that exact Answer Me timer is
  // scheduled, make its delay follow the user-facing coldTimeoutMs setting.
  window.setTimeout = function answerMeTimeoutPolicy(handler, delay, ...args) {
    let effectiveDelay = delay;
    let source = '';
    if (typeof handler === 'function') {
      try { source = fnToString.call(handler); } catch {}
    }

    if (source.includes('Answer Me: stream start timeout')) {
      effectiveDelay = configuredColdMs();
    }

    // Core renders the floating rows through its 80 ms render scheduler. Patch
    // the legacy “最多 45s” copy immediately after that render, with no polling
    // and no MutationObserver.
    if (source.includes('renderFloatingStatus();')) {
      return nativeSetTimeout((...timerArgs) => {
        Reflect.apply(handler, window, timerArgs);
        queueMicrotask(patchStatusText);
      }, effectiveDelay, ...args);
    }

    return nativeSetTimeout(handler, effectiveDelay, ...args);
  };

  // Settings note in the old core still mentions the retired 45 s policy.
  let tries = 0;
  (function patchSettingsNote() {
    tries += 1;
    const note = document.querySelector('#answer_me_settings .answer-me-note');
    if (note) {
      note.textContent = '第一条完整有效回复当主回复；已吐正文的站继续完成并收进 Swipe。真流在零正文阶段完全遵循“冷暴力等待上限”；一旦已经开口，再使用独立的断流检测判断是否半路卡死。只选一个 API 时也会接管失败/空回并按同一退避链自动重试。';
      return;
    }
    if (tries < 80) nativeSetTimeout(patchSettingsNote, 150);
  })();

  window.AnswerMeTimeoutPolicy = {
    version: VERSION,
    get coldTimeoutMs() { return configuredColdMs(); },
    refreshStatus: patchStatusText,
  };

  console.log(`[💢 Answer Me] timeout policy ${VERSION} ready · first-text wait follows coldTimeoutMs`);
})();
