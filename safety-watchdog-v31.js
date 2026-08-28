(() => {
  'use strict';
  const VERSION='0.4.9-beta.31';
  const FLAG='__answerMeSafetyWatchdogV31';
  if(window[FLAG]) return; window[FLAG]=true;

  const CHECK_MS=1000;
  const ZERO_SIDE_MS=20000;
  const STALE_SIDE_MS=12000;
  const STALE_ORIGINAL_MS=10000;

  let roundId=null;
  let seen=new Map();
  let originalSeen={text:'',changedAt:0};

  const api=()=>window.AnswerMe??null;
  const ctx=()=>window.SillyTavern?.getContext?.()??null;
  const meaningful=t=>String(t??'').trim().length>0;
  const terminal=c=>!!(c?.finished||c?.aborted||c?.error);

  function currentAssistantText(){
    const chat=ctx()?.chat;
    const m=Array.isArray(chat)?chat[chat.length-1]:null;
    if(!m||m.is_user||m.is_system) return '';
    return String(m.mes??'');
  }

  function reset(round){
    roundId=round?.id??null;
    seen=new Map();
    const now=Date.now();
    for(const c of round?.candidates?.values?.()??[]){
      seen.set(c.id,{text:String(c.text??''),changedAt:now});
    }
    originalSeen={text:currentAssistantText(),changedAt:now};
  }

  function markAbort(c,reason){
    if(!c||terminal(c)) return;
    c.aborted=true;
    c.error=reason;
    c.finishedAt=Date.now();
    try{c.controller?.abort?.(reason)}catch{}
  }

  function sweep(){
    const a=api();
    const round=a?.round;
    if(!round) return;
    if(round.id!==roundId) reset(round);

    const now=Date.now();
    const original=round.candidates?.get?.('__original__');
    const originalText=currentAssistantText()||String(original?.text??'');
    if(originalText!==originalSeen.text){
      originalSeen={text:originalText,changedAt:now};
    }

    for(const c of round.candidates.values()){
      if(c.isOriginal||terminal(c)) continue;
      const text=String(c.text??'');
      let p=seen.get(c.id);
      if(!p){p={text,changedAt:now};seen.set(c.id,p)}
      if(text!==p.text){p.text=text;p.changedAt=now}

      const age=now-round.startedAt;
      const stale=now-p.changedAt;
      if(!meaningful(text)&&age>=ZERO_SIDE_MS){
        markAbort(c,'20s 零正文 · 安全看门狗已断开');
      }else if(meaningful(text)&&stale>=STALE_SIDE_MS){
        markAbort(c,'12s 无新正文 · 安全看门狗已断开');
      }
    }

    // If the native request has visible text but SillyTavern still reports an active
    // generation for too long with no growth, release the native generation lock.
    // We do not rewrite chat here; the text already visible in chat remains intact.
    if(original&&!terminal(original)&&meaningful(originalText)&&now-originalSeen.changedAt>=STALE_ORIGINAL_MS){
      original.started=true;
      original.text=originalText;
      original.finished=true;
      original.error='';
      original.finishedAt=now;
      round.originalFinished=true;
      if(!round.winner){
        original.winner=true;
        round.winner=original;
        round.mainInstalled=true;
      }
      try{ctx()?.stopGeneration?.()}catch{}
    }

    // Once a winner exists, never let dead side requests keep the round/UI alive forever.
    if(round.winner){
      const alive=[...round.candidates.values()].filter(c=>!terminal(c));
      if(!alive.length){
        setTimeout(()=>{try{if(api()?.round===round) api()?.abort?.()}catch{}},50);
      }
    }
  }

  const timer=setInterval(sweep,CHECK_MS);
  window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});
  console.log(`[💢 Answer Me] safety watchdog ${VERSION} ready · zero20s / stale12s / native10s`);
})();
