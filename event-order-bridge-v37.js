(() => {
  'use strict';

  const VERSION = '0.5.3-beta.37';
  const FLAG = '__answerMeEventOrderBridgeV37';
  if (window[FLAG]) return;
  window[FLAG] = true;

  const ctx = window.SillyTavern?.getContext?.();
  const source = ctx?.eventSource;
  const events = ctx?.eventTypes || ctx?.event_types;
  if (!source || !events) {
    console.warn(`[💢 Answer Me] ${VERSION}: event-order bridge skipped · event bus unavailable`);
    return;
  }

  let generationOpen = false;
  let pending = null;
  let replaying = false;

  function clone(value) {
    try { return structuredClone(value); }
    catch {
      try { return JSON.parse(JSON.stringify(value)); }
      catch { return value; }
    }
  }

  function cacheGenerateData(generateData, dryRun = false) {
    if (dryRun || replaying || generationOpen) return;
    if (!generateData) return;
    pending = clone(generateData);
  }

  async function replayPending(type) {
    const kind = String(type || '');
    if (!['normal', 'regenerate'].includes(kind)) {
      pending = null;
      return;
    }
    if (!pending || !events.GENERATE_AFTER_DATA) return;

    const data = pending;
    pending = null;

    // Core's GENERATION_STARTED listener runs before this bridge because
    // race-core is loaded first. Replaying on the next task therefore gives
    // startRace() a valid currentGenerationType without duplicating normal
    // event ordering.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!generationOpen) return;

    replaying = true;
    try {
      await source.emit(events.GENERATE_AFTER_DATA, data, false);
      console.debug(`[💢 Answer Me] ${VERSION}: replayed early generate-data after GENERATION_STARTED`);
    } catch (error) {
      console.warn(`[💢 Answer Me] ${VERSION}: event-order replay failed`, error);
    } finally {
      replaying = false;
    }
  }

  if (events.CHAT_COMPLETION_SETTINGS_READY) {
    source.on(events.CHAT_COMPLETION_SETTINGS_READY, generateData => {
      cacheGenerateData(generateData, false);
    });
  }

  if (events.GENERATE_AFTER_DATA) {
    source.on(events.GENERATE_AFTER_DATA, (generateData, dryRun) => {
      cacheGenerateData(generateData, !!dryRun);
    });
  }

  if (events.GENERATION_STARTED) {
    source.on(events.GENERATION_STARTED, type => {
      generationOpen = true;
      void replayPending(type);
    });
  }

  const closeGeneration = () => {
    generationOpen = false;
    pending = null;
  };

  if (events.GENERATION_ENDED) source.on(events.GENERATION_ENDED, closeGeneration);
  if (events.GENERATION_STOPPED) source.on(events.GENERATION_STOPPED, closeGeneration);
  if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, closeGeneration);

  console.log(`[💢 Answer Me] event-order bridge ${VERSION} ready · early data will be replayed once, no polling`);
})();
