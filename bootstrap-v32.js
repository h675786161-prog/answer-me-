(() => {
  'use strict';
  const VERSION='0.4.10-beta.32';
  function baseUrl(){const s=[...document.querySelectorAll('script[src]')].find(e=>String(e.src).includes('/answer-me-/bootstrap-v32.js'));return s?.src?new URL('.',s.src):new URL('/scripts/extensions/third-party/answer-me-/',window.location.origin)}
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
    await inject('diagnostics-v32.js','diagnostics-v32');
    await inject('diagnostics-ui-v26.js','diagnostics-ui-v26');
    await inject('diagnostic-filter-v28.js','diagnostic-filter-v28');
    await inject('side-fallback-v28.js','side-fallback-v28');
    await inject('popup-lite-v30.js','popup-lite-v30');
    await inject('safety-watchdog-v32.js','safety-watchdog-v32');
    await inject('recovery-v8.js','refresh-recovery');
    let n=0;const t=setInterval(()=>{n++;badge();if((window.AnswerMe&&document.querySelector('#answer_me_settings'))||n>=40){clearInterval(t);badge()}},250);
    console.log(`[💢 Answer Me] wrapper ${VERSION} ready · heartbeat-aware watchdog armed`);
  }
  boot().catch(error=>{console.error(`[💢 Answer Me] wrapper ${VERSION} failed`,error);window.toastr?.error?.(String(error?.message||error||'启动失败'),'💢 Answer Me')});
})();
