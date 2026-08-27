(() => {
  'use strict';
  const VERSION='0.4.5-beta.27';
  function baseUrl(){const s=[...document.querySelectorAll('script[src]')].find(e=>String(e.src).includes('/answer-me-/bootstrap-v27.js'));return s?.src?new URL('.',s.src):new URL('/scripts/extensions/third-party/answer-me-/',window.location.origin)}
  function inject(name,tag){return new Promise((resolve,reject)=>{const url=new URL(name,baseUrl());url.searchParams.set('answer_me_v',VERSION);const old=document.querySelector(`script[data-answer-me-loader="${tag}"]`);if(old)return resolve();const sc=document.createElement('script');sc.src=url.href;sc.async=false;sc.dataset.answerMeLoader=tag;sc.addEventListener('load',resolve,{once:true});sc.addEventListener('error',reject,{once:true});document.head.appendChild(sc)})}
  function badge(){const sub=document.querySelector('#answer_me_settings .answer-me-subtitle');if(sub)sub.textContent=`你们几个谁他妈先回我 · v${VERSION}`;if(window.AnswerMe&&typeof window.AnswerMe==='object'){try{window.AnswerMe.version=VERSION}catch{}}}
  async function boot(){
    await inject('model-router-v13.js','model-router-v13');
    await inject('keyword-router-v18.js','keyword-router-v18');
    await inject('site-selector-v16.js','site-selector-v16');
    await inject('quality-guard-v11.js','quality-guard');
    await inject('bootstrap.js','stable-bootstrap-v27');
    await inject('compact-ui-v23.js','compact-ui-v23');
    await inject('exact-model-picker-v24.js','exact-model-picker-v24');
    await inject('diagnostics-v25.js','diagnostics-v25');
    await inject('diagnostic-ui-v26.js','diagnostic-ui-v26');
    await inject('popup-close-v22.js','popup-close-v22');
    await inject('soft-settle-v10.js','soft-settle-v10');
    await inject('recovery-v8.js','refresh-recovery');
    let n=0;const t=setInterval(()=>{n++;badge();if((window.AnswerMe&&document.querySelector('#answer_me_settings'))||n>=40){clearInterval(t);badge()}},250);
    console.log(`[💢 Answer Me] wrapper ${VERSION} ready · duplicate race trigger deduped`);
  }
  boot().catch(error=>{console.error(`[💢 Answer Me] wrapper ${VERSION} failed`,error);window.toastr?.error?.(String(error?.message||error||'启动失败'),'💢 Answer Me')});
})();