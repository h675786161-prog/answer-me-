(() => {
  'use strict';
  const VERSION='0.4.10-beta.32';
  const FLAG='__answerMeSafetyWatchdogV32';
  if(window[FLAG]) return; window[FLAG]=true;

  const CHECK_MS=1000;
  const ACTIVE_ZERO_STALL_MS=20000;
  const STALE_SIDE_MS=12000;
  const STALE_ORIGINAL_MS=10000;
  const DEFAULT_COLD_MS=90000;
  const MIN_COLD_MS=15000;

  let roundId=null;
  let seen=new Map();
  let originalSeen={text:'',changedAt:0};

  const api=()=>window.AnswerMe??null;
  const ctx=()=>window.SillyTavern?.getContext?.()??null;
  const diagnostics=()=>window.AnswerMeDiagnostics??null;
  const meaningful=t=>String(t??'').trim().length>0;
  const terminal=c=>!!(c?.finished||c?.aborted||c?.error);

  function coldLimit(){
    const configured=Number(api()?.settings?.coldTimeoutMs ?? DEFAULT_COLD_MS);
    return Number.isFinite(configured)?Math.max(MIN_COLD_MS,configured):DEFAULT_COLD_MS;
  }

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
      seen.set(c.id,{text:String(c.text??''),activityAt:now,lastHeartbeatAt:0,sawChunk:false});
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

  function syncHeartbeat(round,c,p){
    let hb=null;
    try{hb=diagnostics()?.heartbeat?.(c.profileId??c.id)??null}catch{}
    const at=Number(hb?.at||0);
    if(!at||at<=p.lastHeartbeatAt) return;
    if(at<Number(round?.startedAt||0)-1000) return;
    p.lastHeartbeatAt=at;
    p.activityAt=Math.max(p.activityAt,at);
    if(hb?.phase==='chunk'||Number(hb?.chunks||0)>0) p.sawChunk=true;
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
      if(!p){p={text,activityAt:now,lastHeartbeatAt:0,sawChunk:false};seen.set(c.id,p)}
      syncHeartbeat(round,c,p);
      if(text!==p.text){
        p.text=text;
        p.activityAt=now;
      }

      const idle=now-p.activityAt;
      if(!meaningful(text)){
        const limit=p.sawChunk?ACTIVE_ZERO_STALL_MS:coldLimit();
        if(idle>=limit){
          const seconds=Math.round(limit/1000);
          markAbort(c,`${seconds}s 无任何流式进展 · 安全看门狗已断开`);
        }
      }else if(idle>=STALE_SIDE_MS){
        markAbort(c,'12s 无任何流式进展 · 安全看门狗已断开');
      }
    }

    // Native request: only release a stuck generation after visible正文 has stopped growing.
    // Reasoning-only native generation is never aborted by this branch.
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

    if(round.winner){
      const alive=[...round.candidates.values()].filter(c=>!terminal(c));
      if(!alive.length){
        setTimeout(()=>{try{if(api()?.round===round) api()?.abort?.()}catch{}},50);
      }
    }
  }

  const timer=setInterval(sweep,CHECK_MS);
  window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});
  console.log(`[💢 Answer Me] safety watchdog ${VERSION} ready · heartbeat-aware / cold-configured / stall20s / text12s / native10s`);
})();
