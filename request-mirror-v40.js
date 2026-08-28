(() => {
  'use strict';

  const VERSION = '0.5.6-beta.40';
  const FLAG = '__answerMeRequestMirrorV40';
  const WRAP_FLAG = '__answerMeRequestMirrorWrappedV40';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = () => window.SillyTavern?.getContext?.() ?? null;

  // These fields belong to the connection / transport, not to the shared
  // generation recipe. Copying them would make a side candidate silently use
  // the main route again, or override the target profile's endpoint/model/key.
  const ROUTING_KEYS = new Set([
    'messages', 'prompt', 'model', 'stream',
    'chat_completion_source', 'api_type', 'api_server', 'api_url',
    'custom_url', 'secret_id', 'reverse_proxy', 'proxy_password',
    'vertexai_region', 'vertexai_express_project_id', 'vertexai_auth_mode',
    'workers_ai_account_id', 'zai_endpoint', 'siliconflow_endpoint', 'minimax_endpoint',
    'custom_include_headers', 'custom_include_body', 'custom_exclude_body',
    'custom_prompt_post_processing',
    // Answer Me already owns the per-race output limit. Do not let a mirrored
    // provider payload unexpectedly override the explicit side maxTokens.
    'max_tokens', 'max_completion_tokens',
  ]);

  let latest = null;
  let latestAt = 0;
  let latestSource = '';
  let seq = 0;
  let applied = 0;
  let lastApplied = null;

  function safeClone(value) {
    try { return structuredClone(value); }
    catch {
      try { return JSON.parse(JSON.stringify(value)); }
      catch { return undefined; }
    }
  }

  function isPlainSerializable(value) {
    if (value === null) return true;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return true;
    if (Array.isArray(value)) return true;
    if (t === 'object') {
      if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) return false;
      if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
      if (typeof FormData !== 'undefined' && value instanceof FormData) return false;
      return true;
    }
    return false;
  }

  function capture(generateData, source) {
    if (!generateData || typeof generateData !== 'object' || Array.isArray(generateData)) return;
    const copy = safeClone(generateData);
    if (!copy || typeof copy !== 'object') return;
    latest = copy;
    latestAt = Date.now();
    latestSource = source;
    seq += 1;
  }

  function sharedPayload() {
    if (!latest) return {};
    const out = {};
    for (const [key, value] of Object.entries(latest)) {
      if (ROUTING_KEYS.has(key)) continue;
      if (key.startsWith('answerMe')) continue;
      if (!isPlainSerializable(value)) continue;
      const copy = safeClone(value);
      if (copy !== undefined) out[key] = copy;
    }
    return out;
  }

  function bindCapture() {
    const c = ctx();
    const source = c?.eventSource;
    const events = c?.eventTypes || c?.event_types;
    if (!source || !events) return false;

    // Loaded before race-core-v35, so this cache is populated before the race
    // listener starts side requests on the same event.
    if (events.CHAT_COMPLETION_SETTINGS_READY) {
      source.on(events.CHAT_COMPLETION_SETTINGS_READY, data => capture(data, 'CHAT_COMPLETION_SETTINGS_READY'));
    }
    if (events.GENERATE_AFTER_DATA) {
      source.on(events.GENERATE_AFTER_DATA, (data, dryRun) => {
        if (!dryRun) capture(data, 'GENERATE_AFTER_DATA');
      });
    }
    return true;
  }

  function wrapService() {
    const service = ctx()?.ConnectionManagerRequestService;
    if (!service?.sendRequest || service[WRAP_FLAG]) return !!service?.[WRAP_FLAG];
    const original = service.sendRequest.bind(service);

    service.sendRequest = async function(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
      if (!custom?.answerMeRace) {
        return await original(profileId, prompt, maxTokens, custom, overridePayload);
      }

      const mirror = sharedPayload();
      // Caller-supplied overrides win. This keeps later Answer Me fixes capable
      // of deliberately overriding a mirrored field without changing this shim.
      const merged = { ...mirror, ...(overridePayload || {}) };
      const keys = Object.keys(mirror);
      applied += 1;
      lastApplied = {
        at: Date.now(),
        round: custom?.answerMeRoundId ?? null,
        candidate: String(custom?.answerMeCandidateId ?? profileId),
        profileId: String(profileId),
        attempt: String(custom?.answerMeAttempt || ''),
        source: latestSource,
        captureSeq: seq,
        capturedAgoMs: latestAt ? Math.max(0, Date.now() - latestAt) : null,
        mirroredKeyCount: keys.length,
        mirroredKeys: keys,
      };

      return await original(profileId, prompt, maxTokens, custom, merged);
    };

    service[WRAP_FLAG] = true;
    return true;
  }

  window.AnswerMeRequestMirror = {
    version: VERSION,
    get applied() { return applied; },
    get lastApplied() { return lastApplied ? safeClone(lastApplied) : null; },
    state() {
      const payload = sharedPayload();
      return {
        version: VERSION,
        hasCapture: !!latest,
        captureSeq: seq,
        latestSource,
        latestAt,
        mirroredKeyCount: Object.keys(payload).length,
        mirroredKeys: Object.keys(payload),
        applied,
        lastApplied: lastApplied ? safeClone(lastApplied) : null,
      };
    },
  };

  let tries = 0;
  (function boot() {
    tries += 1;
    const captureReady = bindCapture();
    const wrapped = wrapService();
    if (captureReady && wrapped) {
      console.log(`[💢 Answer Me] request mirror ${VERSION} ready · main recipe will follow side candidates`);
      return;
    }
    if (tries < 100) setTimeout(boot, 120);
  })();
})();
