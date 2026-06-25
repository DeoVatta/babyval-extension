/**
 * CONTENT SCRIPT — Tevi CS Bot v0.6.0
 * State machine: IDLE (tevi.com/messages) ↔ REPLY (tevi.com/@slug/messages)
 * After send → 60s delay → auto-return to messages list
 * Deduplication + auto-navigation handled here
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const LOG       = 'http://localhost:3131';
  const IDLE_URL  = 'https://tevi.com/messages';
  const DM_URL    = (slug) => `https://tevi.com/${slug}/messages`;
  const RETRY_AFTER_SEND_MS = 60000; // 1 minute

  let _busy    = false;
  let _lastSlug = null;
  let _lastMsg  = null;
  let _state    = 'idle'; // 'idle' | 'replying'
  let _returnTimer = null;
  let _idleRefreshTimer = null;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function getSlug() {
    const m = location.href.match(/tevi\.com\/@([^/]+)/);
    return m ? m[1] : null;
  }

  function isIdle() { return location.href.includes('/messages') && !location.href.includes('/@'); }

  function findInput() {
    // Priority 1: specific textarea (Tevi's main message input)
    const specific = document.getElementById('_r_17_');
    if (specific && isVisible(specific)) return specific;
    // Fallback: generic selectors
    const sels = [
      'textarea',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      'div[contenteditable]',
      'input[type="text"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findSendBtn() {
    const sels = [
      'button[type="submit"]',
      'button[aria-label*="Kirim" i]',
      'button[aria-label*="Send" i]',
      'button:has(svg[data-icon="paper-plane"])',
      'button:has(svg[data-icon="send"])',
      'button',
    ];
    for (const s of sels) {
      const els = document.querySelectorAll(s);
      for (const el of els) {
        if (isVisible(el) && el.textContent.trim().length < 30) return el;
      }
    }
    return null;
  }

  function l(msg) {
    try {
      fetch(`${LOG}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'CS', level: 'INFO', message: `[CS] ${msg}`, ts: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }

  async function typeText(inputEl, text) {
    inputEl.focus();
    if (inputEl.tagName === 'TEXTAREA') { inputEl.value = ''; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (inputEl.tagName === 'DIV') { inputEl.textContent = ''; inputEl.innerHTML = ''; }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inputEl.tagName === 'TEXTAREA') inputEl.value += ch;
      else inputEl.textContent += ch;
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: ch === '\n' ? 'insertLineBreak' : 'insertText', data: ch }));
      let ms;
      if (ch === ' ') ms = 20 + Math.random() * 15;
      else if (ch === '.' || ch === ',') ms = 15 + Math.random() * 10;
      else if (ch === '\n') ms = 25 + Math.random() * 15;
      else ms = 8 + Math.random() * 12;
      await sleep(ms);
    }
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickSend() {
    const btn = findSendBtn();
    if (btn) { btn.click(); return true; }
    const inp = findInput();
    if (inp) {
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
      return true;
    }
    return false;
  }

  async function waitForEl(checkFn, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = checkFn();
      if (el) return el;
      await sleep(500);
    }
    return null;
  }

  function scheduleReturnToIdle() {
    if (_returnTimer) clearTimeout(_returnTimer);
    l(`[IDLE] Return to messages in ${RETRY_AFTER_SEND_MS / 1000}s`);
    _returnTimer = setTimeout(async () => {
      _state = 'idle';
      if (!isIdle()) {
        l(`[IDLE] → tevi.com/messages`);
        window.location.href = IDLE_URL;
      } else {
        l(`[IDLE] → already on messages`);
        startIdleRefresh();
      }
    }, RETRY_AFTER_SEND_MS);
  }

  // ── IDLE PAGE REFRESH (detect new unread chats) ───────────────────────
  function startIdleRefresh() {
    if (_idleRefreshTimer) clearInterval(_idleRefreshTimer);
    l(`[IDLE] Starting page refresh every 10s`);
    _idleRefreshTimer = setInterval(() => {
      if (_state === 'idle' && isIdle()) {
        l(`[IDLE] Refreshing messages page...`);
        window.location.reload();
      } else {
        stopIdleRefresh();
      }
    }, 10000);
  }

  function stopIdleRefresh() {
    if (_idleRefreshTimer) {
      clearInterval(_idleRefreshTimer);
      _idleRefreshTimer = null;
      l(`[IDLE] Stopped page refresh`);
    }
  }

  // Start idle refresh immediately when on messages page
  if (isIdle()) startIdleRefresh();

  // ── MESSAGE LISTENER ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'DOM_SEND') {
      const { text, slug } = msg;
      const currentSlug = getSlug();

      if (_busy && slug === _lastSlug && text === _lastMsg) {
        l(`[DOM_SEND] Duplicate ignored (busy with ${slug})`);
        sendResp({ ok: false, reason: 'duplicate', slug });
        return true;
      }

      _busy = true;
      _lastSlug = slug;
      _lastMsg = text;
      _state = 'replying';
      l(`[DOM_SEND] → @${slug} (${text.length} chars) state=${_state}`);

      (async () => {
        try {
          if (currentSlug !== slug) {
            l(`[DOM_SEND] Navigate to @${slug}/messages...`);
            window.location.href = DM_URL(slug);
            await waitForEl(() => findInput(), 15000);
            await sleep(800);
          }

          const input = await waitForEl(() => findInput(), 15000);
          if (!input) {
            l(`[DOM_SEND] ❌ Input not found`);
            _busy = false; _state = 'idle';
            sendResp({ ok: false, reason: 'no_input', slug }); return;
          }

          await typeText(input, text);
          await sleep(200);

          const sent = await clickSend();
          if (sent) {
            l(`[DOM_SEND] ✅ Sent to @${slug}`);
            scheduleReturnToIdle();
            sendResp({ ok: true, slug });
          } else {
            l(`[DOM_SEND] ❌ Send failed`);
            _busy = false; _state = 'idle';
            sendResp({ ok: false, reason: 'send_failed', slug });
          }
        } catch (e) {
          l(`[DOM_SEND] ❌ ${e.message}`);
          _busy = false; _state = 'idle';
          sendResp({ ok: false, reason: e.message, slug });
        } finally {
          _busy = false;
        }
      })();
      return true;
    }

    if (msg.type === 'GET_DOM') {
      sendResp({
        slug: getSlug(),
        hasInput: !!findInput(),
        hasSendBtn: !!findSendBtn(),
        url: location.href,
        state: _state,
        isIdle: isIdle(),
      });
      return true;
    }

    if (msg.type === 'CANCEL_RETURN') {
      if (_returnTimer) { clearTimeout(_returnTimer); _returnTimer = null; }
      l(`[DOM_SEND] Return-to-idle cancelled`);
      sendResp({ ok: true });
      return true;
    }
  });

  l(`v0.6.0 active — ${location.href} [state=${_state}]`);
})();
