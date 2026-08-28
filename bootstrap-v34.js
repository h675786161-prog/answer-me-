(() => {
  'use strict';
  const VERSION = '0.5.0-beta.34';

  function baseUrl() {
    const s = [...document.querySelectorAll('script[src]')].find(e => String(e.src).includes('/answer-me-/bootstrap-v34.js'));
    return s?.src ? new URL('.', s.src) : new URL('/scripts/extensions/third-party/answer-me-/', window.location.origin);
  }

  function inject(name, tag) {
    return new Promise((resolve, reject) => {
      const url = new URL(name, baseUrl());
      url.searchParams.set('answer_me_v', VERSION);
      if (document.querySelector(`script[data-answer-me-loader="${tag}"]`)) return resolve();
      const sc = document.createElement('script');
      sc.src = url.href;
      sc.async = false;
      sc.dataset.answerMeLoader = tag;
      sc.addEventListener('load', resolve, { once: true });
      sc.addEventListener('error', reject, { once: true });
      document.head.appendChild(sc);
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
    // v34 stops loading the old bridge / quality sweep / side-fallback monkeypatch /
    // settlement guard / popup observer / watchdog tower. Race lifecycle lives in one core.
    await inject('race-core-v34.js', 'race-core-v34');
    await inject('model-router-v13.js', 'model-router-v13');
    await inject('keyword-router-v18.js', 'keyword-router-v18');
    await inject('site-selector-v16.js', 'site-selector-v16');
    await inject('compact-ui-v23.js', 'compact-ui-v23');
    await inject('exact-model-picker-v24.js', 'exact-model-picker-v24');
    await inject('diagnostics-v34.js', 'diagnostics-v34');

    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      badge();
      if ((window.AnswerMe && document.querySelector('#answer_me_settings')) || n >= 40) {
        clearInterval(timer);
        badge();
      }
    }, 250);
    console.log(`[💢 Answer Me] wrapper ${VERSION} ready · lean race core`);
  }

  boot().catch(error => {
    console.error(`[💢 Answer Me] wrapper ${VERSION} failed`, error);
    window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
  });
})();
