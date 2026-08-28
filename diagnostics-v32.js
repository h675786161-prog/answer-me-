(() => {
  'use strict';

  const VERSION = '0.4.10-beta.32';
  const FLAG = '__answerMeDiagnosticsV32';
  const WRAP_FLAG = '__answerMeDiagnosticsWrappedV32';
  const MAX_EVENTS = 500;
  if (window[FLAG]) return;
  window[FLAG] = true;

  const events = [];
  const heartbeats = new Map();
  let seq = 0;

  function ctx(){ return window.SillyTavern?.getContext?.() ?? null; }
  function now(){ return performance.now(); }
  function wall(){ return new Date().toISOString(); }
  function profiles(){
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  }
  function profile(id){ return profiles().find(p => String(p?.id) === String(id)); }
  function settings(){ return ctx()?.extensionSettings?.answerMe ?? {}; }
  function safeKeys(value){
    try { return value && typeof value === 'object' ? Object.keys(value).slice(0, 30) : []; }
    catch { return []; }
  }
  function textLen(value){ return typeof value === 'string' ? value.length : 0; }
  function push(type, data = {}){
    events.push({ t: wall(), type, ...data });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }
  function beat(profileId, data = {}){
    const key = String(profileId ?? '');
    if (!key) return null;
    const previous = heartbeats.get(key) ?? {};
    const next = { ...previous, ...data, profileId: key, at: Date.now() };
    heartbeats.set(key, next);
    return next;
  }

  function currentSnapshot(){
    const s = settings();
    const r = window.AnswerMeModelRouter;
    const selected = r?.selected;
    return {
      version: VERSION,
      transportMode: r?.transportMode || s.transportMode || '',
      family: r?.family || s.selectedModelFamily || '',
      selectedGroup: selected?.key || s.selectedModelGroup || '',
      selectedKeyword: selected?.keyword || '',
      selectedProfiles: Array.isArray(s.profileIds) ? s.profileIds.map(String) : [],
      currentProfileId: String(ctx()?.extensionSettings?.connectionManager?.selectedProfile ?? ''),
      nativeStreamChecked: !!document.querySelector('#stream_toggle')?.checked,
      assignments: Array.isArray(s.lastModelAssignments) ? s.lastModelAssignments : [],
    };
  }

  function exportText(){
    const snap = currentSnapshot();
    const lines = [
      '=== Answer Me 诊断信息 ===',
      `插件版本: ${VERSION}`,
      `时间: ${wall()}`,
      `传输模式: ${snap.transportMode}`,
      `模型系列: ${snap.family}`,
      `模型档: ${snap.selectedGroup}`,
      `关键名: ${snap.selectedKeyword}`,
      `原生流式开关: ${snap.nativeStreamChecked}`,
      `当前 Profile: ${snap.currentProfileId}`,
      `参赛 Profile IDs: ${snap.selectedProfiles.join(', ')}`,
      '',
      '--- 当前模型分配 ---',
      JSON.stringify(snap.assignments, null, 2),
      '',
      '--- Side Request 事件 ---',
      ...events.map((e, i) => `${String(i + 1).padStart(3, '0')} ${JSON.stringify(e)}`),
    ];
    return lines.join('\n');
  }

  async function copyDiagnostics(){
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
      window.toastr?.success?.(`已复制 ${events.length} 条诊断事件`, '🩺 Answer Me');
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) window.toastr?.success?.(`已复制 ${events.length} 条诊断事件`, '🩺 Answer Me');
        else throw new Error('copy failed');
        return ok;
      } catch (e) {
        window.toastr?.error?.('复制失败，请在控制台调用 AnswerMeDiagnostics.text()', '🩺 Answer Me');
        return false;
      }
    }
  }

  function mountButton(){
    const root = document.querySelector('#answer_me_settings');
    if (!root || root.querySelector('#answer_me_copy_diag_v32')) return;
    const host = root.querySelector('.answer-me-toolbar') || root;
    const btn = document.createElement('button');
    btn.id = 'answer_me_copy_diag_v32';
    btn.type = 'button';
    btn.className = 'menu_button';
    btn.textContent = '🩺 复制诊断信息';
    btn.title = '复制副请求派发、首 chunk、首正文、完成和报错信息';
    btn.addEventListener('click', copyDiagnostics);
    host.appendChild(btn);

    const clear = document.createElement('button');
    clear.id = 'answer_me_clear_diag_v32';
    clear.type = 'button';
    clear.className = 'menu_button';
    clear.textContent = '清空诊断';
    clear.addEventListener('click', () => {
      events.length = 0;
      window.toastr?.info?.('诊断记录已清空', '🩺 Answer Me');
    });
    host.appendChild(clear);
  }

  function wrapService(){
    const service = ctx()?.ConnectionManagerRequestService;
    if (!service?.sendRequest || service[WRAP_FLAG]) return false;

    const original = service.sendRequest.bind(service);
    service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}){
      const id = ++seq;
      const p = profile(profileId);
      const start = now();
      const meta = {
        req: id,
        profileId: String(profileId),
        profileName: String(p?.name || ''),
        model: String(p?.model || ''),
        api: String(p?.api || ''),
        apiUrlPresent: !!p?.['api-url'],
        secretIdPresent: !!p?.['secret-id'],
        requestedStream: !!custom?.stream,
        transportMode: String(window.AnswerMeModelRouter?.transportMode || settings().transportMode || ''),
        promptShape: Array.isArray(prompt) ? `array:${prompt.length}` : typeof prompt,
        maxTokens: Number(maxTokens || 0),
      };
      push('dispatch', meta);
      beat(profileId, { req: id, phase: 'dispatch', chunks: 0, textLen: 0, reasoningLen: 0, done: false });

      let result;
      try {
        result = await original(profileId, prompt, maxTokens, custom, overridePayload);
        push('sendRequest_resolved', {
          ...meta,
          ms: Math.round(now() - start),
          resultType: typeof result,
          resultKeys: safeKeys(result),
          contentLen: textLen(result?.content),
          textLen: textLen(result?.text),
          reasoningLen: textLen(result?.reasoning),
        });
        beat(profileId, { req: id, phase: 'resolved', done: false });
      } catch (error) {
        push('sendRequest_error', {
          ...meta,
          ms: Math.round(now() - start),
          error: String(error?.message || error || 'unknown'),
          name: String(error?.name || ''),
          stackHead: String(error?.stack || '').split('\n').slice(0, 3).join(' | '),
        });
        beat(profileId, { req: id, phase: 'error', done: true, error: String(error?.message || error || 'unknown') });
        throw error;
      }

      if (typeof result !== 'function') {
        beat(profileId, {
          req: id,
          phase: 'done',
          done: true,
          textLen: textLen(result?.content ?? result?.text),
          reasoningLen: textLen(result?.reasoning),
        });
        return result;
      }

      return function diagnosticFactory(){
        let source;
        try {
          source = result();
        } catch (error) {
          push('factory_error', { ...meta, ms: Math.round(now() - start), error: String(error?.message || error || 'unknown') });
          beat(profileId, { req: id, phase: 'error', done: true, error: String(error?.message || error || 'unknown') });
          throw error;
        }

        return (async function*(){
          let chunks = 0;
          let firstChunkAt = 0;
          let firstTextAt = 0;
          let lastTextLen = 0;
          push('factory_started', { ...meta, ms: Math.round(now() - start), iteratorType: typeof source, iteratorKeys: safeKeys(source) });
          beat(profileId, { req: id, phase: 'factory_started', chunks: 0, done: false });
          try {
            for await (const chunk of source) {
              chunks += 1;
              if (!firstChunkAt) firstChunkAt = now();
              const text = String(chunk?.text ?? '');
              const reasoning = String(chunk?.state?.reasoning ?? chunk?.reasoning ?? '');
              if (!firstTextAt && text.trim().length) firstTextAt = now();
              const event = {
                ...meta,
                n: chunks,
                ms: Math.round(now() - start),
                chunkType: typeof chunk,
                chunkKeys: safeKeys(chunk),
                stateKeys: safeKeys(chunk?.state),
                textLen: text.length,
                textDelta: text.length - lastTextLen,
                reasoningLen: reasoning.length,
                hasText: !!text.trim(),
              };
              beat(profileId, {
                req: id,
                phase: 'chunk',
                chunks,
                textLen: text.length,
                reasoningLen: reasoning.length,
                hasText: event.hasText,
                done: false,
              });
              if (chunks <= 5 || event.hasText || chunks % 20 === 0) push('chunk', event);
              lastTextLen = text.length;
              yield chunk;
            }
            push('stream_done', {
              ...meta,
              ms: Math.round(now() - start),
              chunks,
              firstChunkMs: firstChunkAt ? Math.round(firstChunkAt - start) : null,
              firstTextMs: firstTextAt ? Math.round(firstTextAt - start) : null,
              finalTextLen: lastTextLen,
            });
            beat(profileId, { req: id, phase: 'done', chunks, textLen: lastTextLen, done: true });
          } catch (error) {
            push('stream_error', {
              ...meta,
              ms: Math.round(now() - start),
              chunks,
              firstChunkMs: firstChunkAt ? Math.round(firstChunkAt - start) : null,
              firstTextMs: firstTextAt ? Math.round(firstTextAt - start) : null,
              finalTextLen: lastTextLen,
              error: String(error?.message || error || 'unknown'),
              name: String(error?.name || ''),
            });
            beat(profileId, { req: id, phase: 'error', chunks, textLen: lastTextLen, done: true, error: String(error?.message || error || 'unknown') });
            throw error;
          }
        })();
      };
    };

    service[WRAP_FLAG] = true;
    push('diagnostics_ready', { version: VERSION });
    return true;
  }

  window.AnswerMeDiagnostics = {
    version: VERSION,
    text: exportText,
    copy: copyDiagnostics,
    clear(){ events.length = 0; },
    heartbeat(profileId){
      const item = heartbeats.get(String(profileId ?? ''));
      return item ? { ...item } : null;
    },
    get events(){ return events.slice(); },
    get heartbeats(){ return [...heartbeats.values()].map(item => ({ ...item })); },
    snapshot: currentSnapshot,
  };

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    mountButton();
    const wrapped = wrapService();
    if ((wrapped || ctx()?.ConnectionManagerRequestService?.[WRAP_FLAG]) && document.querySelector('#answer_me_settings')) {
      if (tries > 10) clearInterval(timer);
    }
    if (tries >= 120) clearInterval(timer);
  }, 250);

  mountButton();
  wrapService();
  console.log(`[💢 Answer Me] diagnostics ${VERSION} ready · stream heartbeat enabled`);
})();
