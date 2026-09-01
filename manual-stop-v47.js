(() => {
  'use strict';

  const VERSION = '0.6.3-beta.47';
  const FLAG = '__answerMeManualStopV47';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const STOP_SELECTOR = [
    '#mes_stop',
    '.mes_stop',
    '[data-answer-me-stop]',
    '[title*="Stop"]',
    '[title*="停止"]',
    '[aria-label*="Stop"]',
    '[aria-label*="停止"]',
  ].join(',');

  let armedUntil = 0;

  function clearRace(reason = '用户手动停止') {
    if (Date.now() < armedUntil) return;
    armedUntil = Date.now() + 650;
    try { window.AnswerMe?.abort?.(); } catch (error) {
      console.warn(`[💢 Answer Me] ${VERSION}: clear race failed`, error);
    }
    try { window.AnswerMeTimeoutPolicy?.cancel?.(); } catch {}
    try { window.AnswerMe?.refresh?.(); } catch {}
    console.log(`[💢 Answer Me] ${VERSION}: ${reason} · retry chain cleared before native stop`);
  }

  function stopTarget(target) {
    const el = target?.closest?.(STOP_SELECTOR);
    if (!el) return null;
    if (el.id === 'answer_me_abort') return null;
    return el;
  }

  for (const type of ['pointerdown', 'touchstart', 'mousedown']) {
    document.addEventListener(type, event => {
      if (stopTarget(event.target)) clearRace(`检测到 ${type} 停止动作`);
    }, true);
  }

  document.addEventListener('click', event => {
    if (stopTarget(event.target)) clearRace('检测到 click 停止动作');
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const stop = document.querySelector('#mes_stop, .mes_stop');
    if (!stop) return;
    const style = getComputedStyle(stop);
    if (style.display !== 'none' && style.visibility !== 'hidden') clearRace('Escape 停止动作');
  }, true);

  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.id !== 'answer_me_enabled' || input.checked) return;
    clearRace('赛马开关关闭');
    try { ctx()?.stopGeneration?.(); } catch {}
  }, true);

  console.log(`[💢 Answer Me] manual stop ${VERSION} ready · user stop clears race and retry first`);
})();
