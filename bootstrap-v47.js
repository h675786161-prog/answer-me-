(() => {
  'use strict';
  const VERSION = '0.6.3-beta.47';

  function baseUrl() {
    const script = [...document.querySelectorAll('script[src]')]
      .find(el => String(el.src).includes('/answer-me-/bootstrap-v47.js'));
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
    await inject('request-mirror-v40.js', 'request-mirror-v40');
    await inject('timeout-policy-v43.js', 'timeout-policy-v43');

    // v47 holds the native-only transient selection across the whole mobile
    // generation event turn, then lets the legacy race core create 1 candidate.
    await inject('native-only-bridge-v47.js', 'native-only-bridge-v47');
    try { await window.__AnswerMeNativeBridgeReadyV47; } catch {}
    await inject('race-core-v35.js', 'race-core-v35');

    await inject('event-order-bridge-v37.js', 'event-order-bridge-v37');
    await inject('popup-visibility-v39.js', 'popup-visibility-v39');
    await inject('popup-stop-v41.js', 'popup-stop-v41');
    await inject('manual-stop-v47.js', 'manual-stop-v47');
    await inject('mobile-popup-v47.js', 'mobile-popup-v47');

    await inject('model-router-v45.js', 'model-router-v45');
    await inject('zero-side-policy-v46.js', 'zero-side-policy-v46');
    await inject('site-selector-v46.js', 'site-selector-v46');

    await inject('compact-ui-v38.js', 'compact-ui-v38');
    await inject('native-status-v46.js', 'native-status-v46');
    await inject('popup-control-ui-v39.js', 'popup-control-ui-v39');
    await inject('manual-retract-v44.js', 'manual-retract-v44');
    await inject('diagnostics-v35.js', 'diagnostics-v35');
    await inject('settings-collapse-v36.js', 'settings-collapse-v36');

    let tries = 0;
    const sync = () => {
      tries += 1;
      badge();
      window.AnswerMeCompactUI?.refresh?.();
      window.AnswerMeNativeStatus?.refresh?.();
      window.AnswerMe?.refresh?.();
      window.AnswerMeTimeoutPolicy?.refreshStatus?.();
      if ((!window.AnswerMe || !document.querySelector('#answer_me_settings')) && tries < 40) setTimeout(sync, 200);
    };
    sync();
    console.log(`[💢 Answer Me] wrapper ${VERSION} ready · hard manual stop + mobile status + native-only race`);
  }

  boot().catch(error => {
    console.error(`[💢 Answer Me] wrapper ${VERSION} failed`, error);
    window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
  });
})();
