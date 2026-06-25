/**
 * CONTENT SCRIPT — Tevi CS Bot v0.5.2.0
 * DOM automation: type + send (visible)
 * Deduplicated: ignores duplicate DOM_SEND for same slug
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const LOG = 'http://localhost:3131';
  let _busy = false; // Lock: prevents overlapping sends
  let _lastSlug = null;
  let _lastMsg = null;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function findInput() {
    const sels = [
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      'div[contenteditable]',
      'textarea',
      'input[type="text"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findSendBtn() {
    // Try specific selectors first
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

  function getSlug() {
    const m = location.href.match(/tevi\.com\/@([^/]+)/);
    return m ? m[1] : null;
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
    // Clear
    if (inputEl.tagName === 'TEXTAREA') { inputEl.value = ''; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (inputEl.tagName === 'DIV') { inputEl.textContent = ''; inputEl.innerHTML = ''; }

    // Type char by char — fast
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inputEl.tagName === 'TEXTAREA') {
        inputEl.value += ch;
      } else {
        inputEl.textContent += ch;
      }
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: ch === '\n' ? 'insertLineBreak' : 'insertText', data: ch }));
      // Fast human-like delay
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
    if (btn) {
      btn.click();
      return true;
    }
    // Fallback: Enter key
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

  // ── MESSAGE LISTENER ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'DOM_SEND') {
      const { text, slug } = msg;
      const currentSlug = getSlug();

      // Deduplicate: ignore if already sending same message to same slug
      if (_busy && slug === _lastSlug && text === _lastMsg) {
        l(`[DOM_SEND] Duplicate ignored (busy with ${slug})`);
        sendResp({ ok: false, reason: 'duplicate', slug });
        return true;
      }

      _busy = true;
      _lastSlug = slug;
      _lastMsg = text;
      l(`[DOM_SEND] → @${slug} (${text.length} chars) busy=${_busy}`);

      (async () => {
        try {
          // If on wrong page, warn and fail (no auto-navigate — tab navigation kills the port)
          if (currentSlug !== slug) {
            l(`[DOM_SEND] Wrong page @${currentSlug} (need @${slug}) — skipping`);
            _busy = false; sendResp({ ok: false, reason: 'wrong_page', slug, need: slug }); return;
          }

          // Wait for DOM to settle after page load
          await sleep(800);

          const input = await waitForEl(() => findInput(), 15000);
          if (!input) {
            l(`[DOM_SEND] ❌ Input not found`);
            _busy = false; sendResp({ ok: false, reason: 'no_input', slug }); return;
          }

          await typeText(input, text);
          await sleep(200);

          const sent = await clickSend();
          if (sent) {
            l(`[DOM_SEND] ✅ Sent to @${slug}`);
            sendResp({ ok: true, slug });
          } else {
            l(`[DOM_SEND] ❌ Send failed`);
            sendResp({ ok: false, reason: 'send_failed', slug });
          }
        } catch (e) {
          l(`[DOM_SEND] ❌ ${e.message}`);
          sendResp({ ok: false, reason: e.message, slug });
        } finally {
          _busy = false;
        }
      })();
      return true;
    }

    if (msg.type === 'GET_DOM') {
      sendResp({ slug: getSlug(), hasInput: !!findInput(), hasSendBtn: !!findSendBtn(), url: location.href });
      return true;
    }
  });

  l(`v0.5.2.0 active — ${location.href}`);
})();
