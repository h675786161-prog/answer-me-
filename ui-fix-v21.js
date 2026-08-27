(() => {
  'use strict';

  const VERSION = '0.3.9-beta.21';
  const FLAG = '__answerMeUiFixV21';
  const BOX_ID = 'answer_me_compact_ui_v20';
  const ROUTER_ID = 'answer_me_model_router_v14';
  const ROOT_ID = 'answer_me_settings';

  let observer = null;
  let reanchorTimer = null;
  let scrollGuard = null;

  function root() { return document.getElementById(ROOT_ID); }
  function box() { return document.getElementById(BOX_ID); }
  function routerBox() { return document.getElementById(ROUTER_ID); }

  function scrollingAncestors(start) {
    const list = [];
    const seen = new Set();
    const add = el => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      list.push(el);
    };
    add(document.scrollingElement);
    let node = start;
    while (node) {
      try {
        const cs = getComputedStyle(node);
        if (/(auto|scroll|overlay)/.test(`${cs.overflowY} ${cs.overflow}`) && node.scrollHeight > node.clientHeight + 2) add(node);
      } catch {}
      node = node.parentElement;
    }
    return list;
  }

  function captureScroll() {
    const r = root();
    return {
      x: window.scrollX,
      y: window.scrollY,
      items: scrollingAncestors(r).map(el => ({ el, top: el.scrollTop, left: el.scrollLeft })),
      at: Date.now(),
    };
  }

  function restoreScroll(snap) {
    if (!snap) return;
    const apply = () => {
      for (const item of snap.items || []) {
        if (!item.el?.isConnected) continue;
        item.el.scrollTop = item.top;
        item.el.scrollLeft = item.left;
      }
      try { window.scrollTo(snap.x, snap.y); } catch {}
    };
    apply();
    requestAnimationFrame(apply);
    setTimeout(apply, 50);
    setTimeout(apply, 140);
  }

  function desiredAnchor() {
    const r = root();
    if (!r) return null;
    return r.querySelector('.answer-me-note') || r.querySelector('.answer-me-head');
  }

  function reanchor(preserveScroll = true) {
    const r = root();
    const b = box();
    const old = routerBox();
    const anchor = desiredAnchor();
    if (!r || !b || !anchor) return false;

    const snap = preserveScroll ? captureScroll() : null;
    let changed = false;

    // v20 anchored itself to the hidden model router. Some ST/mobile DOM orders put that router
    // before the Answer Me header, which makes the compact deck visually appear under the previous
    // extension. Pin the deck to Answer Me's own header/note instead.
    if (b.parentElement !== r || anchor.nextElementSibling !== b) {
      anchor.insertAdjacentElement('afterend', b);
      changed = true;
    }

    // Manual-correction CSS intentionally uses the hidden router as the compact deck's next sibling.
    // Move only that hidden helper node; the visible Answer Me header always stays above the deck.
    if (old && b.nextElementSibling !== old) {
      b.insertAdjacentElement('afterend', old);
      changed = true;
    }

    if (changed && snap) restoreScroll(snap);
    return changed;
  }

  function scheduleReanchor() {
    if (reanchorTimer) clearTimeout(reanchorTimer);
    reanchorTimer = setTimeout(() => {
      reanchorTimer = null;
      reanchor(true);
    }, 24);
  }

  function armInteractionGuard() {
    scrollGuard = captureScroll();
  }

  function finishInteractionGuard() {
    const snap = scrollGuard;
    scrollGuard = null;
    if (!snap) return;
    // Only guard the layout churn immediately caused by the control. We deliberately stop after
    // a short window so normal user scrolling is never fought by the plugin.
    restoreScroll(snap);
  }

  function bindInteractionGuard() {
    const b = box();
    if (!b || b.dataset.answerMeV21Guard === '1') return;
    b.dataset.answerMeV21Guard = '1';

    b.addEventListener('pointerdown', armInteractionGuard, true);
    b.addEventListener('touchstart', armInteractionGuard, { capture: true, passive: true });
    b.addEventListener('change', () => {
      const snap = scrollGuard || captureScroll();
      setTimeout(() => restoreScroll(snap), 0);
      setTimeout(() => restoreScroll(snap), 80);
      setTimeout(() => { restoreScroll(snap); scrollGuard = null; }, 220);
    }, true);
    b.addEventListener('click', event => {
      const interactive = event.target?.closest?.('button,summary,.am20-section-head');
      if (!interactive) return;
      const snap = scrollGuard || captureScroll();
      setTimeout(() => restoreScroll(snap), 0);
      setTimeout(() => restoreScroll(snap), 80);
      setTimeout(() => { restoreScroll(snap); scrollGuard = null; }, 220);
    }, true);
  }

  function observe() {
    observer?.disconnect?.();
    const r = root();
    if (!r) return;
    observer = new MutationObserver(() => {
      bindInteractionGuard();
      scheduleReanchor();
    });
    observer.observe(r, { childList: true, subtree: false });
  }

  async function boot() {
    if (window[FLAG]) return;
    window[FLAG] = true;

    for (let i = 0; i < 120; i++) {
      if (root() && box()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    reanchor(false);
    bindInteractionGuard();
    observe();

    const timer = setInterval(() => {
      if (!box()) return;
      bindInteractionGuard();
      reanchor(true);
    }, 900);

    window.addEventListener('beforeunload', () => {
      clearInterval(timer);
      observer?.disconnect?.();
      if (reanchorTimer) clearTimeout(reanchorTimer);
    }, { once: true });

    console.log(`[💢 Answer Me] UI fix ${VERSION} ready · stable scroll + correct panel anchor`);
  }

  boot().catch(error => {
    console.error('[💢 Answer Me] UI fix v21 startup failed', error);
    window.toastr?.error?.(String(error?.message || error || 'UI 稳定器启动失败'), '💢 Answer Me');
  });
})();
