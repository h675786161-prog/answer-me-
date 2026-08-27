(() => {
    'use strict';

    const VERSION = '0.3.4-beta.16';
    const FLAG = '__answerMeSiteSelectorV16';
    const STYLE_ID = 'answer_me_site_selector_style_v16';
    const UI_ID = 'answer_me_site_selector_v16';
    const POLL_MS = 500;

    let busy = false;
    let lastSignature = '';
    let renderTimer = null;
    let sweepTimer = null;
    let observer = null;

    function ctx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function router() {
        return window.AnswerMeModelRouter ?? null;
    }

    function settings() {
        const c = ctx();
        if (!c) return null;
        c.extensionSettings.answerMe ??= {};
        const s = c.extensionSettings.answerMe;
        if (!Array.isArray(s.siteDisabledIds)) s.siteDisabledIds = [];
        s.siteDisabledIds = [...new Set(s.siteDisabledIds.map(String))];
        return s;
    }

    function saveSettings() {
        try { ctx()?.saveSettingsDebounced?.(); } catch {}
    }

    function profiles() {
        const list = ctx()?.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(list) ? list : [];
    }

    function profileById(id) {
        return profiles().find(p => String(p?.id) === String(id));
    }

    function eligibleIds() {
        const group = router()?.selected;
        if (!group?.matches?.keys) return [];
        return [...group.matches.keys()].map(String);
    }

    function disabledSet() {
        return new Set(settings()?.siteDisabledIds || []);
    }

    function selectedIds() {
        const disabled = disabledSet();
        return eligibleIds().filter(id => !disabled.has(id));
    }

    function currentProfileId() {
        return String(ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? '');
    }

    async function waitProfileApply(timeout = 6000) {
        const spinner = document.querySelector('#connection_profile_spinner');
        if (!spinner) {
            await new Promise(resolve => setTimeout(resolve, 420));
            return;
        }
        const started = Date.now();
        let sawBusy = !spinner.classList.contains('hidden');
        while (Date.now() - started < timeout) {
            if (!spinner.classList.contains('hidden')) sawBusy = true;
            if (sawBusy && spinner.classList.contains('hidden')) return;
            await new Promise(resolve => setTimeout(resolve, 80));
        }
    }

    async function ensureCurrentAllowed(allowedIds) {
        if (!allowedIds.length) return false;
        const current = currentProfileId();
        if (allowedIds.includes(current)) return true;

        const target = profileById(allowedIds[0]);
        if (!target) return false;
        const select = document.querySelector('#connection_profiles');
        if (select) {
            select.value = target.id;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            await waitProfileApply();
        } else {
            ctx().extensionSettings.connectionManager.selectedProfile = target.id;
            saveSettings();
        }
        return true;
    }

    function rebuildAssignments(allowedIds) {
        const s = settings();
        const group = router()?.selected;
        if (!s || !group?.matches?.get) return;
        const mode = router()?.transportMode || s.transportMode || 'stream';
        s.lastModelAssignments = allowedIds.map(id => {
            const profile = profileById(id);
            const candidates = group.matches.get(id) || [];
            const model = candidates.includes(profile?.model) ? profile.model : (candidates[0] || profile?.model || '');
            return {
                profile: profile?.name || id,
                model,
                transportMode: mode,
            };
        }).filter(x => x.model);
        s.lastModelAssignmentsTransport = mode;
    }

    async function applySiteFilter({ forceCurrent = true, notify = false } = {}) {
        if (busy) return false;
        const s = settings();
        const eligible = eligibleIds();
        if (!s || !eligible.length) return false;

        const allowed = selectedIds();
        if (!allowed.length) {
            const restoreId = eligible[0];
            s.siteDisabledIds = s.siteDisabledIds.filter(id => id !== restoreId);
            allowed.push(restoreId);
            if (notify) window.toastr?.warning?.('至少得留一家参赛，已经把第一家放回来了。', '💢 Answer Me');
        }

        const existing = Array.isArray(s.profileIds) ? s.profileIds.map(String) : [];
        const same = existing.length === allowed.length && existing.every((id, index) => id === allowed[index]);
        const currentOkay = allowed.includes(currentProfileId());
        if (same && (!forceCurrent || currentOkay)) return false;

        busy = true;
        try {
            s.profileIds = [...allowed];
            rebuildAssignments(allowed);
            saveSettings();
            try { window.AnswerMe?.refresh?.(); } catch {}
            if (forceCurrent) await ensureCurrentAllowed(allowed);
            return true;
        } finally {
            busy = false;
        }
    }

    async function toggleSite(id) {
        const s = settings();
        const eligible = eligibleIds();
        id = String(id);
        if (!s || !eligible.includes(id)) return;

        const disabled = disabledSet();
        const currentlySelected = !disabled.has(id);
        const selected = selectedIds();
        if (currentlySelected && selected.length <= 1) {
            window.toastr?.warning?.('至少留一家参赛；不然当前酒馆请求没地方挂。', '💢 Answer Me');
            return;
        }

        if (currentlySelected) disabled.add(id);
        else disabled.delete(id);
        s.siteDisabledIds = [...disabled];
        saveSettings();
        await applySiteFilter({ forceCurrent: true });
        lastSignature = '';
        render();
    }

    async function selectAllEligible() {
        const s = settings();
        if (!s) return;
        const eligible = new Set(eligibleIds());
        s.siteDisabledIds = s.siteDisabledIds.filter(id => !eligible.has(String(id)));
        saveSettings();
        await applySiteFilter({ forceCurrent: true });
        lastSignature = '';
        render();
    }

    async function selectOnlyCurrent() {
        const s = settings();
        const eligible = eligibleIds();
        if (!s || !eligible.length) return;
        const current = eligible.includes(currentProfileId()) ? currentProfileId() : eligible[0];
        const disabled = disabledSet();
        for (const id of eligible) {
            if (id === current) disabled.delete(id);
            else disabled.add(id);
        }
        s.siteDisabledIds = [...disabled];
        saveSettings();
        await applySiteFilter({ forceCurrent: true });
        lastSignature = '';
        render();
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${UI_ID}{margin:0 0 12px;padding:10px;border-radius:11px;background:rgba(127,127,127,.055);border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            #${UI_ID} .am16-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
            #${UI_ID} .am16-label{font-weight:750;font-size:.9em;min-width:76px}
            #${UI_ID} .am16-count{font-size:.82em;opacity:.62}
            #${UI_ID} .am16-sites{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
            #${UI_ID} .am16-site{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.07);color:inherit;border-radius:9px;padding:6px 9px;cursor:pointer;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            #${UI_ID} .am16-site.is-active{font-weight:750;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
            #${UI_ID} .am16-site.is-off{opacity:.42;text-decoration:line-through}
            #${UI_ID} .am16-site:disabled{opacity:.35;cursor:wait}
            #${UI_ID} .am16-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}
            #${UI_ID} .am16-action{border:0;background:transparent;color:inherit;opacity:.72;cursor:pointer;padding:1px 0;font-size:.8em}
            #${UI_ID} .am16-note{margin-top:5px;font-size:.76em;opacity:.58;line-height:1.4}
            @media(max-width:700px){#${UI_ID} .am16-label{min-width:auto}#${UI_ID} .am16-site{padding:7px 9px;max-width:calc(50vw - 34px)}}
        `;
        document.head.appendChild(style);
    }

    function modelForProfile(group, profileId) {
        const candidates = group?.matches?.get?.(profileId) || [];
        const profile = profileById(profileId);
        if (!candidates.length) return profile?.model || '';
        if (candidates.includes(profile?.model)) return profile.model;
        return candidates[0];
    }

    function mountBox() {
        const root = document.querySelector('#answer_me_settings');
        const anchor = root?.querySelector('#answer_me_model_router_v14');
        if (!root || !anchor) return null;

        // v15 挂在 v14 内部，会被 v14 的 innerHTML 重建反复吃掉；热更新时先清掉旧节点。
        document.querySelector('#answer_me_site_selector_v15')?.remove();

        let box = root.querySelector(`#${UI_ID}`);
        if (!box) {
            box = document.createElement('div');
            box.id = UI_ID;
        }
        // 必须是 v14 的兄弟节点，不能再塞进 v14 里面。
        if (box.parentElement !== root || box.previousElementSibling !== anchor) {
            anchor.insertAdjacentElement('afterend', box);
        }
        return box;
    }

    function render() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            const group = router()?.selected;
            const box = mountBox();
            if (!box || !group) return;
            installStyle();

            const eligible = eligibleIds();
            const selected = new Set(selectedIds());
            const sig = JSON.stringify({
                group: group?.key || '',
                mode: router()?.transportMode || '',
                eligible,
                selected: [...selected],
                current: currentProfileId(),
            });
            if (box.dataset.signature === sig && box.childElementCount) return;
            box.dataset.signature = sig;
            box.replaceChildren();

            const head = document.createElement('div');
            head.className = 'am16-head';
            const label = document.createElement('div');
            label.className = 'am16-label';
            label.textContent = '参赛站';
            const count = document.createElement('div');
            count.className = 'am16-count';
            count.textContent = `${selected.size}/${eligible.length} 家已选`;
            head.append(label, count);

            const sites = document.createElement('div');
            sites.className = 'am16-sites';
            for (const id of eligible) {
                const profile = profileById(id);
                if (!profile) continue;
                const on = selected.has(id);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am16-site ${on ? 'is-active' : 'is-off'}`;
                btn.textContent = `${on ? '✓' : '○'} ${profile.name || '未命名站'}`;
                const model = modelForProfile(group, id);
                btn.title = model ? `${profile.name || '未命名站'}\n${model}` : (profile.name || '未命名站');
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    await toggleSite(id);
                });
                sites.appendChild(btn);
            }

            const actions = document.createElement('div');
            actions.className = 'am16-actions';
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'am16-action';
            all.textContent = '全选当前可用站';
            all.addEventListener('click', async () => await selectAllEligible());
            const one = document.createElement('button');
            one.type = 'button';
            one.className = 'am16-action';
            one.textContent = '只留当前站';
            one.addEventListener('click', async () => await selectOnlyCurrent());
            actions.append(all, one);

            const note = document.createElement('div');
            note.className = 'am16-note';
            note.textContent = '模型/真假流决定“哪些站有资格”，这里再决定“今天到底让哪几家上场”。';
            box.append(head, sites, actions, note);
        }, 25);
    }

    function signature() {
        const r = router();
        const group = r?.selected;
        const s = settings();
        const eligible = group?.matches?.keys ? [...group.matches.keys()].map(String).sort() : [];
        return JSON.stringify({
            group: group?.key || '',
            mode: r?.transportMode || '',
            eligible,
            disabled: [...(s?.siteDisabledIds || [])].map(String).sort(),
            profileIds: [...(s?.profileIds || [])].map(String).sort(),
            current: currentProfileId(),
        });
    }

    async function sweep() {
        if (busy) return;
        const r = router();
        const group = r?.selected;
        if (!r || !group) return;

        const sig = signature();
        const missingUi = !document.querySelector(`#${UI_ID}`);
        if (sig !== lastSignature) {
            await applySiteFilter({ forceCurrent: true });
            lastSignature = signature();
            render();
        } else if (missingUi) {
            render();
        }
    }

    function scheduleSweep() {
        if (sweepTimer) clearTimeout(sweepTimer);
        sweepTimer = setTimeout(() => {
            sweepTimer = null;
            void sweep();
        }, 30);
    }

    function observeRouter() {
        observer?.disconnect?.();
        const root = document.querySelector('#answer_me_settings');
        if (!root) return;
        observer = new MutationObserver(() => scheduleSweep());
        observer.observe(root, { childList: true, subtree: true });
    }

    window.AnswerMeSiteSelector = {
        version: VERSION,
        get eligibleIds() { return eligibleIds(); },
        get selectedIds() { return selectedIds(); },
        get disabledIds() { return [...disabledSet()]; },
        toggle: toggleSite,
        selectAll: selectAllEligible,
        onlyCurrent: selectOnlyCurrent,
        apply: applySiteFilter,
    };

    async function boot() {
        if (window[FLAG]) return;
        window[FLAG] = true;
        for (let i = 0; i < 120; i++) {
            if (ctx() && router()?.selected && document.querySelector('#answer_me_model_router_v14')) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        installStyle();
        await sweep();
        observeRouter();
        const timer = setInterval(() => { void sweep(); }, POLL_MS);
        window.addEventListener('beforeunload', () => {
            clearInterval(timer);
            observer?.disconnect?.();
        }, { once: true });
        console.log(`[💢 Answer Me] site selector ${VERSION} ready · stable sibling mount, no flicker rebuild`);
    }

    boot().catch(error => {
        console.error('[💢 Answer Me] site selector v16 startup failed', error);
        window.toastr?.error?.(String(error?.message || error || '参赛站选择器启动失败'), '💢 Answer Me');
    });
})();
