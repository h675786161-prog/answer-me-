(() => {
  'use strict';
  const VERSION='0.4.11-beta.33';
  const FLAG='__answerMeDiagnosticsReleaseV33';
  if(window[FLAG]) return; window[FLAG]=true;

  function patch(){
    const d=window.AnswerMeDiagnostics;
    if(!d?.text) return false;
    const rawText=d.text.bind(d);
    const releaseText=()=>String(rawText()).replace(/^插件版本:.*$/m,`插件版本: ${VERSION}`);
    d.version=VERSION;
    d.text=releaseText;
    d.copy=async()=>{
      const text=releaseText();
      try{
        await navigator.clipboard.writeText(text);
        window.toastr?.success?.('诊断信息已复制','🩺 Answer Me');
        return true;
      }catch{
        const ta=document.createElement('textarea');
        ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
        const ok=document.execCommand('copy');ta.remove();
        if(ok) window.toastr?.success?.('诊断信息已复制','🩺 Answer Me');
        return ok;
      }
    };

    const old=document.querySelector('#answer_me_copy_diag_v32');
    if(old&&!document.querySelector('#answer_me_copy_diag_v33')){
      const btn=old.cloneNode(true);
      btn.id='answer_me_copy_diag_v33';
      old.replaceWith(btn);
      btn.addEventListener('click',()=>d.copy());
    }
    return true;
  }

  if(!patch()){
    let n=0;const t=setInterval(()=>{n++;if(patch()||n>=80)clearInterval(t)},100);
  }
})();
