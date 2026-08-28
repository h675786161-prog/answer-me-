(() => {
  'use strict';
  const VERSION = '0.5.4-beta.38';

  function baseUrl() {
    const script = [...document.querySelectorAll('script[src]')]
      .find(el => String(el.src).includes('/answer-me-/bootstrap-v38.js'));
    return script?.src
      ? new URL('.', script.src)
      : new URL('/scripts/extensions/third-party/answer-me-/', window.location.origin);
  }

  function inject(name, tag) {
    return new Promise((resolve, reject) => {
      const url = new URL(name, baseUrl());
      url.searchParams.set('answer_me_v', VERSION);
      if (document.querySelector(`script[data-answer-me-loader="${tag}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = url.href;
      script.async = false;
      script.dataset.answerMeLoader = tag;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });
  }

  function badge() {
    const sub = document.querySelector('#answer_me_settings .answer-me-subtitle');
    if (sub) sub.textContent = `你们几个谁他妈先回我 · v${VERSION}`;
    if (window.AnswerMe && typeof window.AnswerMe === 'object') {
      try { window.AnswerMe.version = VERSION; } catch {}
    }
  }

  async function boot() {
    await inject('race-core-v35.js', 'race-core-v35');
    await inject('event-order-bridge-v37.js', 'event-order-bridge-v37');
    await inject('model-router-v13.js', 'model-router-v13');
    await inject('keyword-router-v18.js', 'keyword-router-v18');
    await inject('site-selector-v16.js', 'site-selector-v16');
    await inject('compact-ui-v38.js', 'compact-ui-v38');
    await inject('exact-model-picker-v24.js', 'exact-model-picker-v24');
    await inject('diagnostics-v35.js', 'diagnostics-v35');
    await inject('settings-collapse-v36.js', 'settings-collapse-v36');

    let tries = 0;
    const sync = () => {
      tries += 1;
      badge();
      window.AnswerMeCompactUI?.refresh?.();
      if ((!window.AnswerMe || !document.querySelector('#answer_me_settings')) && tries < 40) {
        setTimeout(sync, 200);
      }
    };
    sync();
    console.log(`[💢 Answer Me] wrapper ${VERSION} ready · UI rebuilt without observer/polling`);
  }

  boot().catch(error => {
    console.error(`[💢 Answer Me] wrapper ${VERSION} failed`, error);
    window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
  });
})();
