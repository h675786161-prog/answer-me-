(() => {
  'use strict';
  const VERSION='0.4.6-beta.28';
  const FLAG='__answerMePopupCloseV28';
  const HIDDEN='answer-me-manually-hidden-v28';
  if(window[FLAG]) return; window[FLAG]=true;

  let manuallyHidden=false;
  let sawIdleAfterHide=false;

  const api=()=>window.AnswerMe??null;

  function ensureStyle(){
    if(document.getElementById('answer_me_popup_close_style_v28')) return;
    const style=document.createElement('style');
    style.id='answer_me_popup_close_style_v28';
    style.textContent=`
      #answer_me_float_panel.${HIDDEN}{display:none!important}
      #answer_me_float_panel .answer-me-popup-close-v28{
        position:absolute;top:7px;right:8px;z-index:2147483647;width:30px;height:30px;padding:0;
        display:flex;align-items:center;justify-content:center;border:0;border-radius:999px;
        background:rgba(127,127,127,.16);color:inherit;font-size:19px;line-height:1;cursor:pointer;opacity:.9
      }
      #answer_me_float_panel .answer-me-popup-close-v28:hover{opacity:1;background:rgba(127,127,127,.28)}
      @media(max-width:700px){#answer_me_float_panel .answer-me-popup-close-v28{top:6px;right:7px;width:32px;height:32px}}
    `;
    document.head.appendChild(style);
  }

  function setHidden(value){
    manuallyHidden=!!value;
    if(manuallyHidden) sawIdleAfterHide=false;
    document.querySelector('#answer_me_float_panel')?.classList.toggle(HIDDEN,manuallyHidden);
  }

  function mount(){
    ensureStyle();
    const panel=document.querySelector('#answer_me_float_panel');
    if(!panel) return false;

    // Remove the old cosmetic close button so there is only one obvious close control.
    panel.querySelectorAll('.answer-me-popup-close-v22').forEach(el=>el.remove());

    let close=panel.querySelector('.answer-me-popup-close-v28');
    if(!close){
      close=document.createElement('button');
      close.type='button';
      close.className='answer-me-popup-close-v28';
      close.textContent='×';
      close.title='只隐藏状态窗，不终止本轮';
      close.setAttribute('aria-label','隐藏赛马状态窗');
      close.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();},{capture:true});
      close.addEventListener('click',e=>{
        e.preventDefault();e.stopImmediatePropagation();
        setHidden(true);
      },{capture:true});
      panel.appendChild(close);
    }
    return true;
  }

  function sync(){
    mount();
    const panel=document.querySelector('#answer_me_float_panel');
    if(!panel) return;
    const active=!!api()?.round || !!api()?.retry?.timer;

    if(manuallyHidden){
      panel.classList.add(HIDDEN);
      if(!active) sawIdleAfterHide=true;
      return;
    }

    // A manual hide stays sticky for the whole active race. It may reopen only
    // after that race has really gone idle, then a later race starts.
    panel.classList.remove(HIDDEN);
  }

  // Detect the first genuinely new race after a hidden round has gone idle.
  let wasActive=false;
  setInterval(()=>{
    const active=!!api()?.round || !!api()?.retry?.timer;
    if(manuallyHidden && !active) sawIdleAfterHide=true;
    if(manuallyHidden && sawIdleAfterHide && active && !wasActive){
      manuallyHidden=false;
      sawIdleAfterHide=false;
      document.querySelector('#answer_me_float_panel')?.classList.remove(HIDDEN);
    }
    wasActive=active;
    sync();
  },250);

  const observer=new MutationObserver(sync);
  observer.observe(document.documentElement,{childList:true,subtree:true});

  window.AnswerMePopupClose={
    version:VERSION,
    show(){manuallyHidden=false;sawIdleAfterHide=false;document.querySelector('#answer_me_float_panel')?.classList.remove(HIDDEN)},
    hide(){setHidden(true)},
  };

  sync();
  console.log(`[💢 Answer Me] popup close ${VERSION} ready · sticky until race truly ends`);
})();
