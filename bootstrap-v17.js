(() => {
    'use strict';

    const VERSION = '0.3.5-beta.17';

    function baseUrl() {
        const script = [...document.querySelectorAll('script[src]')]
            .find(el => String(el.src).includes('/answer-me-/bootstrap-v17.js'));
        if (script?.src) return new URL('.', script.src);
        return new URL('/scripts/extensions/third-party/answer-me-/', window.location.origin);
    }

    function inject(name, tag) {
        return new Promise((resolve, reject) => {
            const url = new URL(name, baseUrl());
            url.searchParams.set('answer_me_v', VERSION);
            const old = document.querySelector(`script[data-answer-me-loader="${tag}"]`);
            if (old) return resolve();
            const script = document.createElement('script');
            script.src = url.href;
            script.async = false;
            script.dataset.answerMeLoader = tag;
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', reject, { once: true });
            document.head.appendChild(script);
        });
    }

    function refreshVersionBadge() {
        const subtitle = document.querySelector('#answer_me_settings .answer-me-subtitle');
        if (subtitle) subtitle.textContent = `你们几个谁他妈先回我 · v${VERSION}`;
        if (window.AnswerMe && typeof window.AnswerMe === 'object') {
            try { window.AnswerMe.version = VERSION; } catch {}
        }
    }

    async function boot() {
        // v17：v13 只负责扫描模型表 + 假流请求包装；分类/切换完全交给手动可覆盖的新路由。
        await inject('model-router-v13.js', 'model-router-v13');
        await inject('manual-router-v17.js', 'manual-router-v17');
        await inject('site-selector-v16.js', 'site-selector-v16');
        await inject('quality-guard-v11.js', 'quality-guard');
        await inject('bootstrap.js', 'stable-bootstrap');
        await inject('soft-settle-v10.js', 'soft-settle-v10');
        await inject('recovery-v8.js', 'refresh-recovery');

        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            refreshVersionBadge();
            if ((window.AnswerMe && document.querySelector('#answer_me_settings')) || tries >= 40) {
                clearInterval(timer);
                refreshVersionBadge();
            }
        }, 250);

        console.log(`[💢 Answer Me] wrapper ${VERSION} ready · auto classify + manual override loaded`);
    }

    boot().catch(error => {
        console.error(`[💢 Answer Me] wrapper ${VERSION} failed`, error);
        window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
    });
})();
