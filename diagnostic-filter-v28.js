(() => {
  'use strict';
  const VERSION='0.4.6-beta.28';
  const FLAG='__answerMeDiagnosticFilterV28';
  if(window[FLAG]) return; window[FLAG]=true;

  const ctx=()=>window.SillyTavern?.getContext?.()??null;
  const settings=()=>ctx()?.extensionSettings?.answerMe??{};
  const profileMap=()=>new Map((ctx()?.extensionSettings?.connectionManager?.profiles||[]).map(p=>[String(p.id),p]));
  const selectedIds=()=>new Set((Array.isArray(settings().profileIds)?settings().profileIds:[]).map(String));

  function filteredEvents(){
    const api=window.AnswerMeDiagnostics;
    const ids=selectedIds();
    return (api?.events||[]).filter(e=>{
      if(!e?.profileId) return e?.type==='diagnostics_ready';
      return ids.has(String(e.profileId));
    });
  }

  function snapshot(){
    const api=window.AnswerMeDiagnostics;
    const base=api?.snapshot?.()||{};
    const profiles=profileMap();
    const ids=[...(selectedIds())];
    return {
      ...base,
      selectedProfiles:ids,
      selectedProfileDetails:ids.map(id=>({
        id,
        name:String(profiles.get(id)?.name||''),
        model:String(profiles.get(id)?.model||''),
      })),
    };
  }

  function text(){
    const api=window.AnswerMeDiagnostics;
    if(!api) return 'Answer Me Diagnostics 尚未就绪';
    const snap=snapshot();
    const events=filteredEvents();
    return [
      '=== Answer Me 诊断信息 ===',
      `插件版本: ${VERSION}`,
      `时间: ${new Date().toISOString()}`,
      `传输模式: ${snap.transportMode||''}`,
      `模型系列: ${snap.family||''}`,
      `模型档: ${snap.selectedGroup||''}`,
      `关键名: ${snap.selectedKeyword||''}`,
      `原生流式开关: ${!!snap.nativeStreamChecked}`,
      `当前 Profile: ${snap.currentProfileId||''}`,
      `参赛 Profile IDs: ${(snap.selectedProfiles||[]).join(', ')}`,
      '',
      '--- 当前模型分配 ---',
      JSON.stringify(snap.assignments||[],null,2),
      '',
      '--- 参赛 Profile 实际模型 ---',
      JSON.stringify(snap.selectedProfileDetails||[],null,2),
      '',
      '--- Side Request 事件（已过滤非参赛插件调用）---',
      ...events.map((e,i)=>`${String(i+1).padStart(3,'0')} ${JSON.stringify(e)}`),
    ].join('\n');
  }

  async function copy(){
    const value=text();
    try{
      await navigator.clipboard.writeText(value);
      window.toastr?.success?.(`已复制 ${filteredEvents().length} 条参赛诊断事件`,'🩺 Answer Me');
      return true;
    }catch{
      const ta=document.createElement('textarea');
      ta.value=value;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
      const ok=document.execCommand('copy');ta.remove();
      if(ok) window.toastr?.success?.(`已复制 ${filteredEvents().length} 条参赛诊断事件`,'🩺 Answer Me');
      return ok;
    }
  }

  let n=0;
  const timer=setInterval(()=>{
    n++;
    const api=window.AnswerMeDiagnostics;
    if(api){
      api.version=VERSION;
      api.text=text;
      api.copy=copy;
      api.filteredEvents=filteredEvents;
      clearInterval(timer);
      console.log(`[💢 Answer Me] diagnostic filter ${VERSION} ready · non-race calls hidden from export`);
    }
    if(n>=120) clearInterval(timer);
  },250);
})();
