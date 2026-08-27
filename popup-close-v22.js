(() => {
  'use strict';

  const VERSION = '0.4.0-beta.22';
  const FLAG = '__answerMePopupCloseV22';
  if (window[FLAG]) return;
  window[FLAG] = true;

  let manuallyHidden = false;
  let lastRoundId = null;

  function api() { return window.AnswerMe ?? null; }

  function ensureStyle() {
    if (document.querySelector('#answer_me_popup_close_style_v22')) return;
    const style = document.createElement('style');
    style.id = 'answer_me_popup_close_style_v22';
    style.textContent = `
      #answer_me_float_panel{position:relative}
      #answer_me_float_panel .answer-me-popup-close-v22{
        position:absolute;top:7px;right:8px;z-index:6;width:28px;height:28px;padding:0;
        display:flex;align-items:center;justify-content:center;border:0;border-radius:999px;
        background:rgba(127,127,127,.12);color:inherit;font-size:18px;line-height:1;cursor:pointer;
        opacity:.72;backdrop-filter:blur(4px)
      }
      #answer_me_float_panel .answer-me-popup-close-v22:hover{opacity:1;background:rgba(127,127,127,.22)}
      #answer_me_float_panel.answer-me-manually-hidden-v22{display:none!important}
      @media(max-width:700px){#answer_me_float_panel .answer-me-popup-close-v22{top:6px;right:7px;width:30px;height:30px}}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    ensureStyle();
    const panel = document.querySelector('#answer_me_float_panel');
    if (!panel) return;
    let close = panel.querySelector('.answer-me-popup-close-v22');
    if (!close) {
      close = document.createElement('button');
      close.type = 'button';
      close.className = 'answer-me-popup-close-v22';
      close.textContent = '×';
      close.title = '隐藏本轮赛马状态';
      close.setAttribute('aria-label', '隐藏本轮赛马状态');
      close.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        manuallyHidden = true;
        panel.classList.add('answer-me-manually-hidden-v22');
      });
      panel.appendChild(close);
    }
  }

  function sync() {
    mount();
    const panel = document.querySelector('#answer_me_float_panel');
    if (!panel) return;
    const a = api();
    const roundId = a?.round?.id ?? null;

    // 手动关闭只影响当前这一轮；下一轮开始时自动重新出现。
    if (roundId && roundId !== lastRoundId) {
      manuallyHidden = false;
      panel.classList.remove('answer-me-manually-hidden-v22');
    }
    lastRoundId = roundId;

    if (!manuallyHidden) panel.classList.remove('answer-me-manually-hidden-v22');
  }

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(sync, 350);
  sync();

  window.AnswerMePopupClose = {
    version: VERSION,
    show() {
      manuallyHidden = false;
      document.querySelector('#answer_me_float_panel')?.classList.remove('answer-me-manually-hidden-v22');
    },
    hide() {
      manuallyHidden = true;
      document.querySelector('#answer_me_float_panel')?.classList.add('answer-me-manually-hidden-v22');
    },
  };
})();
