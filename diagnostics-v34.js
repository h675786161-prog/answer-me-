(() => {
  'use strict';
  const VERSION = '0.5.0-beta.34';
  const FLAG = '__answerMeDiagnosticsV34';
  const WRAP_FLAG = '__answerMeDiagnosticsWrappedV34';
  const MAX_EVENTS = 320;
  if (window[FLAG]) return;
  window[FLAG] = true;

  const events = [];
  let seq = 0;
  const ctx = () => window.SillyTavern?.getContext?.() ?? null;
  const wall = () => new Date().toISOString();
  const perf = () => performance.now();

  function profile(id) {
    const list = ctx()?.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list.find(p => String(p?.id) === String(id)) : null;
  }

  function push(type, data = {}) {
    events.push({ t: wall(), type, ...data });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function keys(value) {
    try { return value && typeof value === 'object' ? Object.keys(value).slice(0, 24) : []; }
    catch { return []; }
  }

  function wrapService() {
    const service = ctx()?.ConnectionManagerRequestService;
    if (!service?.sendRequest || service[WRAP_FLAG]) return !!service?.[WRAP_FLAG];
    const original = service.sendRequest.bind(service);

    service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
      if (!custom?.answerMeRace) return await original(profileId, prompt, maxTokens, custom, overridePayload);

      const p = profile(profileId);
      const req = ++seq;
      const started = perf();
      const meta = {
        req,
        round: custom?.answerMeRoundId ?? null,
        candidate: String(custom?.answerMeCandidateId ?? profileId),
        attempt: String(custom?.answerMeAttempt || ''),
        profileId: String(profileId),
        profileName: String(p?.name || ''),
        model: String(p?.model || ''),
        api: String(p?.api || ''),
        stream: !!custom?.stream,
        promptShape: Array.isArray(prompt) ? `array:${prompt.length}` : typeof prompt,
        maxTokens: Number(maxTokens || 0),
      };
      push('dispatch', meta);

      let result;
      try {
        result = await original(profileId, prompt, maxTokens, custom, overridePayload);
        push('resolved', {
          ...meta,
          ms: Math.round(perf() - started),
          resultType: typeof result,
          resultKeys: keys(result),
          contentLen: typeof result?.content === 'string' ? result.content.length : 0,
          textLen: typeof result?.text === 'string' ? result.text.length : 0,
        });
      } catch (error) {
        push('request_error', {
          ...meta,
          ms: Math.round(perf() - started),
          error: String(error?.message || error || 'unknown'),
          name: String(error?.name || ''),
        });
        throw error;
      }

      if (typeof result !== 'function') return result;
      return function answerMeDiagnosticFactory() {
        const iterator = result();
        return (async function*() {
          let chunks = 0;
          let firstChunk = null;
          let firstText = null;
          let lastTextLen = 0;
          try {
            for await (const chunk of iterator) {
              chunks += 1;
              const elapsed = Math.round(perf() - started);
              if (firstChunk === null) firstChunk = elapsed;
              const text = String(chunk?.text ?? '');
              if (firstText === null && text.trim()) firstText = elapsed;
              const len = text.length;
              if (chunks <= 3 || len > lastTextLen || chunks % 25 === 0) {
                push('chunk', { ...meta, n: chunks, ms: elapsed, textLen: len, delta: len - lastTextLen, hasText: !!text.trim() });
              }
              lastTextLen = len;
              yield chunk;
            }
            push('stream_done', { ...meta, ms: Math.round(perf() - started), chunks, firstChunkMs: firstChunk, firstTextMs: firstText, finalTextLen: lastTextLen });
          } catch (error) {
            push('stream_error', { ...meta, ms: Math.round(perf() - started), chunks, firstChunkMs: firstChunk, firstTextMs: firstText, finalTextLen: lastTextLen, error: String(error?.message || error || 'unknown'), name: String(error?.name || '') });
            throw error;
          }
        })();
      };
    };

    service[WRAP_FLAG] = true;
    push('diagnostics_ready', { version: VERSION });
    return true;
  }

  function snapshot() {
    const c = ctx();
    const s = c?.extensionSettings?.answerMe ?? {};
    const r = window.AnswerMeModelRouter;
    const round = window.AnswerMe?.round;
    return {
      version: VERSION,
      transportMode: r?.transportMode || s.transportMode || '',
      selectedGroup: r?.selected?.key || s.selectedModelGroup || '',
      selectedKeyword: r?.selected?.keyword || '',
      selectedProfiles: Array.isArray(s.profileIds) ? s.profileIds.map(String) : [],
      currentProfileId: String(c?.extensionSettings?.connectionManager?.selectedProfile ?? ''),
      nativeStreamChecked: !!document.querySelector('#stream_toggle')?.checked,
      assignments: Array.isArray(s.lastModelAssignments) ? s.lastModelAssignments : [],
      activeRound: round ? {
        id: round.id,
        retryNo: round.retryNo,
        startedAt: round.startedAt,
        winner: round.winner?.name || '',
        candidates: [...round.candidates.values()].map(x => ({
          name: x.name,
          profileId: x.profileId,
          mode: x.mode,
          started: !!x.started,
          finished: !!x.finished,
          aborted: !!x.aborted,
          error: x.error || '',
          textLen: String(x.text || '').length,
          fallbackUsed: !!x.fallbackUsed,
        })),
      } : null,
    };
  }

  function text() {
    const snap = snapshot();
    return [
      '=== Answer Me 诊断信息 ===',
      `插件版本: ${VERSION}`,
      `时间: ${wall()}`,
      `传输模式: ${snap.transportMode}`,
      `模型档: ${snap.selectedGroup}`,
      `关键名: ${snap.selectedKeyword}`,
      `原生流式开关: ${snap.nativeStreamChecked}`,
      `当前 Profile: ${snap.currentProfileId}`,
      `参赛 Profile IDs: ${snap.selectedProfiles.join(', ')}`,
      '',
      '--- 当前模型分配 ---',
      JSON.stringify(snap.assignments, null, 2),
      '',
      '--- 当前赛马状态 ---',
      JSON.stringify(snap.activeRound, null, 2),
      '',
      '--- Answer Me 专属请求事件 ---',
      ...events.map((e, i) => `${String(i + 1).padStart(3, '0')} ${JSON.stringify(e)}`),
    ].join('\n');
  }

  async function copy() {
    const value = text();
    try {
      await navigator.clipboard.writeText(value);
      window.toastr?.success?.(`已复制 ${events.length} 条 Answer Me 诊断事件`, '🩺 Answer Me');
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (ok) window.toastr?.success?.(`已复制 ${events.length} 条 Answer Me 诊断事件`, '🩺 Answer Me');
        return ok;
      } catch {
        window.toastr?.error?.('复制失败，可在控制台调用 AnswerMeDiagnostics.text()', '🩺 Answer Me');
        return false;
      }
    }
  }

  function mountControls() {
    const host = document.querySelector('#answer_me_compact_ui_v23 .advanced')
      || document.querySelector('#answer_me_settings .answer-me-toolbar');
    if (!host) return false;
    if (!document.querySelector('#answer_me_copy_diag_v34')) {
      const copyBtn = document.createElement('button');
      copyBtn.id = 'answer_me_copy_diag_v34';
      copyBtn.type = 'button';
      copyBtn.className = host.classList.contains('advanced') ? 'mini' : 'menu_button';
      copyBtn.textContent = '🩺 复制诊断信息';
      copyBtn.addEventListener('click', e => { e.preventDefault(); void copy(); });
      host.appendChild(copyBtn);
    }
    if (!document.querySelector('#answer_me_clear_diag_v34')) {
      const clearBtn = document.createElement('button');
      clearBtn.id = 'answer_me_clear_diag_v34';
      clearBtn.type = 'button';
      clearBtn.className = host.classList.contains('advanced') ? 'mini' : 'menu_button';
      clearBtn.textContent = '清空诊断';
      clearBtn.addEventListener('click', e => { e.preventDefault(); events.length = 0; window.toastr?.info?.('诊断记录已清空', '🩺 Answer Me'); });
      host.appendChild(clearBtn);
    }
    return true;
  }

  window.AnswerMeDiagnostics = {
    version: VERSION,
    text,
    copy,
    clear() { events.length = 0; },
    get events() { return events.slice(); },
    snapshot,
  };

  let tries = 0;
  (function boot() {
    tries += 1;
    const wrapped = wrapService();
    const mounted = mountControls();
    if (wrapped && mounted) {
      console.log(`[💢 Answer Me] diagnostics ${VERSION} ready · race-only trace`);
      return;
    }
    if (tries < 80) setTimeout(boot, 200);
  })();
})();
