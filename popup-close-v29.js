(() => {
  'use strict';
  const VERSION='0.4.7-beta.29';
  const FLAG='__answerMePopupCloseV29';
  const HIDDEN='answer-me-manually-hidden-v29';
  if(window[FLAG]) return; window[FLAG]=true;

  let manuallyHidden=false;
  let sawIdleAfterHide=false;
  let wasActive=false;

  const api=()=>window.AnswerMe??null;

  function ensureStyle(){
    if(document.getElementById('answer_me_popup_close_style_v29')) return;
    const style=document.createElement('style');
    style.id='answer_me_popup_close_style_v29';
    style.textContent=`
      #answer_me_float_panel.${HIDDEN}{display:none!important;visibility:hidden!important;pointer-events:none!important}
      #answer_me_float_panel .answer-me-popup-close-v28,#answer_me_float_panel .answer-me-popup-close-v22{display:none!important}
      #answer_me_abort{position:relative;z-index:2147483647;min-width:36px;min-height:36px;touch-action:manipulation;pointer-events:auto!important}
    `;
    document.head.appendChild(style);
  }

  function setHidden(value){
    manuallyHidden=!!value;
    if(manuallyHidden) sawIdleAfterHide=false;
    const panel=document.querySelector('#answer_me_float_panel');
    panel?.classList.toggle(HIDDEN,manuallyHidden);
    if(manuallyHidden){
      panel?.setAttribute('aria-hidden','true');
    }else{
      panel?.removeAttribute('aria-hidden');
    }
  }

  function bindNativeClose(){
    ensureStyle();
    const panel=document.querySelector('#answer_me_float_panel');
    const close=panel?.querySelector('#answer_me_abort');
    if(!panel||!close) return false;

    panel.querySelectorAll('.answer-me-popup-close-v28,.answer-me-popup-close-v22').forEach(el=>el.remove());
    close.title='只隐藏状态窗，不终止本轮';
    close.setAttribute('aria-label','隐藏赛马状态窗');

    if(close.dataset.answerMeHideBoundV29==='1') return true;
    close.dataset.answerMeHideBoundV29='1';

    const hide=(e)=>{
      e.preventDefault();
      e.stopImmediatePropagation();
      setHidden(true);
    };

    // capture 阶段截住核心原本“终止整轮”的 click；移动端 pointerup/touchend 也直接响应。
    close.addEventListener('click',hide,{capture:true});
    close.addEventListener('pointerup',hide,{capture:true});
    close.addEventListener('touchend',hide,{capture:true,passive:false});
    return true;
  }

  function sync(){
    bindNativeClose();
    const panel=document.querySelector('#answer_me_float_panel');
    if(!panel) return;
    const active=!!api()?.round || !!api()?.retry?.timer;

    if(manuallyHidden){
      panel.classList.add(HIDDEN);
      panel.setAttribute('aria-hidden','true');
      if(!active) sawIdleAfterHide=true;
      return;
    }

    panel.classList.remove(HIDDEN);
    panel.removeAttribute('aria-hidden');
  }

  setInterval(()=>{
    const active=!!api()?.round || !!api()?.retry?.timer;
    if(manuallyHidden && !active) sawIdleAfterHide=true;
    if(manuallyHidden && sawIdleAfterHide && active && !wasActive){
      manuallyHidden=false;
      sawIdleAfterHide=false;
    }
    wasActive=active;
    sync();
  },250);

  const observer=new MutationObserver(sync);
  observer.observe(document.documentElement,{childList:true,subtree:true});

  window.AnswerMePopupClose={
    version:VERSION,
    show(){manuallyHidden=false;sawIdleAfterHide=false;sync()},
    hide(){setHidden(true)},
  };

  sync();
  console.log(`[💢 Answer Me] popup close ${VERSION} ready · native × intercepted, mobile-safe hide`);
})();
