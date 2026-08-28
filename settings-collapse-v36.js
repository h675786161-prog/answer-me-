(() => {
  'use strict';
  const VERSION = '0.5.2-beta.36';
  const FLAG = '__answerMeSettingsCollapseV36';
  const STYLE_ID = 'answer_me_settings_collapse_style_v36';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const settings = () => {
    const c = ctx();
    if (!c) return null;
    c.extensionSettings.answerMe ??= {};
    const s = c.extensionSettings.answerMe;
    if (typeof s.panelCollapsed !== 'boolean') s.panelCollapsed = false;
    return s;
  };
  const save = () => { try { ctx()?.saveSettingsDebounced?.(); } catch {} };

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #answer_me_settings.am-panel-collapsed > :not(.answer-me-head){display:none!important}
      #answer_me_settings .answer-me-head{position:relative}
      #answer_me_panel_toggle_v36{border:0;background:transparent;color:inherit;cursor:pointer;padding:4px 7px;margin-left:auto;border-radius:8px;font:inherit;opacity:.78;white-space:nowrap}
      #answer_me_panel_toggle_v36:hover{background:rgba(127,127,127,.10);opacity:1}
      #answer_me_settings.am-panel-collapsed .answer-me-head{margin-bottom:0!important}
      @media(max-width:700px){#answer_me_panel_toggle_v36{padding:6px 7px;font-size:.88em}}
    `;
    document.head.appendChild(style);
  }

  function apply(root) {
    const s = settings();
    if (!root || !s) return false;
    root.classList.toggle('am-panel-collapsed', !!s.panelCollapsed);
    const btn = root.querySelector('#answer_me_panel_toggle_v36');
    if (btn) {
      btn.textContent = s.panelCollapsed ? '▸ 展开赛马' : '▾ 收起赛马';
      btn.setAttribute('aria-expanded', String(!s.panelCollapsed));
      btn.title = s.panelCollapsed ? '展开 Answer Me 设置' : '收起 Answer Me 设置';
    }
    return true;
  }

  function mount() {
    installStyle();
    const root = document.querySelector('#answer_me_settings');
    const head = root?.querySelector('.answer-me-head');
    if (!root || !head) return false;
    let btn = root.querySelector('#answer_me_panel_toggle_v36');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'answer_me_panel_toggle_v36';
      btn.type = 'button';
      const switchRow = head.querySelector('.answer-me-switch-row');
      if (switchRow) head.insertBefore(btn, switchRow);
      else head.appendChild(btn);
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const s = settings();
        if (!s) return;
        s.panelCollapsed = !s.panelCollapsed;
        save();
        apply(root);
      });
    }
    return apply(root);
  }

  let tries = 0;
  (function boot() {
    tries += 1;
    if (mount()) {
      console.log(`[💢 Answer Me] settings collapse ${VERSION} ready · whole panel fold restored`);
      return;
    }
    if (tries < 80) setTimeout(boot, 200);
  })();
})();
