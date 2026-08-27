(() => {
  'use strict';
  const VERSION='0.4.8-beta.30';
  const FLAG='__answerMePopupLiteV30';
  if(window[FLAG]) return; window[FLAG]=true;

  const DISMISSED='answer-me-dismissed-v30';
  let dismissedRoundId=null;

  function ensureStyle(){
    if(document.getElementById('answer_me_popup_lite_style_v30')) return;
    const style=document.createElement('style');
    style.id='answer_me_popup_lite_style_v30';
    style.textContent=`
      #answer_me_float_panel{pointer-events:none!important}
      #answer_me_float_panel #answer_me_abort{pointer-events:auto!important;touch-action:manipulation!important;position:relative;z-index:2147483647;min-width:38px;min-height:38px}
      #answer_me_float_panel.${DISMISSED}{display:none!important;visibility:hidden!important;pointer-events:none!important}
    `;
    document.head.appendChild(style);
  }

  function bind(){
    ensureStyle();
    const panel=document.querySelector('#answer_me_float_panel');
    const close=panel?.querySelector('#answer_me_abort');
    if(!panel||!close) return false;

    close.title='隐藏状态窗（后台继续赛马）';
    close.setAttribute('aria-label','隐藏 Answer Me 状态窗');

    if(close.dataset.answerMeLiteV30==='1') return true;
    close.dataset.answerMeLiteV30='1';

    const dismiss=(e)=>{
      try{e?.preventDefault?.();e?.stopImmediatePropagation?.();e?.stopPropagation?.();}catch{}
      const roundId=window.AnswerMe?.round?.id ?? '__active__';
      dismissedRoundId=roundId;
      panel.classList.add(DISMISSED);
      panel.style.setProperty('display','none','important');
      panel.style.setProperty('pointer-events','none','important');
      panel.setAttribute('aria-hidden','true');
    };

    close.addEventListener('pointerdown',dismiss,{capture:true});
    close.addEventListener('touchstart',dismiss,{capture:true,passive:false});
    close.addEventListener('click',dismiss,{capture:true});

    // Core keeps its old abort click listener, but capture interception above prevents it.
    return true;
  }

  function syncForNewRound(){
    const panel=document.querySelector('#answer_me_float_panel');
    if(!panel) return;
    const roundId=window.AnswerMe?.round?.id ?? null;
    if(roundId && dismissedRoundId!==null && roundId!==dismissedRoundId){
      dismissedRoundId=null;
      panel.classList.remove(DISMISSED);
      panel.style.removeProperty('display');
      panel.style.removeProperty('pointer-events');
      panel.removeAttribute('aria-hidden');
    }
  }

  // Finite bootstrap only: no perpetual MutationObserver / 250ms polling loop.
  let attempts=0;
  const boot=()=>{
    attempts++;
    if(bind()) return;
    if(attempts<40) setTimeout(boot,150);
  };
  boot();

  const ctx=window.SillyTavern?.getContext?.();
  const source=ctx?.eventSource;
  const events=ctx?.eventTypes||ctx?.event_types;
  const newRoundEvent=events?.GENERATION_STARTED;
  if(source&&newRoundEvent){
    source.on(newRoundEvent,()=>setTimeout(()=>{syncForNewRound();bind();},0));
  }

  window.AnswerMePopupClose={
    version:VERSION,
    hide(){
      const panel=document.querySelector('#answer_me_float_panel');
      if(!panel) return;
      dismissedRoundId=window.AnswerMe?.round?.id ?? '__active__';
      panel.classList.add(DISMISSED);
      panel.style.setProperty('display','none','important');
      panel.style.setProperty('pointer-events','none','important');
    },
    show(){
      dismissedRoundId=null;
      const panel=document.querySelector('#answer_me_float_panel');
      panel?.classList.remove(DISMISSED);
      panel?.style.removeProperty('display');
      panel?.style.removeProperty('pointer-events');
      panel?.removeAttribute('aria-hidden');
    }
  };

  console.log(`[💢 Answer Me] popup lite ${VERSION} ready · no observer / no polling / nonblocking panel`);
})();
