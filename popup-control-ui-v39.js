(() => {
  'use strict';
  const VERSION = '0.5.5-beta.39';
  const FLAG = '__answerMePopupControlUiV39';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function mount() {
    const box = document.querySelector('#answer_me_compact_ui_v38');
    const segment = box?.querySelector('.am38-segment');
    if (!box || !segment) return false;
    if (box.querySelector('.am39-popup-toggle')) return true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'am39-popup-toggle';
    button.addEventListener('click', () => {
      const c = ctx();
      if (!c) return;
      c.extensionSettings.answerMe ??= {};
      const s = c.extensionSettings.answerMe;
      s.showFloatingStatus = !s.showFloatingStatus;
      if (s.showFloatingStatus && window.AnswerMe?.round) window.AnswerMe.round.dismissed = false;
      save();
      window.AnswerMe?.refresh?.();
      sync(button);
    });
    segment.insertAdjacentElement('afterend', button);
    sync(button);
    return true;
  }

  function sync(button) {
    const on = !!ctx()?.extensionSettings?.answerMe?.showFloatingStatus;
    button.textContent = on ? '◉ 状态窗 · 开' : '○ 状态窗 · 关';
    button.classList.toggle('on', on);
    button.title = on ? '点击关闭赛马状态窗' : '点击开启赛马状态窗';
  }

  const style = document.createElement('style');
  style.textContent = `
    #answer_me_compact_ui_v38 .am39-popup-toggle{display:block;width:calc(100% - 20px);margin:0 10px 9px;min-height:30px;border:1px solid var(--am-border);border-radius:9px;background:var(--am-soft);color:inherit;font:inherit;font-size:.78em;cursor:pointer}
    #answer_me_compact_ui_v38 .am39-popup-toggle.on{border-color:color-mix(in srgb,var(--am-accent) 48%,var(--am-border));background:var(--am-accent-soft);font-weight:800}
  `;
  document.head.appendChild(style);

  let tries = 0;
  (function boot() {
    tries += 1;
    if (mount()) {
      console.log(`[💢 Answer Me] popup control UI ${VERSION} ready`);
      return;
    }
    if (tries < 100) setTimeout(boot, 120);
  })();
})();
