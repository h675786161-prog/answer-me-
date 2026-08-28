(() => {
  'use strict';

  const VERSION = '0.5.7-beta.41';
  const FLAG = '__answerMePopupStopV41';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;

  function stopAll(reason = '用户关闭状态窗 · 停止本轮全部请求') {
    // Abort Answer Me side requests and clear any scheduled retry first.
    // This deliberately leaves showFloatingStatus enabled so the next normal
    // generation gets its status window again.
    try { window.AnswerMe?.abort?.(); } catch (error) {
      console.warn(`[💢 Answer Me] ${VERSION}: race abort failed`, error);
    }

    // Then stop SillyTavern's native/current request. activeRound has already
    // been cleared above, so GENERATION_STOPPED cannot accidentally create a
    // retry/failure chain for this user-initiated emergency stop.
    try { ctx()?.stopGeneration?.(); } catch (error) {
      console.warn(`[💢 Answer Me] ${VERSION}: native stop failed`, error);
    }

    const panel = document.querySelector('#answer_me_float_panel');
    panel?.classList?.add('hidden');
    try { window.toastr?.info?.('本轮全部请求已停止', '💢 Answer Me'); } catch {}
    console.log(`[💢 Answer Me] ${VERSION}: ${reason}`);
  }

  function bind() {
    const button = document.querySelector('#answer_me_abort');
    if (!button) return false;
    if (button.dataset.answerMeStopV41 === '1') return true;
    button.dataset.answerMeStopV41 = '1';
    button.title = '停止本轮全部请求';
    button.setAttribute('aria-label', '停止本轮全部请求');

    // Capture phase beats the old core listener whose legacy behavior merely
    // hid the panel. stopImmediatePropagation prevents that obsolete handler.
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      stopAll();
    }, true);
    return true;
  }

  window.AnswerMeStopAll = {
    version: VERSION,
    stop: stopAll,
  };

  let tries = 0;
  (function boot() {
    tries += 1;
    if (bind()) {
      console.log(`[💢 Answer Me] popup stop ${VERSION} ready · close = abort all requests`);
      return;
    }
    if (tries < 100) setTimeout(boot, 120);
  })();
})();
