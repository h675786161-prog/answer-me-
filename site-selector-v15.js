(() => {
    'use strict';

    const VERSION = '0.3.3-beta.15';
    const FLAG = '__answerMeSiteSelectorV15';
    const STYLE_ID = 'answer_me_site_selector_style_v15';
    const UI_ID = 'answer_me_site_selector_v15';
    const POLL_MS = 260;

    let busy = false;
    let lastSignature = '';
    let renderTimer = null;

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

    function updateAssignmentsForAllowed(allowedIds) {
        const s = settings();
        if (!s || !Array.isArray(s.lastModelAssignments)) return;
        const allowedNames = new Set(allowedIds.map(id => profileById(id)?.name).filter(Boolean));
        s.lastModelAssignments = s.lastModelAssignments.filter(item => allowedNames.has(item?.profile));
    }

    async function applySiteFilter({ forceCurrent = true, notify = false } = {}) {
        if (busy) return;
        const s = settings();
        const r = router();
        const eligible = eligibleIds();
        if (!s || !r || !eligible.length) return;

        const allowed = selectedIds();
        if (!allowed.length) {
            const restoreId = eligible[0];
            s.siteDisabledIds = s.siteDisabledIds.filter(id => id !== restoreId);
            allowed.push(restoreId);
            if (notify) window.toastr?.warning?.('赛马至少要留一家作为当前酒馆请求，已经把第一家放回来了。', '💢 Answer Me');
        }

        const existing = Array.isArray(s.profileIds) ? s.profileIds.map(String) : [];
        const same = existing.length === allowed.length && existing.every((id, index) => id === allowed[index]);
        if (same && (!forceCurrent || allowed.includes(currentProfileId()))) return;

        busy = true;
        try {
            s.profileIds = allowed;
            updateAssignmentsForAllowed(allowed);
            saveSettings();
            try { window.AnswerMe?.refresh?.(); } catch {}
            if (forceCurrent) await ensureCurrentAllowed(allowed);
        } finally {
            busy = false;
            render();
        }
    }

    async function toggleSite(id) {
        const s = settings();
        const eligible = eligibleIds();
        if (!s || !eligible.includes(String(id))) return;
        const disabled = disabledSet();
        const currentlySelected = !disabled.has(String(id));
        const selected = selectedIds();

        if (currentlySelected && selected.length <= 1) {
            window.toastr?.warning?.('至少留一家参赛；当前酒馆请求不能凭空消失。', '💢 Answer Me');
            return;
        }

        if (currentlySelected) disabled.add(String(id));
        else disabled.delete(String(id));
        s.siteDisabledIds = [...disabled];
        saveSettings();
        await applySiteFilter({ forceCurrent: true });
    }

    async function selectAllEligible() {
        const s = settings();
        if (!s) return;
        const eligible = new Set(eligibleIds());
        s.siteDisabledIds = s.siteDisabledIds.filter(id => !eligible.has(String(id)));
        saveSettings();
        await applySiteFilter({ forceCurrent: true });
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
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${UI_ID}{margin-top:9px;padding-top:9px;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.10))}
            #${UI_ID} .am15-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
            #${UI_ID} .am15-label{font-weight:750;font-size:.9em;min-width:76px}
            #${UI_ID} .am15-count{font-size:.82em;opacity:.62}
            #${UI_ID} .am15-sites{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
            #${UI_ID} .am15-site{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.07);color:inherit;border-radius:9px;padding:6px 9px;cursor:pointer;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            #${UI_ID} .am15-site.is-active{font-weight:750;background:rgba(127,127,127,.20);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
            #${UI_ID} .am15-site.is-off{opacity:.42;text-decoration:line-through}
            #${UI_ID} .am15-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}
            #${UI_ID} .am15-action{border:0;background:transparent;color:inherit;opacity:.72;cursor:pointer;padding:1px 0;font-size:.8em}
            #${UI_ID} .am15-note{margin-top:5px;font-size:.76em;opacity:.58;line-height:1.4}
            @media(max-width:700px){#${UI_ID} .am15-label{min-width:auto}#${UI_ID} .am15-site{padding:7px 9px;max-width:calc(50vw - 34px)}}
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

    function render() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            const host = document.querySelector('#answer_me_model_router_v14');
            const group = router()?.selected;
            if (!host || !group) return;
            installStyle();

            let box = host.querySelector(`#${UI_ID}`);
            if (!box) {
                box = document.createElement('div');
                box.id = UI_ID;
                host.appendChild(box);
            }

            const eligible = eligibleIds();
            const selected = new Set(selectedIds());
            box.innerHTML = '';

            const head = document.createElement('div');
            head.className = 'am15-head';
            const label = document.createElement('div');
            label.className = 'am15-label';
            label.textContent = '参赛站';
            const count = document.createElement('div');
            count.className = 'am15-count';
            count.textContent = `${selected.size}/${eligible.length} 家已选`;
            head.append(label, count);

            const sites = document.createElement('div');
            sites.className = 'am15-sites';
            for (const id of eligible) {
                const profile = profileById(id);
                if (!profile) continue;
                const on = selected.has(id);
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `am15-site ${on ? 'is-active' : 'is-off'}`;
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
            actions.className = 'am15-actions';
            const all = document.createElement('button');
            all.type = 'button';
            all.className = 'am15-action';
            all.textContent = '全选当前可用站';
            all.addEventListener('click', async () => await selectAllEligible());
            const one = document.createElement('button');
            one.type = 'button';
            one.className = 'am15-action';
            one.textContent = '只留当前站';
            one.addEventListener('click', async () => await selectOnlyCurrent());
            actions.append(all, one);

            const note = document.createElement('div');
            note.className = 'am15-note';
            note.textContent = '先选模型/真假流，再点这里决定哪些站参赛；换版本时会记住你禁掉的站。';

            box.append(head, sites, actions, note);
        }, 35);
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
        const r = router();
        const group = r?.selected;
        if (!r || !group) return;
        const sig = signature();
        if (sig !== lastSignature) {
            lastSignature = sig;
            await applySiteFilter({ forceCurrent: true });
            render();
            lastSignature = signature();
        } else {
            render();
        }
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
            if (ctx() && router()?.selected) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        installStyle();
        await sweep();
        const timer = setInterval(() => { void sweep(); }, POLL_MS);
        window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
        console.log(`[💢 Answer Me] site selector ${VERSION} ready · 模型自动换，站点仍可手动选`);
    }

    boot().catch(error => {
        console.error('[💢 Answer Me] site selector v15 startup failed', error);
        window.toastr?.error?.(String(error?.message || error || '参赛站选择器启动失败'), '💢 Answer Me');
    });
})();