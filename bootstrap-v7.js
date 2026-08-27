(() => {
    'use strict';

    const VERSION = '0.2.5-beta.7';

    function baseUrl() {
        const script = [...document.querySelectorAll('script[src]')]
            .find(el => String(el.src).includes('/answer-me-/bootstrap-v7.js'));
        if (script?.src) return new URL('.', script.src);
        return new URL('/scripts/extensions/third-party/answer-me-/', window.location.origin);
    }

    function inject(name, tag) {
        return new Promise((resolve, reject) => {
            const url = new URL(name, baseUrl());
            url.searchParams.set('answer_me_v', VERSION);

            const old = document.querySelector(`script[data-answer-me-loader="${tag}"]`);
            if (old) {
                resolve();
                return;
            }

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
        // 继续复用 beta.6 已经跑稳的 bootstrap，不直接动核心。
        await inject('bootstrap.js', 'stable-bootstrap');
        await inject('stall-guard-v7.js', 'stall-guard');

        // beta.6 会先把自己的版本号写回去，随后覆盖成真实版本。
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            refreshVersionBadge();
            if ((window.AnswerMe && document.querySelector('#answer_me_settings')) || tries >= 40) {
                clearInterval(timer);
                refreshVersionBadge();
            }
        }, 250);

        console.log(`[💢 Answer Me] wrapper ${VERSION} ready`);
    }

    boot().catch(error => {
        console.error(`[💢 Answer Me] wrapper ${VERSION} failed`, error);
        window.toastr?.error?.(String(error?.message || error || '启动失败'), '💢 Answer Me');
    });
})();
