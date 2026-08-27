(() => {
  'use strict';
  const VERSION='0.4.6-beta.28';
  const FLAG='__answerMeSideFallbackV28';
  const WRAP='__answerMeSideFallbackWrappedV28';
  if(window[FLAG]) return; window[FLAG]=true;

  const ctx=()=>window.SillyTavern?.getContext?.()??null;
  const settings=()=>ctx()?.extensionSettings?.answerMe??{};
  const currentProfileId=()=>String(ctx()?.extensionSettings?.connectionManager?.selectedProfile??'');
  const selectedSideIds=()=>new Set((Array.isArray(settings().profileIds)?settings().profileIds:[]).map(String).filter(id=>id!==currentProfileId()));
  const qualityText=result=>String(result?.content??result?.text??'');

  function isAnswerMeSideCall(profileId, custom){
    return !!custom?.stream
      && custom?.extractData===true
      && custom?.includePreset===false
      && custom?.includeInstruct===false
      && selectedSideIds().has(String(profileId));
  }

  function wrap(){
    const service=ctx()?.ConnectionManagerRequestService;
    if(!service?.sendRequest||service[WRAP]) return !!service?.[WRAP];
    const original=service.sendRequest.bind(service);

    service.sendRequest=async function(profileId,prompt,maxTokens,custom={},overridePayload={}){
      if(!isAnswerMeSideCall(profileId,custom)){
        return await original(profileId,prompt,maxTokens,custom,overridePayload);
      }

      try{
        return await original(profileId,prompt,maxTokens,custom,overridePayload);
      }catch(streamError){
        if(custom?.signal?.aborted) throw streamError;
        console.warn(`[💢 Answer Me] ${VERSION}: side stream failed, retrying non-stream`, profileId, streamError);

        let result;
        try{
          result=await original(profileId,prompt,maxTokens,{...custom,stream:false},overridePayload);
        }catch(nonStreamError){
          const error=new Error(`流式失败；非流式回退也失败：${String(nonStreamError?.message||nonStreamError||'API request failed')}`);
          error.cause=nonStreamError;
          throw error;
        }

        const text=qualityText(result);
        const reasoning=String(result?.reasoning??'');
        if(!text.trim()) throw new Error('流式失败；非流式回退空回');

        return function answerMeFallbackFactory(){
          return (async function*(){
            yield {
              text,
              swipes:[],
              state:{
                reasoning,
                answer_me_nonstream_fallback:true,
                answer_me_stream_error:String(streamError?.message||streamError||'API request failed'),
              },
            };
          })();
        };
      }
    };

    service[WRAP]=true;
    console.log(`[💢 Answer Me] ${VERSION}: side stream→nonstream fallback armed`);
    return true;
  }

  let n=0;
  const timer=setInterval(()=>{
    n++;
    if(wrap()||n>=120) clearInterval(timer);
  },250);
  wrap();
})();
