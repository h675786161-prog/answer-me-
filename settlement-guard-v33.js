(() => {
  'use strict';
  const VERSION='0.4.11-beta.33';
  const FLAG='__answerMeSettlementGuardV33';
  if(window[FLAG]) return;

  function install(){
    const st=window.SillyTavern;
    if(!st?.getContext) return false;
    if(st.getContext?.__answerMeSettlementGuardV33) return true;

    const originalGetContext=st.getContext.bind(st);
    const wrappedGetContext=function(){
      const c=originalGetContext();
      if(!c||typeof c!=='object') return c;
      const originalReload=c.reloadCurrentChat;

      c.reloadCurrentChat=async function(...args){
        const round=window.AnswerMe?.round;
        const answerMeSettlement=!!(round&&(round.winner||round.mainInstalled||round.finalized));
        if(!answerMeSettlement){
          return typeof originalReload==='function' ? await originalReload(...args) : undefined;
        }

        // Answer Me 结算只是在当前最后一条消息上写 Swipe/调整赢家。
        // 旧逻辑为每个 Swipe 都整场 reloadCurrentChat：它会 clearChat/printMessages，
        // 还会发 CHAT_CHANGED，反过来触发 Answer Me 的“聊天切换”终止逻辑。
        // 这里改成轻量刷新当前消息和 Swipe 按钮，不重载整场聊天。
        try{
          const chat=c.chat;
          const index=Array.isArray(chat)?chat.length-1:-1;
          const message=index>=0?chat[index]:null;
          if(message&&!message.is_user&&!message.is_system){
            c.updateMessageBlock?.(index,message,{rerenderMessage:true});
          }
          c.swipe?.refresh?.(true,false);
        }catch(error){
          console.warn('[💢 Answer Me] settlement lightweight refresh failed',error);
        }
        return undefined;
      };
      return c;
    };

    wrappedGetContext.__answerMeSettlementGuardV33=true;
    wrappedGetContext.__answerMeOriginalGetContext=originalGetContext;
    st.getContext=wrappedGetContext;
    window[FLAG]=true;
    console.log(`[💢 Answer Me] settlement guard ${VERSION} ready · full chat reload suppressed during settlement`);
    return true;
  }

  if(!install()){
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      if(install()||tries>=100) clearInterval(timer);
    },100);
  }
})();
