(() => {
  'use strict';
  const VERSION='0.4.4-beta.26';
  const FLAG='__answerMeDiagnosticsUiV26';
  if(window[FLAG]) return; window[FLAG]=true;

  function ensure(){
    const api=window.AnswerMeDiagnostics;
    const box=document.querySelector('#answer_me_compact_ui_v23');
    const host=box?.querySelector('.advanced');
    if(!api||!host) return false;

    let copy=host.querySelector('#answer_me_copy_diag_v26');
    if(!copy){
      copy=document.createElement('button');
      copy.id='answer_me_copy_diag_v26';
      copy.type='button';
      copy.className='mini';
      copy.textContent='🩺 复制诊断信息';
      copy.title='复制本轮副请求诊断信息';
      copy.addEventListener('click', async e=>{
        e.preventDefault();e.stopPropagation();
        await api.copy?.();
      });
      host.appendChild(copy);
    }

    let clear=host.querySelector('#answer_me_clear_diag_v26');
    if(!clear){
      clear=document.createElement('button');
      clear.id='answer_me_clear_diag_v26';
      clear.type='button';
      clear.className='mini';
      clear.textContent='清空诊断';
      clear.addEventListener('click', e=>{
        e.preventDefault();e.stopPropagation();
        api.clear?.();
        window.toastr?.info?.('诊断记录已清空','🩺 Answer Me');
      });
      host.appendChild(clear);
    }
    return true;
  }

  let n=0;
  const timer=setInterval(()=>{
    n++;
    ensure();
    if(n>120) clearInterval(timer);
  },250);
  ensure();
  console.log(`[💢 Answer Me] diagnostics UI ${VERSION} ready · controls mounted in compact advanced panel`);
})();
