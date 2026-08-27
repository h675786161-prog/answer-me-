(() => {
    'use strict';

    const VERSION = '0.3.0-beta.5';
    const POLL_MS = 180;

    let panel = null;
    let currentRoundId = null;
    let hiddenForRound = false;
    let lastWinnerName = '';
    let winnerFlashUntil = 0;
    let controlsInstalled = false;

    function getCtx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function getApi() {
        return window.AnswerMe ?? null;
    }

    function getCurrentProfile() {
        const ctx = getCtx();
        const currentId = ctx?.extensionSettings?.connectionManager?.selectedProfile;
        const profiles = ctx?.extensionSettings?.connectionManager?.profiles;
        if (!currentId || !Array.isArray(profiles)) return null;
        return profiles.find(profile => profile?.id === currentId) ?? null;
    }

    function compactError(text) {
        const value = String(text || '请求失败');
        if (/429|too many requests|resource exhausted/i.test(value)) return '429 · 抬走';
        if (/abort|扇死|冷暴力/i.test(value)) return '冷暴力 · 已扇死';
        if (/空回/i.test(value)) return '空回';
        if (/timeout|超时/i.test(value)) return '超时';
        return value.length > 24 ? `${value.slice(0, 22)}…` : value;
    }

    function markCurrentProfile() {
        const current = getCurrentProfile();
        const box = document.querySelector('#answer_me_profiles');
        if (!box) return;

        for (const row of box.querySelectorAll('.answer-me-profile')) {
            const checkbox = row.querySelector('input[type="checkbox"]');
            const state = row.querySelector('.answer-me-profile-state');
            if (!checkbox) continue;

            const isCurrent = !!current && checkbox.value === current.id;
            row.toggleAttribute('data-answer-me-current', isCurrent);

            if (isCurrent) {
                checkbox.checked = true;
                checkbox.disabled = true;
                if (state) state.textContent = '本家 · 自动参赛';
            } else if (row.dataset.answerMeWasCurrent === '1') {
                checkbox.disabled = false;
                if (state) state.textContent = '可参赛';
            }

            row.dataset.answerMeWasCurrent = isCurrent ? '1' : '0';
        }
    }

    function replaceLegacyCloseButton() {
        if (!panel || controlsInstalled) return;
        const head = panel.querySelector('.answer-me-float-head');
        const oldButton = panel.querySelector('#answer_me_abort');
        if (!head || !oldButton) return;

        // 旧版 × 的含义是“终止所有请求”，很容易误点。
        // clone 掉匿名监听器后，× 只负责把 HUD 收起来。
        const hideButton = oldButton.cloneNode(true);
        hideButton.id = 'answer_me_hide';
        hideButton.title = '收起状态面板';
        hideButton.textContent = '×';
        oldButton.replaceWith(hideButton);

        const stopButton = document.createElement('button');
        stopButton.type = 'button';
        stopButton.id = 'answer_me_stop';
        stopButton.title = '终止本轮赛马和后续重试';
        stopButton.textContent = '■';
        head.insertBefore(stopButton, hideButton);

        hideButton.addEventListener('click', event => {
            event.stopPropagation();
            hiddenForRound = true;
            panel.classList.add('answer-me-user-hidden');
        });

        stopButton.addEventListener('click', event => {
            event.stopPropagation();
            hiddenForRound = false;
            try { getApi()?.abort?.(); } catch (error) {
                console.warn('[💢 Answer Me] stop failed', error);
            }
        });

        head.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            if (panel.classList.contains('is-idle')) return;
            panel.classList.toggle('answer-me-manual-compact');
        });

        controlsInstalled = true;
    }

    function candidateList(round) {
        if (!round?.candidates) return [];
        try { return [...round.candidates.values()]; } catch { return []; }
    }

    function candidateLabel(candidate) {
        if (!candidate) return '';
        if (candidate.isOriginal) {
            const current = getCurrentProfile();
            return current?.name ? `${current.name} · 本家` : '当前酒馆 · 本家';
        }
        return candidate.name || candidate.profile?.name || '未命名站';
    }

    function candidateState(candidate) {
        if (candidate?.winner) return '抢答成功';
        if (candidate?.aborted) return compactError(candidate.error || '冷暴力，已扇死');
        if (candidate?.error) return compactError(candidate.error);
        if (candidate?.finished) return '已完成 · Swipe';
        if (candidate?.started) return '吐字中';
        return '等首字';
    }

    function decorateRows(round) {
        if (!panel || !round) return;
        const rows = [...panel.querySelectorAll('.answer-me-status-row')];
        const candidates = candidateList(round);

        rows.forEach((row, index) => {
            const candidate = candidates[index];
            if (!candidate) return;

            row.classList.toggle('is-started', !!candidate.started && !candidate.finished && !candidate.error && !candidate.aborted);
            row.classList.toggle('is-cold', !candidate.started && !candidate.finished && !candidate.error && !candidate.aborted);
            row.classList.toggle('is-dead', !!candidate.aborted || !!candidate.error);
            row.classList.toggle('is-finished', !!candidate.finished && !candidate.winner);

            const name = row.querySelector('.answer-me-status-name');
            const msg = row.querySelector('.answer-me-status-msg');
            if (name) name.textContent = candidateLabel(candidate);
            if (msg) msg.textContent = candidateState(candidate);
        });
    }

    function setHeadTitle(text) {
        const title = panel?.querySelector('.answer-me-float-head > span');
        if (title) title.textContent = text;
    }

    function showPanel() {
        if (!panel) return;
        panel.classList.remove('hidden');
    }

    function syncHud() {
        panel = panel || document.querySelector('#answer_me_float_panel');
        if (!panel) return;

        replaceLegacyCloseButton();
        markCurrentProfile();

        const api = getApi();
        const settings = api?.settings;
        const round = api?.round;
        const retry = api?.retry;

        if (!settings?.enabled || !settings?.showFloatingStatus) {
            panel.classList.add('hidden');
            return;
        }

        if (round?.id !== currentRoundId) {
            currentRoundId = round?.id ?? null;
            hiddenForRound = false;
            panel.classList.remove('answer-me-user-hidden', 'answer-me-manual-compact');
        }

        if (round) {
            showPanel();
            panel.classList.remove('is-idle', 'is-retry');
            panel.classList.add('is-active');
            panel.classList.toggle('answer-me-user-hidden', hiddenForRound);

            const candidates = candidateList(round);
            const retryTag = round.retryNo > 0 ? ` · 追杀 ${round.retryNo}` : '';
            setHeadTitle(`💢 Answer Me · ${candidates.length} 家开赛${retryTag}`);

            const meta = panel.querySelector('#answer_me_float_meta');
            if (meta) {
                const opened = candidates.filter(c => c.started && !c.error && !c.aborted).length;
                const cold = candidates.filter(c => !c.started && !c.finished && !c.error && !c.aborted).length;
                meta.textContent = `🟢 ${opened} 已开口 · ⚫ ${cold} 等首字`;
            }

            const stop = panel.querySelector('#answer_me_stop');
            if (stop) stop.hidden = false;
            decorateRows(round);

            if (round.winner?.name || round.winner?.isOriginal) {
                lastWinnerName = candidateLabel(round.winner);
                winnerFlashUntil = Date.now() + 2600;
            }
            return;
        }

        if (retry?.timer) {
            showPanel();
            panel.classList.remove('is-idle', 'is-active');
            panel.classList.add('is-retry');
            panel.classList.toggle('answer-me-user-hidden', hiddenForRound);
            setHeadTitle('💢 Answer Me · 全军覆没，准备追杀');
            const stop = panel.querySelector('#answer_me_stop');
            if (stop) stop.hidden = false;
            return;
        }

        showPanel();
        panel.classList.remove('is-active', 'is-retry', 'answer-me-manual-compact', 'answer-me-user-hidden');
        panel.classList.add('is-idle');
        hiddenForRound = false;

        const stop = panel.querySelector('#answer_me_stop');
        if (stop) stop.hidden = true;

        if (lastWinnerName && Date.now() < winnerFlashUntil) {
            setHeadTitle(`🏆 ${lastWinnerName} 赢了`);
        } else {
            setHeadTitle('💢 Answer Me · 待机');
            lastWinnerName = '';
        }
    }

    function installObservers() {
        const settingsBox = document.querySelector('#answer_me_profiles');
        if (settingsBox && !settingsBox.dataset.answerMeUxObserved) {
            settingsBox.dataset.answerMeUxObserved = '1';
            new MutationObserver(markCurrentProfile).observe(settingsBox, { childList: true, subtree: true });
        }
    }

    const timer = setInterval(() => {
        syncHud();
        installObservers();
        if (window.AnswerMe && document.querySelector('#answer_me_float_panel')) {
            window.AnswerMe.uxVersion = VERSION;
        }
    }, POLL_MS);

    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
    console.log(`[💢 Answer Me] UX ${VERSION} ready`);
})();