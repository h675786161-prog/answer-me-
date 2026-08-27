(() => {
    'use strict';

    const VERSION = '0.3.7-beta.19';
    const FLAG = '__answerMeCompactUiV19';
    const STYLE_ID = 'answer_me_compact_ui_style_v19';
    const UI_ID = 'answer_me_compact_ui_v19';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    let renderTimer = null;
    let observer = null;

    function ctx() {
        return window.SillyTavern?.getContext?.() ?? null;
    }

    function router() {
        return window.AnswerMeModelRouter ?? null;
    }

    function selector() {
        return window.AnswerMeSiteSelector ?? null;
    }

    function settings() {
        const c = ctx();
        if (!c) return null;
        c.extensionSettings.answerMe ??= {};
        const s = c.extensionSettings.answerMe;
        if (typeof s.compactSitesOpen !== 'boolean') s.compactSitesOpen = false;
        if (typeof s.compactAdvancedOpen !== 'boolean') s.compactAdvancedOpen = false;
        if (typeof s.keywordManualOpen !== 'boolean') s.keywordManualOpen = false;
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

    function familyOptions() {
        const r = router();
        const s = settings();
        if (!r?.classify || !s) return [];
        const mode = r.transportMode || 'stream';
        const map = new Map();
        for (const profile of profiles()) {
            const cached = s.modelCatalog?.[profile?.id];
            const models = Array.isArray(cached?.models) ? [...cached.models] : [];
            if (profile?.model) models.push(profile.model);
            for (const model of [...new Set(models.filter(Boolean).map(String))]) {
                let info;
                try { info = r.classify(profile.id, model); } catch { continue; }
                if (!info || info.ignored || info.transport !== mode || !info.family) continue;
                if (!map.has(info.family)) map.set(info.family, new Set());
                map.get(info.family).add(String(profile.id));
            }
        }
        return [...map.entries()]
            .map(([name, ids]) => ({ name, count: ids.size }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
    }

    function scanStats() {
        const s = settings();
        const all = profiles();
        const full = all.filter(p => s?.modelCatalog?.[p.id]?.fallback === false).length;
        return { full, total: all.length };
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #answer_me_model_router_v14{display:none!important}
            #answer_me_site_selector_v16{display:none!important}
            #${UI_ID}{margin:10px 0 12px;padding:11px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));border-radius:14px;background:linear-gradient(145deg,rgba(127,127,127,.075),rgba(127,127,127,.035));box-shadow:0 5px 18px rgba(0,0,0,.04)}
            #${UI_ID} .am19-top{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:9px}
            #${UI_ID} .am19-current{min-width:0;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
            #${UI_ID} .am19-current-main{font-weight:800;font-size:.96em}
            #${UI_ID} .am19-badge{font-size:.75em;opacity:.68;padding:2px 7px;border-radius:999px;background:rgba(127,127,127,.10)}
            #${UI_ID} .am19-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
            #${UI_ID} .am19-field{display:grid;gap:4px;min-width:0}
            #${UI_ID} .am19-field>span{font-size:.72em;opacity:.64;font-weight:700}
            #${UI_ID} select{width:100%;min-width:0;height:34px;padding:4px 30px 4px 9px;border-radius:9px;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:var(--black30a,rgba(127,127,127,.06));color:inherit}
            #${UI_ID} .am19-mode{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
            #${UI_ID} .am19-mode button,#${UI_ID} .am19-mini-btn{border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.14));background:rgba(127,127,127,.055);color:inherit;border-radius:9px;padding:7px 8px;cursor:pointer}
            #${UI_ID} .am19-mode button.is-active{font-weight:800;background:rgba(127,127,127,.19);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
            #${UI_ID} .am19-mode button:disabled,#${UI_ID} .am19-mini-btn:disabled{opacity:.42;cursor:wait}
            #${UI_ID} .am19-section{margin-top:9px;padding-top:9px;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.09))}
            #${UI_ID} .am19-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;user-select:none}
            #${UI_ID} .am19-section-title{display:flex;align-items:center;gap:7px;font-size:.85em;font-weight:750}
            #${UI_ID} .am19-section-meta{font-size:.76em;opacity:.62;white-space:nowrap}
            #${UI_ID} .am19-sites{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px}
            #${UI_ID} .am19-site{min-width:0;text-align:left;border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));background:rgba(127,127,127,.045);color:inherit;border-radius:9px;padding:7px 8px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            #${UI_ID} .am19-site.is-on{font-weight:750;background:rgba(127,127,127,.15)}
            #${UI_ID} .am19-site.is-off{opacity:.42}
            #${UI_ID} .am19-site-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}
            #${UI_ID} .am19-link{border:0;background:transparent;color:inherit;opacity:.7;cursor:pointer;padding:1px 0;font-size:.78em}
            #${UI_ID} .am19-advanced{display:grid;gap:7px;margin-top:8px}
            #${UI_ID} .am19-advanced-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
            #${UI_ID} .am19-note{font-size:.75em;opacity:.58;line-height:1.45;word-break:break-word}
            #${UI_ID}.is-manual-open + #answer_me_model_router_v14{display:block!important;margin-top:8px!important;padding:8px!important;background:rgba(127,127,127,.035)!important}
            #${UI_ID}.is-manual-open + #answer_me_model_router_v14 > :not(.am18-manual){display:none!important}
            #${UI_ID}.is-manual-open + #answer_me_model_router_v14 .am18-manual{display:block!important;margin-top:0!important;padding-top:0!important;border-top:0!important}
            @media(max-width:700px){#${UI_ID}{padding:10px}#${UI_ID} .am19-sites{grid-template-columns:repeat(2,minmax(0,1fr))}#${UI_ID} .am19-current-main{font-size:.92em}}
        `;
        document.head.appendChild(style);
    }

    function rootAndAnchor() {
        const root = document.querySelector('#answer_me_settings');
        const old = root?.querySelector('#answer_me_model_router_v14');
        if (!root || !old) return {};
        let box = root.querySelector(`#${UI_ID}`);
        if (!box) {
            box = document.createElement('div');
            box.id = UI_ID;
            old.insertAdjacentElement('beforebegin', box);
        } else if (box.nextElementSibling !== old) {
            old.insertAdjacentElement('beforebegin', box);
        }
        return { root, old, box };
    }

    function currentSiteNames() {
        const sel = selector();
        const ids = Array.isArray(sel?.selectedIds) ? sel.selectedIds : [];
        return ids.map(id => profileById(id)?.name || '').filter(Boolean);
    }

    async function changeFamily(value, control) {
        if (!value || !router()?.setFamily) return;
        control.disabled = true;
        try { await router().setFamily(value); } finally { scheduleRender(); }
    }

    async function changeVersion(key, control) {
        if (!key || !router()?.select) return;
        control.disabled = true;
        try { await router().select(key); } finally { scheduleRender(); }
    }

    async function changeTransport(mode, control) {
        if (!router()?.setTransport || mode === router()?.transportMode) return;
        control.disabled = true;
        try { await router().setTransport(mode); } finally { scheduleRender(); }
    }

    function ensureManualPanelState(open) {
        const s = settings();
        if (!s) return;
        if (s.keywordManualOpen === open) return;
        const old = document.querySelector('#answer_me_model_router_v14');
        const manualButton = [...(old?.querySelectorAll('.am18-action') || [])]
            .find(btn => String(btn.textContent || '').includes('手动校正'));
        if (manualButton) {
            manualButton.click();
            return;
        }
        s.keywordManualOpen = open;
        saveSettings();
    }

    function render() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            const { box } = rootAndAnchor();
            const r = router();
            const sel = selector();
            const s = settings();
            if (!box || !r || !s) return;
            installStyle();

            const group = r.selected;
            const mode = r.transportMode || 'stream';
            const family = r.family || group?.family || '';
            const familyList = familyOptions();
            const versionList = Array.isArray(r.groups?.()) ? r.groups() : [];
            const eligible = Array.isArray(sel?.eligibleIds) ? sel.eligibleIds : [];
            const selected = new Set(Array.isArray(sel?.selectedIds) ? sel.selectedIds : []);
            const stats = scanStats();
            const siteNames = currentSiteNames();

            const signature = JSON.stringify({
                family, mode, group: group?.key || '',
                families: familyList.map(x => [x.name, x.count]),
                versions: versionList.map(x => [x.key, x.profileCount]),
                eligible, selected: [...selected],
                sitesOpen: s.compactSitesOpen,
                advancedOpen: s.compactAdvancedOpen,
                manualOpen: s.keywordManualOpen,
                stats,
            });
            if (box.dataset.signature === signature && box.childElementCount) return;
            box.dataset.signature = signature;
            box.classList.toggle('is-manual-open', !!s.keywordManualOpen);
            box.replaceChildren();

            const top = document.createElement('div');
            top.className = 'am19-top';
            const current = document.createElement('div');
            current.className = 'am19-current';
            const main = document.createElement('div');
            main.className = 'am19-current-main';
            main.textContent = group ? `${group.family} ${group.version}` : (family || '未选模型');
            const badge = document.createElement('span');
            badge.className = 'am19-badge';
            badge.textContent = mode === 'stream' ? '🟢 真流' : '📦 假流';
            const siteBadge = document.createElement('span');
            siteBadge.className = 'am19-badge';
            siteBadge.textContent = `${selected.size}/${eligible.length || 0} 家`;
            current.append(main, badge, siteBadge);
            top.appendChild(current);
            box.appendChild(top);

            const grid = document.createElement('div');
            grid.className = 'am19-grid';

            const familyField = document.createElement('label');
            familyField.className = 'am19-field';
            const familyLabel = document.createElement('span');
            familyLabel.textContent = '模型系列';
            const familySelect = document.createElement('select');
            for (const item of familyList) {
                const opt = document.createElement('option');
                opt.value = item.name;
                opt.textContent = `${item.name} · ${item.count}`;
                opt.selected = item.name === family;
                familySelect.appendChild(opt);
            }
            familySelect.addEventListener('change', () => void changeFamily(familySelect.value, familySelect));
            familyField.append(familyLabel, familySelect);

            const versionField = document.createElement('label');
            versionField.className = 'am19-field';
            const versionLabel = document.createElement('span');
            versionLabel.textContent = '版本';
            const versionSelect = document.createElement('select');
            for (const item of versionList) {
                const opt = document.createElement('option');
                opt.value = item.key;
                opt.textContent = `${item.version} · ${item.profileCount}家`;
                opt.selected = item.key === group?.key;
                versionSelect.appendChild(opt);
            }
            if (!versionList.length) {
                const opt = document.createElement('option');
                opt.textContent = '暂无可用版本';
                opt.value = '';
                versionSelect.appendChild(opt);
                versionSelect.disabled = true;
            }
            versionSelect.addEventListener('change', () => void changeVersion(versionSelect.value, versionSelect));
            versionField.append(versionLabel, versionSelect);
            grid.append(familyField, versionField);
            box.appendChild(grid);

            const modeRow = document.createElement('div');
            modeRow.className = 'am19-mode';
            for (const [value, text] of [['stream','🟢 真流式'],['fake','📦 假流式']]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = mode === value ? 'is-active' : '';
                btn.textContent = text;
                btn.addEventListener('click', () => void changeTransport(value, btn));
                modeRow.appendChild(btn);
            }
            box.appendChild(modeRow);

            const sitesSection = document.createElement('div');
            sitesSection.className = 'am19-section';
            const sitesHead = document.createElement('div');
            sitesHead.className = 'am19-section-head';
            const sitesTitle = document.createElement('div');
            sitesTitle.className = 'am19-section-title';
            sitesTitle.textContent = `${s.compactSitesOpen ? '▾' : '▸'} 参赛站`;
            const sitesMeta = document.createElement('div');
            sitesMeta.className = 'am19-section-meta';
            sitesMeta.textContent = `${selected.size}/${eligible.length} 家${!s.compactSitesOpen && siteNames.length ? ` · ${siteNames.slice(0,2).join('、')}${siteNames.length>2?'…':''}` : ''}`;
            sitesHead.append(sitesTitle, sitesMeta);
            sitesHead.addEventListener('click', () => {
                s.compactSitesOpen = !s.compactSitesOpen;
                saveSettings();
                scheduleRender();
            });
            sitesSection.appendChild(sitesHead);

            if (s.compactSitesOpen) {
                const sites = document.createElement('div');
                sites.className = 'am19-sites';
                for (const id of eligible) {
                    const p = profileById(id);
                    if (!p) continue;
                    const on = selected.has(String(id));
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = `am19-site ${on ? 'is-on' : 'is-off'}`;
                    btn.textContent = `${on ? '✓' : '○'} ${p.name || '未命名站'}`;
                    btn.addEventListener('click', async () => {
                        btn.disabled = true;
                        try { await sel?.toggle?.(id); } finally { scheduleRender(); }
                    });
                    sites.appendChild(btn);
                }
                sitesSection.appendChild(sites);
                const siteActions = document.createElement('div');
                siteActions.className = 'am19-site-actions';
                const all = document.createElement('button');
                all.type = 'button'; all.className = 'am19-link'; all.textContent = '全选可用站';
                all.addEventListener('click', async () => { await sel?.selectAll?.(); scheduleRender(); });
                const one = document.createElement('button');
                one.type = 'button'; one.className = 'am19-link'; one.textContent = '只留当前站';
                one.addEventListener('click', async () => { await sel?.onlyCurrent?.(); scheduleRender(); });
                siteActions.append(all, one);
                sitesSection.appendChild(siteActions);
            }
            box.appendChild(sitesSection);

            const advanced = document.createElement('div');
            advanced.className = 'am19-section';
            const advHead = document.createElement('div');
            advHead.className = 'am19-section-head';
            const advTitle = document.createElement('div');
            advTitle.className = 'am19-section-title';
            advTitle.textContent = `${s.compactAdvancedOpen ? '▾' : '▸'} 高级设置`;
            const advMeta = document.createElement('div');
            advMeta.className = 'am19-section-meta';
            advMeta.textContent = `${stats.full}/${stats.total} 家已扫描`;
            advHead.append(advTitle, advMeta);
            advHead.addEventListener('click', () => {
                s.compactAdvancedOpen = !s.compactAdvancedOpen;
                saveSettings();
                scheduleRender();
            });
            advanced.appendChild(advHead);

            if (s.compactAdvancedOpen) {
                const advBody = document.createElement('div');
                advBody.className = 'am19-advanced';
                const row = document.createElement('div');
                row.className = 'am19-advanced-row';
                const scan = document.createElement('button');
                scan.type = 'button'; scan.className = 'am19-mini-btn'; scan.textContent = '↻ 重扫模型';
                scan.addEventListener('click', async () => {
                    scan.disabled = true;
                    try { await r?.scan?.(true); } finally { scheduleRender(); }
                });
                const manual = document.createElement('button');
                manual.type = 'button'; manual.className = 'am19-mini-btn';
                manual.textContent = s.keywordManualOpen ? '收起手动校正' : '✎ 手动校正识别';
                manual.addEventListener('click', () => {
                    const next = !s.keywordManualOpen;
                    ensureManualPanelState(next);
                    s.keywordManualOpen = next;
                    saveSettings();
                    scheduleRender();
                });
                row.append(scan, manual);
                const note = document.createElement('div');
                note.className = 'am19-note';
                note.textContent = group?.keyword
                    ? `当前关键模型名：${group.keyword} · 原始模型 ID 和扫描细节默认收起来，不占地方。`
                    : '原始模型 ID 和扫描细节默认收起来，不占地方。';
                advBody.append(row, note);
                advanced.appendChild(advBody);
            }
            box.appendChild(advanced);
        }, 35);
    }

    function scheduleRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            renderTimer = null;
            render();
        }, 40);
    }

    function observe() {
        observer?.disconnect?.();
        const root = document.querySelector('#answer_me_settings');
        if (!root) return;
        observer = new MutationObserver(() => scheduleRender());
        observer.observe(root, { childList: true, subtree: true });
    }

    async function boot() {
        if (window[FLAG]) return;
        window[FLAG] = true;
        for (let i = 0; i < 140; i++) {
            if (ctx() && router()?.groups && selector() && document.querySelector('#answer_me_settings')) break;
            await sleep(100);
        }
        installStyle();
        render();
        observe();
        const timer = setInterval(render, 900);
        window.addEventListener('beforeunload', () => {
            clearInterval(timer);
            observer?.disconnect?.();
        }, { once: true });
        console.log(`[💢 Answer Me] compact UI ${VERSION} ready · dropdown-first control deck`);
    }

    boot().catch(error => {
        console.error('[💢 Answer Me] compact UI v19 startup failed', error);
        window.toastr?.error?.(String(error?.message || error || '紧凑控制面板启动失败'), '💢 Answer Me');
    });
})();
