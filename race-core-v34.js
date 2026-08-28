(() => {
  'use strict';

  const EXT = 'answerMe';
  const VERSION = '0.5.0-beta.34';
  const DISPLAY = '💢 Answer Me';
  const RETRY_DELAYS = [2000, 5000, 12000, 25000];
  const STREAM_ACTIVITY_TIMEOUT_MS = 12000;
  const STARTED_STALL_MS = 18000;
  const ORIGINAL_STALL_MS = 20000;
  const STATUS_TICK_MS = 1000;

  const defaults = {
    enabled: false,
    profileIds: [],
    maxTokens: 0,
    coldTimeoutMs: 90000,
    keepStartedAsSwipes: true,
    killColdAfterWinner: true,
    showFloatingStatus: true,
    autoRetryEnabled: true,
    maxRetryRounds: 4,
    minMeaningfulChars: 6,
  };

  let ctx = null;
  let settings = null;
  let bound = false;
  let settingsMounted = false;
  let generationSeq = 0;
  let currentGenerationType = null;
  let activeRound = null;
  let roundSeq = 0;
  let statusTimer = null;
  let renderTimer = null;
  let lastResult = '';
  let internalStopUntil = 0;

  const retryState = {
    count: 0,
    timer: null,
    dueAt: 0,
    nextGenerationIsRetry: false,
    lastReason: '',
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const now = () => Date.now();
  const getContext = () => window.SillyTavern?.getContext?.() ?? null;
  const log = (...args) => console.log(`[${DISPLAY}]`, ...args);
  const warn = (...args) => console.warn(`[${DISPLAY}]`, ...args);

  function toast(type, message, title = DISPLAY) {
    try {
      window.toastr?.[type]?.(message, title, {
        preventDuplicates: true,
        timeOut: type === 'error' ? 8000 : 4200,
      });
    } catch {}
  }

  function ensureSettings() {
    ctx = getContext();
    if (!ctx) return false;
    ctx.extensionSettings[EXT] ??= {};
    settings = ctx.extensionSettings[EXT];
    for (const [key, value] of Object.entries(defaults)) {
      if (settings[key] === undefined) settings[key] = structuredClone(value);
    }
    if (!Array.isArray(settings.profileIds)) settings.profileIds = [];
    settings.profileIds = [...new Set(settings.profileIds.map(String))];
    settings.maxRetryRounds = Math.max(0, Math.min(8, Number(settings.maxRetryRounds ?? 4)));
    settings.coldTimeoutMs = Math.max(15000, Math.min(300000, Number(settings.coldTimeoutMs || 90000)));
    settings.minMeaningfulChars = Math.max(1, Math.min(30, Number(settings.minMeaningfulChars || 6)));
    return true;
  }

  function saveSettings() {
    try { ctx?.saveSettingsDebounced?.(); } catch (e) { warn('保存设置失败', e); }
  }

  function profiles() {
    if (!ensureSettings()) return [];
    const list = ctx.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(list) ? list : [];
  }

  function profileById(id) {
    return profiles().find(p => String(p?.id) === String(id));
  }

  function currentProfileId() {
    return String(ctx?.extensionSettings?.connectionManager?.selectedProfile ?? '');
  }

  function service() {
    return ctx?.ConnectionManagerRequestService ?? null;
  }

  function isProfileUsable(profile) {
    const s = service();
    if (!s || !profile?.id) return false;
    try { return typeof s.isProfileSupported === 'function' ? s.isProfileSupported(profile) : true; }
    catch { return false; }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function normalizeForQuality(text) {
    let raw = String(text ?? '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();
    if (!raw) return '';
    const contentMatches = [...raw.matchAll(/<content\b[^>]*>([\s\S]*?)<\/content>/gi)];
    if (contentMatches.length) raw = contentMatches.map(m => m[1]).join('\n');
    return raw
      .replace(/<(?:think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|analysis)>/gi, ' ')
      .replace(/<details\b[^>]*>[\s\S]*?<\/details>/gi, ' ')
      .replace(/```(?:html|xml|text|txt|markdown|md)?/gi, ' ')
      .replace(/```/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(?:nbsp|ensp|emsp);/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function semanticCount(text) {
    const normalized = normalizeForQuality(text);
    if (!normalized) return 0;
    try { return (normalized.match(/[\p{L}\p{N}]/gu) || []).length; }
    catch { return (normalized.match(/[A-Za-z0-9\u3400-\u9FFF]/g) || []).length; }
  }

  function validReply(text) {
    const normalized = normalizeForQuality(text).toLowerCase().replace(/\s+/g, '');
    if (['', '.', '..', '...', '…', '……', '-', '--', 'null', 'undefined', 'none', '[done]', 'done', 'error', 'empty', '空回', '无回复', '暂无回复', 'n/a', 'na'].includes(normalized)) return false;
    return semanticCount(text) >= Number(settings?.minMeaningfulChars || 6);
  }

  function latestAssistant() {
    const chat = ctx?.chat;
    const message = Array.isArray(chat) ? chat[chat.length - 1] : null;
    if (!message || message.is_user || message.is_system) return null;
    return message;
  }

  function latestAssistantText() {
    return String(latestAssistant()?.mes ?? '');
  }

  function clearRetryTimer() {
    if (retryState.timer) clearTimeout(retryState.timer);
    retryState.timer = null;
    retryState.dueAt = 0;
  }

  function resetRetryChain(reason = '') {
    clearRetryTimer();
    retryState.count = 0;
    retryState.nextGenerationIsRetry = false;
    retryState.lastReason = '';
    if (reason) log(`重试链清空：${reason}`);
  }

  function terminal(c) {
    return !!(c?.finished || c?.aborted || c?.error);
  }

  function allTerminal(round) {
    return [...round.candidates.values()].every(terminal);
  }

  function makeOriginalCandidate() {
    return {
      id: '__original__',
      profileId: currentProfileId(),
      name: '当前酒馆请求',
      isOriginal: true,
      controller: null,
      started: false,
      finished: false,
      aborted: false,
      error: '',
      text: '',
      winner: false,
      finishedAt: 0,
      mode: 'native',
    };
  }

  function makeSideCandidate(profile) {
    return {
      id: String(profile.id),
      profileId: String(profile.id),
      name: profile.name || String(profile.id),
      profile,
      isOriginal: false,
      controller: new AbortController(),
      attemptController: null,
      started: false,
      finished: false,
      aborted: false,
      error: '',
      text: '',
      winner: false,
      finishedAt: 0,
      mode: window.AnswerMeModelRouter?.transportMode || settings?.transportMode || 'stream',
      fallbackUsed: false,
      lastGrowthAt: 0,
    };
  }

  function chosenSideProfiles() {
    const current = currentProfileId();
    const wanted = new Set((settings?.profileIds || []).map(String));
    return profiles().filter(p => wanted.has(String(p.id)) && String(p.id) !== current && isProfileUsable(p));
  }

  function makeRound(prompt) {
    const round = {
      id: ++roundSeq,
      generationSeq,
      retryNo: retryState.count,
      type: currentGenerationType,
      startedAt: now(),
      prompt: structuredClone(prompt ?? ''),
      winner: null,
      mainInstalled: false,
      originalFinished: false,
      suppressOriginalStop: false,
      insertingWinner: false,
      queuedSwipes: [],
      candidates: new Map(),
      finalized: false,
      failureHandled: false,
      dismissed: false,
      coldTimer: null,
      originalStallTimer: null,
    };
    const original = makeOriginalCandidate();
    round.candidates.set(original.id, original);
    for (const p of chosenSideProfiles()) round.candidates.set(String(p.id), makeSideCandidate(p));
    return round;
  }

  function startStatusTimer() {
    if (statusTimer) return;
    statusTimer = setInterval(() => {
      if (!activeRound && !retryState.timer) {
        clearInterval(statusTimer);
        statusTimer = null;
        return;
      }
      scheduleRender();
    }, STATUS_TICK_MS);
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderFloatingStatus();
    }, 80);
  }

  function ensureFloatingPanel() {
    let panel = document.querySelector('#answer_me_float_panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'answer_me_float_panel';
    panel.className = 'answer-me-float hidden';
    panel.innerHTML = `
      <div class="answer-me-float-head">
        <span>💢 Answer Me</span>
        <button type="button" id="answer_me_abort" title="隐藏状态窗">×</button>
      </div>
      <div id="answer_me_float_meta" class="answer-me-float-meta"></div>
      <div id="answer_me_float_body" class="answer-me-float-body"></div>`;
    document.body.appendChild(panel);
    const close = panel.querySelector('#answer_me_abort');
    close.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (activeRound) activeRound.dismissed = true;
      panel.classList.add('hidden');
    });
    return panel;
  }

  function statusIcon(c) {
    if (c.winner) return '🏆';
    if (c.finished) return '✅';
    if (c.aborted) return '💥';
    if (c.error) return '❌';
    if (c.started) return '🟢';
    return '⚫';
  }

  function statusText(c) {
    if (c.winner) return '抢答成功';
    if (c.finished) return c.isOriginal ? '已完成' : (c.fallbackUsed ? '已完成 · 非流式回退' : '已完成 · Swipe');
    if (c.aborted) return c.error || '已断开';
    if (c.error) return c.error;
    if (c.started) return '已经开口，准许继续说';
    if (c.fallbackUsed) return '真流失败 · 正在整包抢救';
    return '零正文 token · 等待开口';
  }

  function renderFloatingStatus() {
    const panel = ensureFloatingPanel();
    const body = panel.querySelector('#answer_me_float_body');
    const meta = panel.querySelector('#answer_me_float_meta');
    if (!settings?.enabled || !settings?.showFloatingStatus) {
      panel.classList.add('hidden');
      return;
    }
    if (activeRound?.dismissed) {
      panel.classList.add('hidden');
      return;
    }
    if (!activeRound) {
      if (retryState.timer) {
        panel.classList.remove('hidden');
        const left = Math.max(0, (retryState.dueAt - now()) / 1000).toFixed(1);
        meta.textContent = `☠️ 全军覆没 · ${left}s 后第 ${retryState.count + 1} 次追杀`;
        body.innerHTML = `<div class="answer-me-idle">${escapeHtml(retryState.lastReason || '等待重试')}</div>`;
      } else {
        panel.classList.add('hidden');
      }
      return;
    }
    panel.classList.remove('hidden');
    const round = activeRound;
    const retryTag = round.retryNo ? ` · 第 ${round.retryNo} 次追杀` : '';
    meta.textContent = `第 ${round.id} 轮${retryTag}`;
    body.innerHTML = [...round.candidates.values()].map(c => {
      const end = c.finishedAt || now();
      const elapsed = ((end - round.startedAt) / 1000).toFixed(1);
      return `<div class="answer-me-status-row ${c.winner ? 'is-winner' : ''}">
        <span class="answer-me-status-icon">${statusIcon(c)}</span>
        <span class="answer-me-status-name">${escapeHtml(c.name)}</span>
        <span class="answer-me-status-msg">${escapeHtml(statusText(c))}</span>
        <span class="answer-me-status-time">${elapsed}s</span>
      </div>`;
    }).join('');
  }

  function abortCandidate(c, reason = '已断开') {
    if (!c || terminal(c)) return;
    c.aborted = true;
    c.error = reason;
    c.finishedAt = now();
    try { c.attemptController?.abort?.(reason); } catch {}
    try { c.controller?.abort?.(reason); } catch {}
    scheduleRender();
  }

  function abortRound(reason = 'cancelled', { stopOriginal = false, clearRetry = false } = {}) {
    const round = activeRound;
    if (!round) {
      if (clearRetry) resetRetryChain(reason);
      return;
    }
    if (round.coldTimer) clearTimeout(round.coldTimer);
    if (round.originalStallTimer) clearTimeout(round.originalStallTimer);
    for (const c of round.candidates.values()) {
      if (!c.isOriginal && !terminal(c)) abortCandidate(c, reason);
    }
    const original = round.candidates.get('__original__');
    if (original && !terminal(original)) {
      original.aborted = true;
      original.error = reason;
      original.finishedAt = now();
    }
    if (stopOriginal && !round.originalFinished) {
      round.suppressOriginalStop = true;
      internalStopUntil = now() + 1200;
      try { ctx?.stopGeneration?.(); } catch {}
    }
    activeRound = null;
    if (clearRetry) resetRetryChain(reason);
    scheduleRender();
  }

  function buildBaseInfo(message) {
    return Array.isArray(message?.swipe_info) && message.swipe_info[0]
      ? structuredClone(message.swipe_info[0])
      : { send_date: message?.send_date, gen_started: message?.gen_started, gen_finished: message?.gen_finished, extra: {} };
  }

  async function appendSwipe(text, sourceName) {
    text = String(text || '').trim();
    const message = latestAssistant();
    if (!message || !text) return;
    const main = String(message.mes ?? '');
    message.swipes = Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [main];
    if (!message.swipes.includes(main)) message.swipes.unshift(main);
    if (message.swipes.includes(text)) return;
    const base = buildBaseInfo(message);
    message.swipes.push(text);
    message.swipe_info = Array.isArray(message.swipe_info) ? message.swipe_info : [];
    while (message.swipe_info.length < message.swipes.length - 1) message.swipe_info.push(structuredClone(base));
    message.swipe_info.push({ ...structuredClone(base), gen_finished: new Date(), extra: { ...(base.extra || {}), answer_me_source: sourceName } });
    try { await ctx?.saveChat?.(); } catch {}
  }

  async function flushQueuedSwipes(round) {
    if (!round?.mainInstalled) return;
    const queued = round.queuedSwipes.splice(0);
    for (const item of queued) await appendSwipe(item.text, item.name);
  }

  async function installSideWinnerImmediately(round, c) {
    if (round !== activeRound || round.mainInstalled) return;
    round.mainInstalled = true;
    round.suppressOriginalStop = true;
    internalStopUntil = now() + 1200;
    try { ctx?.stopGeneration?.(); } catch {}
    await sleep(100);
    const last = latestAssistant();
    if (last && !last.is_user && !last.is_system) {
      try { await ctx?.deleteLastMessage?.(); } catch {}
    }
    round.insertingWinner = true;
    try {
      await ctx?.saveReply?.({ type: 'normal', getMessage: c.text });
      await ctx?.saveChat?.();
    } finally {
      round.insertingWinner = false;
    }
    const original = round.candidates.get('__original__');
    if (original && !terminal(original)) {
      original.aborted = true;
      original.error = '赢家已产生 · 原请求未开口已停止';
      original.finishedAt = now();
      round.originalFinished = true;
    }
    await flushQueuedSwipes(round);
    await maybeFinalize(round);
  }

  async function reorderWinnerOverOriginal(round, originalText) {
    if (round !== activeRound || !round.winner || round.winner.isOriginal) return;
    const message = latestAssistant();
    if (!message) return;
    const winnerText = String(round.winner.text || '').trim();
    const extras = [];
    const add = (text, name) => {
      text = String(text || '').trim();
      if (!text || text === winnerText || extras.some(x => x.text === text)) return;
      extras.push({ text, name });
    };
    add(originalText, '当前酒馆请求');
    for (const q of round.queuedSwipes) add(q.text, q.name);
    if (Array.isArray(message.swipes)) for (const s of message.swipes) add(s, '原有 Swipe');
    const base = buildBaseInfo(message);
    message.mes = winnerText;
    message.swipes = [winnerText, ...extras.map(x => x.text)];
    message.swipe_id = 0;
    message.swipe_info = message.swipes.map((_, i) => ({
      ...structuredClone(base),
      gen_finished: new Date(),
      extra: { ...(base.extra || {}), answer_me_source: i === 0 ? round.winner.name : extras[i - 1]?.name },
    }));
    round.queuedSwipes.length = 0;
    round.mainInstalled = true;
    try { await ctx?.saveChat?.(); } catch {}
  }

  function killColdAfterWinner(round) {
    if (!settings?.killColdAfterWinner) return;
    for (const c of round.candidates.values()) {
      if (c.winner || terminal(c) || c.started) continue;
      if (c.isOriginal) {
        if (!round.winner?.isOriginal) {
          round.suppressOriginalStop = true;
          internalStopUntil = now() + 1200;
          c.aborted = true;
          c.error = '零正文 token · 赢家已出，已停止';
          c.finishedAt = now();
          round.originalFinished = true;
          try { ctx?.stopGeneration?.(); } catch {}
        }
      } else {
        abortCandidate(c, '零正文 token · 赢家已出，已断开');
      }
    }
  }

  async function selectWinner(round, c) {
    if (round !== activeRound || round.winner || !validReply(c.text)) return false;
    c.winner = true;
    c.finished = true;
    c.error = '';
    c.finishedAt ||= now();
    round.winner = c;
    clearRetryTimer();
    retryState.count = 0;
    retryState.lastReason = '';
    lastResult = `🏆 ${c.name} 抢答成功`;
    killColdAfterWinner(round);
    scheduleRender();
    toast('success', `${c.name} 抢答成功。`, '🏆 Answer Me');

    if (c.isOriginal) {
      round.mainInstalled = true;
      await flushQueuedSwipes(round);
      await maybeFinalize(round);
      return true;
    }
    const original = round.candidates.get('__original__');
    if (!original?.started) await installSideWinnerImmediately(round, c);
    return true;
  }

  async function sideCompleted(round, c) {
    if (round !== activeRound || c.aborted) return;
    if (!validReply(c.text)) {
      c.error = '空回 / 有效正文不足';
      c.finishedAt = now();
      scheduleRender();
      await maybeHandleTotalFailure(round, c.error);
      return;
    }
    c.finished = true;
    c.error = '';
    c.finishedAt = now();
    scheduleRender();
    if (!round.winner) {
      await selectWinner(round, c);
      return;
    }
    if (round.winner !== c && settings?.keepStartedAsSwipes) {
      if (round.mainInstalled) await appendSwipe(c.text, c.name);
      else round.queuedSwipes.push({ text: c.text, name: c.name });
    }
    await maybeFinalize(round);
  }

  function linkAbort(parentSignal, childController) {
    if (!parentSignal) return () => {};
    if (parentSignal.aborted) {
      try { childController.abort(parentSignal.reason); } catch {}
      return () => {};
    }
    const fn = () => { try { childController.abort(parentSignal.reason); } catch {} };
    parentSignal.addEventListener('abort', fn, { once: true });
    return () => parentSignal.removeEventListener('abort', fn);
  }

  async function requestNonStream(round, c, prompt, maxTokens, reason = '') {
    if (round !== activeRound || c.controller.signal.aborted) throw new Error('candidate aborted');
    c.fallbackUsed = true;
    scheduleRender();
    const result = await service().sendRequest(c.profileId, prompt, maxTokens, {
      stream: false,
      signal: c.controller.signal,
      extractData: true,
      includePreset: false,
      includeInstruct: false,
      answerMeRace: true,
      answerMeRoundId: round.id,
      answerMeCandidateId: c.id,
      answerMeAttempt: reason || 'nonstream',
    });
    const text = String(result?.content ?? result?.text ?? '');
    if (!validReply(text)) throw new Error('非流式回退空回 / 有效正文不足');
    c.text = text;
    c.started = true;
    c.lastGrowthAt = now();
    scheduleRender();
  }

  async function requestStreamWithFallback(round, c, prompt, maxTokens) {
    const attempt = new AbortController();
    c.attemptController = attempt;
    const unlink = linkAbort(c.controller.signal, attempt);
    let activityTimer = null;
    let stallTimer = null;
    let sawText = false;
    let fallbackRequested = false;
    let stallRequested = false;
    let sawStreamActivity = false;

    const clearTimers = () => {
      if (activityTimer) clearTimeout(activityTimer);
      if (stallTimer) clearTimeout(stallTimer);
      activityTimer = null;
      stallTimer = null;
    };
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (round !== activeRound || c.controller.signal.aborted || terminal(c)) return;
        if (validReply(c.text)) {
          stallRequested = true;
          try { attempt.abort('Answer Me: started stream stalled'); } catch {}
        }
      }, STARTED_STALL_MS);
    };

    activityTimer = setTimeout(() => {
      if (round !== activeRound || c.controller.signal.aborted || sawStreamActivity) return;
      fallbackRequested = true;
      try { attempt.abort('Answer Me: no stream activity, fallback to nonstream'); } catch {}
    }, Math.min(STREAM_ACTIVITY_TIMEOUT_MS, Math.max(5000, settings.coldTimeoutMs - 1000)));

    try {
      const factory = await service().sendRequest(c.profileId, prompt, maxTokens, {
        stream: true,
        signal: attempt.signal,
        extractData: true,
        includePreset: false,
        includeInstruct: false,
        answerMeRace: true,
        answerMeRoundId: round.id,
        answerMeCandidateId: c.id,
        answerMeAttempt: 'stream',
      });
      if (typeof factory !== 'function') throw new Error('流式请求没有返回生成器');
      for await (const chunk of factory()) {
        if (round !== activeRound || c.controller.signal.aborted) return;
        if (!sawStreamActivity) {
          sawStreamActivity = true;
          if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
        }
        const next = String(chunk?.text ?? '');
        if (next.length > c.text.length) {
          c.text = next;
          c.lastGrowthAt = now();
          if (!c.started && normalizeForQuality(next).length > 0) {
            c.started = true;
            sawText = true;
          }
          armStall();
          scheduleRender();
        }
      }
      clearTimers();
      unlink();
      c.attemptController = null;
      return;
    } catch (error) {
      clearTimers();
      unlink();
      c.attemptController = null;
      if (c.controller.signal.aborted || round !== activeRound) throw error;
      if (validReply(c.text) && stallRequested) {
        return;
      }
      if (validReply(c.text)) {
        throw new Error(`流式中途断开（已收到 ${c.text.length} 字，未作为完整回复结算）`);
      }
      if (!sawText || fallbackRequested || !validReply(c.text)) {
        await requestNonStream(round, c, prompt, maxTokens, 'stream-failed');
        return;
      }
      throw error;
    }
  }

  async function runSideCandidate(round, c, prompt, maxTokens) {
    if (!service()) {
      c.error = '连接管理请求服务不可用';
      c.finishedAt = now();
      await maybeHandleTotalFailure(round, c.error);
      return;
    }
    try {
      if (c.mode === 'fake') await requestNonStream(round, c, prompt, maxTokens, 'fake-mode');
      else await requestStreamWithFallback(round, c, prompt, maxTokens);
      if (round !== activeRound || c.controller.signal.aborted) return;
      await sideCompleted(round, c);
    } catch (error) {
      if (round !== activeRound) return;
      if (c.controller.signal.aborted) {
        c.aborted = true;
        c.finishedAt ||= now();
        if (!c.error) c.error = '已断开';
      } else {
        c.error = String(error?.message || error || '请求失败').slice(0, 140);
        c.finishedAt = now();
        warn(`${c.name} 请求失败`, error);
      }
      scheduleRender();
      await maybeHandleTotalFailure(round, c.error || '请求失败');
    }
  }

  async function maybeFinalize(round) {
    if (round !== activeRound || round.finalized || !round.winner || !allTerminal(round)) return;
    round.finalized = true;
    if (round.coldTimer) clearTimeout(round.coldTimer);
    if (round.originalStallTimer) clearTimeout(round.originalStallTimer);
    await flushQueuedSwipes(round);
    setTimeout(() => {
      if (activeRound === round) {
        activeRound = null;
        scheduleRender();
      }
    }, 500);
  }

  function retryDelayFor(count) {
    return RETRY_DELAYS[Math.min(count, RETRY_DELAYS.length - 1)] ?? 25000;
  }

  function scheduleAutoRetry(reason) {
    if (!settings?.enabled || !settings?.autoRetryEnabled || retryState.timer) return false;
    if (retryState.count >= settings.maxRetryRounds) {
      lastResult = `☠️ 连续 ${settings.maxRetryRounds} 次追杀仍全军覆没`;
      toast('error', `已经追着肘了 ${settings.maxRetryRounds} 轮还是全军覆没。`, '💢 Answer Me');
      scheduleRender();
      return false;
    }
    const delay = retryDelayFor(retryState.count);
    retryState.lastReason = reason;
    retryState.dueAt = now() + delay;
    retryState.timer = setTimeout(async () => {
      retryState.timer = null;
      retryState.dueAt = 0;
      if (!settings?.enabled || !settings?.autoRetryEnabled) return;
      retryState.count += 1;
      retryState.nextGenerationIsRetry = true;
      try { await ctx?.generate?.('regenerate'); }
      catch (e) {
        retryState.nextGenerationIsRetry = false;
        scheduleAutoRetry(String(e?.message || e || '重试失败'));
      }
    }, delay);
    startStatusTimer();
    scheduleRender();
    toast('warning', `全军覆没，${delay / 1000}s 后第 ${retryState.count + 1}/${settings.maxRetryRounds} 次追杀。`, '💢 你他妈倒是回我啊');
    return true;
  }

  async function maybeHandleTotalFailure(round, reason = '全员失败') {
    if (round !== activeRound || round.winner || round.failureHandled || !allTerminal(round)) return;
    round.failureHandled = true;
    if (round.coldTimer) clearTimeout(round.coldTimer);
    lastResult = '☠️ 本轮全军覆没';
    activeRound = null;
    scheduleAutoRetry(reason);
    scheduleRender();
  }

  function startColdTimer(round) {
    round.coldTimer = setTimeout(async () => {
      if (round !== activeRound || round.winner) return;
      for (const c of round.candidates.values()) {
        if (terminal(c) || c.started) continue;
        if (c.isOriginal) {
          c.aborted = true;
          c.error = '冷暴力等待上限 · 零正文';
          c.finishedAt = now();
          round.originalFinished = true;
          round.suppressOriginalStop = true;
          internalStopUntil = now() + 1200;
          try { ctx?.stopGeneration?.(); } catch {}
        } else abortCandidate(c, '冷暴力等待上限 · 零正文');
      }
      await maybeHandleTotalFailure(round, '全部未开口请求均超时');
    }, settings.coldTimeoutMs);
  }

  async function startRace(prompt) {
    if (!ensureSettings() || !settings.enabled) return;
    if (!['normal', 'regenerate'].includes(String(currentGenerationType || ''))) return;
    if (activeRound?.generationSeq === generationSeq) return;
    if (activeRound) abortRound('新一轮生成开始', { stopOriginal: false });
    const sides = chosenSideProfiles();
    if (!sides.length) return;
    const round = makeRound(prompt);
    activeRound = round;
    const maxTokens = settings.maxTokens > 0
      ? settings.maxTokens
      : Number(ctx?.getMaxResponseTokens?.() || ctx?.chatCompletionSettings?.openai_max_tokens || 2048);
    startColdTimer(round);
    startStatusTimer();
    scheduleRender();
    log(`第 ${round.id} 轮开赛`, sides.map(p => `${p.name} · ${p.model}`));
    for (const c of round.candidates.values()) {
      if (!c.isOriginal) void runSideCandidate(round, c, round.prompt, maxTokens);
    }
  }

  function onGenerationStarted(type) {
    generationSeq += 1;
    currentGenerationType = String(type || '');
    if (retryState.nextGenerationIsRetry) retryState.nextGenerationIsRetry = false;
    else resetRetryChain('用户开始新一轮生成');
  }

  function onChatCompletionSettingsReady(generateData) {
    const prompt = Array.isArray(generateData?.messages)
      ? structuredClone(generateData.messages)
      : (generateData?.prompt ?? '');
    void startRace(prompt);
  }

  function onGenerateAfterData(generateData, dryRun) {
    if (dryRun) return;
    const prompt = generateData?.prompt ?? generateData?.messages ?? '';
    void startRace(prompt);
  }

  function armOriginalStall(round, original) {
    if (!round || !original || terminal(original)) return;
    if (round.originalStallTimer) clearTimeout(round.originalStallTimer);
    round.originalStallTimer = setTimeout(() => {
      if (round !== activeRound || terminal(original) || !original.started || !validReply(original.text)) return;
      round.suppressOriginalStop = true;
      internalStopUntil = now() + 1500;
      try { ctx?.stopGeneration?.(); } catch {}
      setTimeout(() => { if (round === activeRound && !round.originalFinished) void finishOriginalFromMessage(); }, 140);
    }, ORIGINAL_STALL_MS);
  }

  function onStreamToken() {
    const round = activeRound;
    if (!round || round.originalFinished) return;
    const original = round.candidates.get('__original__');
    if (!original || terminal(original)) return;
    const text = latestAssistantText();
    if (normalizeForQuality(text).length > 0 && text !== original.text) {
      original.started = true;
      original.text = text;
      armOriginalStall(round, original);
      scheduleRender();
    }
  }

  async function finishOriginalFromMessage() {
    const round = activeRound;
    if (!round || round.insertingWinner || round.originalFinished) return;
    const original = round.candidates.get('__original__');
    if (!original || terminal(original)) return;
    if (round.originalStallTimer) { clearTimeout(round.originalStallTimer); round.originalStallTimer = null; }
    const text = latestAssistantText();
    original.text = text;
    original.started = normalizeForQuality(text).length > 0;
    original.finishedAt = now();
    round.originalFinished = true;

    if (!validReply(text)) {
      original.error = '空回 / 有效正文不足';
      scheduleRender();
      await maybeHandleTotalFailure(round, original.error);
      return;
    }

    original.finished = true;
    original.error = '';
    if (!round.winner) {
      await selectWinner(round, original);
      return;
    }
    if (!round.winner.isOriginal) {
      await reorderWinnerOverOriginal(round, text);
      await maybeFinalize(round);
    } else {
      round.mainInstalled = true;
      await flushQueuedSwipes(round);
      await maybeFinalize(round);
    }
  }

  function onMessageReceived() {
    void finishOriginalFromMessage();
  }

  function onGenerationEnded() {
    void finishOriginalFromMessage();
  }

  function onGenerationStopped() {
    const round = activeRound;
    if (!round) return;
    if (round.suppressOriginalStop || now() < internalStopUntil) {
      round.suppressOriginalStop = false;
      return;
    }
    abortRound('用户停止生成', { stopOriginal: false, clearRetry: true });
  }

  function onChatChanged() {
    abortRound('聊天已切换', { stopOriginal: false, clearRetry: true });
  }

  function renderProfiles() {
    if (!settingsMounted || !ensureSettings()) return;
    const box = document.querySelector('#answer_me_profiles');
    if (!box) return;
    box.replaceChildren();
    for (const p of profiles()) {
      const usable = isProfileUsable(p);
      const row = document.createElement('label');
      row.className = `answer-me-profile ${usable ? '' : 'is-disabled'}`;
      row.innerHTML = `<input type="checkbox" value="${escapeHtml(p.id)}" ${usable ? '' : 'disabled'}>
        <span class="answer-me-profile-main"><span class="answer-me-profile-name">${escapeHtml(p.name || '未命名')}</span><span class="answer-me-profile-meta">${escapeHtml([p.model, p.api].filter(Boolean).join(' · '))}</span></span>
        <span class="answer-me-profile-state">${usable ? '可参赛' : '暂不支持'}</span>`;
      const cb = row.querySelector('input');
      cb.checked = usable && settings.profileIds.includes(String(p.id));
      cb.addEventListener('change', () => {
        const set = new Set(settings.profileIds.map(String));
        cb.checked ? set.add(String(p.id)) : set.delete(String(p.id));
        settings.profileIds = [...set];
        saveSettings();
      });
      box.appendChild(row);
    }
  }

  function mountSettings() {
    if (settingsMounted || !ensureSettings()) return;
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings_content');
    if (!host) return;
    document.querySelector('#answer_me_settings')?.remove();
    const root = document.createElement('div');
    root.id = 'answer_me_settings';
    root.className = 'answer-me-settings';
    root.innerHTML = `
      <div class="answer-me-head"><div><div class="answer-me-title">💢 Answer Me</div><div class="answer-me-subtitle">你们几个谁他妈先回我 · v${VERSION}</div></div>
        <label class="answer-me-switch-row"><input id="answer_me_enabled" type="checkbox"><span>启用赛马</span></label></div>
      <div class="answer-me-note">第一条完整有效回复当主回复；已经吐正文的继续跑完并收进 Swipe；赢家出现后零正文请求立即断开。真流式 12s 连一个流式事件都没有才改走非流式抢救；有思考流但没正文不会被误判开口，赢家出现时仍按零正文处理。</div>
      <div class="answer-me-toolbar"><button id="answer_me_refresh" class="menu_button">刷新连接配置</button><button id="answer_me_select_all" class="menu_button">全选可用站</button><button id="answer_me_clear" class="menu_button">清空</button></div>
      <div class="answer-me-profile-title">参赛 Connection Profiles</div><div id="answer_me_profiles" class="answer-me-profiles"></div>
      <div class="answer-me-grid">
        <label><span>冷暴力等待上限（秒）</span><input id="answer_me_timeout" type="number" min="15" max="300" step="5"></label>
        <label><span>最大输出 Token（0=沿用酒馆）</span><input id="answer_me_tokens" type="number" min="0" step="128"></label>
        <label><span>全军覆没后最多再肘几轮</span><input id="answer_me_retry_rounds" type="number" min="0" max="8" step="1"></label>
        <label><span>最少有效正文字符</span><input id="answer_me_min_meaningful" type="number" min="1" max="30" step="1"></label>
      </div>
      <label class="answer-me-check-row"><input id="answer_me_keep_started" type="checkbox"><span>已经开口的站继续吐完，完成后放进 Swipe</span></label>
      <label class="answer-me-check-row"><input id="answer_me_kill_cold" type="checkbox"><span>出现主回复后，零正文 token 的请求立即断开</span></label>
      <label class="answer-me-check-row"><input id="answer_me_auto_retry" type="checkbox"><span>全军覆没后自动重试整轮赛马</span></label>
      <label class="answer-me-check-row"><input id="answer_me_float" type="checkbox"><span>显示赛马状态窗</span></label>`;
    host.appendChild(root);
    settingsMounted = true;

    const $ = id => root.querySelector(id);
    $('#answer_me_enabled').checked = !!settings.enabled;
    $('#answer_me_timeout').value = String(Math.round(settings.coldTimeoutMs / 1000));
    $('#answer_me_tokens').value = String(settings.maxTokens || 0);
    $('#answer_me_retry_rounds').value = String(settings.maxRetryRounds);
    $('#answer_me_min_meaningful').value = String(settings.minMeaningfulChars);
    $('#answer_me_keep_started').checked = !!settings.keepStartedAsSwipes;
    $('#answer_me_kill_cold').checked = !!settings.killColdAfterWinner;
    $('#answer_me_auto_retry').checked = !!settings.autoRetryEnabled;
    $('#answer_me_float').checked = !!settings.showFloatingStatus;

    $('#answer_me_enabled').addEventListener('change', e => {
      settings.enabled = e.currentTarget.checked;
      saveSettings();
      if (!settings.enabled) abortRound('插件已关闭', { stopOriginal: false, clearRetry: true });
      scheduleRender();
    });
    $('#answer_me_timeout').addEventListener('change', e => {
      settings.coldTimeoutMs = Math.max(15000, Math.min(300000, Number(e.currentTarget.value || 90) * 1000));
      e.currentTarget.value = String(Math.round(settings.coldTimeoutMs / 1000)); saveSettings();
    });
    $('#answer_me_tokens').addEventListener('change', e => { settings.maxTokens = Math.max(0, Number(e.currentTarget.value || 0)); saveSettings(); });
    $('#answer_me_retry_rounds').addEventListener('change', e => { settings.maxRetryRounds = Math.max(0, Math.min(8, Number(e.currentTarget.value || 0))); e.currentTarget.value = String(settings.maxRetryRounds); saveSettings(); });
    $('#answer_me_min_meaningful').addEventListener('change', e => { settings.minMeaningfulChars = Math.max(1, Math.min(30, Number(e.currentTarget.value || 6))); e.currentTarget.value = String(settings.minMeaningfulChars); saveSettings(); });
    $('#answer_me_keep_started').addEventListener('change', e => { settings.keepStartedAsSwipes = e.currentTarget.checked; saveSettings(); });
    $('#answer_me_kill_cold').addEventListener('change', e => { settings.killColdAfterWinner = e.currentTarget.checked; saveSettings(); });
    $('#answer_me_auto_retry').addEventListener('change', e => { settings.autoRetryEnabled = e.currentTarget.checked; if (!settings.autoRetryEnabled) resetRetryChain('自动重试已关闭'); saveSettings(); });
    $('#answer_me_float').addEventListener('change', e => { settings.showFloatingStatus = e.currentTarget.checked; saveSettings(); scheduleRender(); });
    $('#answer_me_refresh').addEventListener('click', renderProfiles);
    $('#answer_me_clear').addEventListener('click', () => { settings.profileIds = []; saveSettings(); renderProfiles(); });
    $('#answer_me_select_all').addEventListener('click', () => { settings.profileIds = profiles().filter(isProfileUsable).map(p => String(p.id)); saveSettings(); renderProfiles(); });
    renderProfiles();
    ensureFloatingPanel();
    scheduleRender();
  }

  function bindEvents() {
    if (bound || !ensureSettings()) return false;
    const source = ctx?.eventSource;
    const events = ctx?.eventTypes || ctx?.event_types;
    if (!source || !events) return false;
    if (events.GENERATION_STARTED) source.on(events.GENERATION_STARTED, onGenerationStarted);
    if (events.CHAT_COMPLETION_SETTINGS_READY) source.on(events.CHAT_COMPLETION_SETTINGS_READY, onChatCompletionSettingsReady);
    if (events.GENERATE_AFTER_DATA) source.on(events.GENERATE_AFTER_DATA, onGenerateAfterData);
    if (events.STREAM_TOKEN_RECEIVED) source.on(events.STREAM_TOKEN_RECEIVED, onStreamToken);
    if (events.MESSAGE_RECEIVED) source.on(events.MESSAGE_RECEIVED, onMessageReceived);
    if (events.GENERATION_ENDED) source.on(events.GENERATION_ENDED, onGenerationEnded);
    if (events.GENERATION_STOPPED) source.on(events.GENERATION_STOPPED, onGenerationStopped);
    if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, onChatChanged);
    bound = true;
    return true;
  }

  window.AnswerMe = {
    version: VERSION,
    get settings() { ensureSettings(); return settings; },
    get round() { return activeRound; },
    get retry() { return { count: retryState.count, timer: retryState.timer, dueAt: retryState.dueAt, lastReason: retryState.lastReason }; },
    profiles,
    refresh: renderProfiles,
    abort: () => abortRound('外部终止', { stopOriginal: false, clearRetry: true }),
    retryNow: async () => {
      clearRetryTimer();
      retryState.nextGenerationIsRetry = true;
      retryState.count += 1;
      await ctx?.generate?.('regenerate');
    },
    quality: { normalize: normalizeForQuality, semanticCount, isValidReply: validReply },
  };

  window.AnswerMeQuality = {
    version: VERSION,
    normalize: normalizeForQuality,
    semanticCount,
    isValidReply: validReply,
    reason(text) {
      const n = semanticCount(text);
      return n <= 0 ? '空回：没有有效正文' : `空回：有效正文不足（${n}/${Number(settings?.minMeaningfulChars || 6)}）`;
    },
  };

  async function boot() {
    for (let i = 0; i < 120; i++) {
      if (getContext() && (document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings_content'))) break;
      await sleep(100);
    }
    ensureSettings();
    mountSettings();
    bindEvents();
    log(`${VERSION} ready · single race core / no global watchdog / no global quality sweep / no popup observer`);
  }

  boot().catch(e => {
    console.error('[💢 Answer Me] core startup failed', e);
    toast('error', String(e?.message || e || '启动失败'));
  });
})();
