/**
 * CONTENT SCRIPT — Tevi CS Bot v0.5.0.0
 * DOM automation: open chat, type message, click send
 * Receives commands from background via chrome.runtime.sendMessage
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const LOG = 'http://localhost:3131';

  // ── DOM HELPERS ────────────────────────────────────────────────────────
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
    const sels = [
      'button[type="submit"]',
      'button[aria-label*="Kirim" i]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="kirim" i]',
      'div[role="button"][aria-label*="Kirim" i]',
      'div[role="button"][aria-label*="Send" i]',
      'button:has(svg[data-icon="paper-plane"])',
      'button:has(svg[data-icon="send"])',
      'button',
    ];
    for (const s of sels) {
      const els = document.querySelectorAll(s);
      for (const el of els) {
        if (isVisible(el) && el.textContent.trim()) return el;
      }
    }
    return document.querySelector('button:last-child') || null;
  }

  function getSlug() {
    const m = location.href.match(/tevi\.com\/@([^/]+)/);
    return m ? m[1] : null;
  }

  function l(msg, lvl = 'INFO') {
    try {
      fetch(`${LOG}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'CS', level: lvl, message: `[CS] ${msg}`, ts: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }

  async function typeCharByChar(el, text) {
    el.focus();
    // Clear
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.textContent = '';
      el.innerHTML = '';
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
      } else {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.value += ch;
        } else {
          el.textContent += ch;
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      }
      // Human-like delay
      let ms;
      if (ch === ' ' || ch === '.') ms = 80 + Math.random() * 80;
      else if (ch === ',' || ch === '!' || ch === '?') ms = 60 + Math.random() * 50;
      else if (ch === '\n') ms = 120 + Math.random() * 80;
      else ms = 35 + Math.random() * 65;
      await sleep(ms);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickSend() {
    const btn = findSendBtn();
    if (!btn) {
      // Fallback: Enter key
      const inp = findInput();
      if (inp) {
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(50);
        return true;
      }
      return false;
    }
    btn.click();
    return true;
  }

  async function waitForEl(checkFn, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = checkFn();
      if (el) return el;
      await sleep(600);
    }
    return null;
  }

  // ── MESSAGE LISTENER ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'DOM_SEND') {
      const { text, slug } = msg;
      const currentSlug = getSlug();
      l(`[DOM_SEND] target=@${slug} current=${currentSlug} len=${text.length}`);

      (async () => {
        try {
          if (currentSlug !== slug) {
            // Navigate to correct chat
            l(`[DOM_SEND] Navigating to @${slug}/messages...`);
            window.location.href = `https://tevi.com/@${slug}/messages`;
            // Wait for navigation to complete
            await waitForEl(() => findInput(), 20000);
            await sleep(500);
          }

          const input = await waitForEl(() => findInput(), 12000);
          if (!input) {
            lE('[DOM_SEND] Input not found');
            sendResp({ ok: false, reason: 'no_input', slug });
            return;
          }

          l(`[DOM_SEND] Typing ${text.length} chars...`);
          await typeCharByChar(input, text);
          await sleep(250);

          const sent = await clickSend();
          if (sent) {
            l(`[DOM_SEND] ✅ Sent to @${slug}`);
            sendResp({ ok: true, slug });
          } else {
            lE('[DOM_SEND] Send failed');
            sendResp({ ok: false, reason: 'send_failed', slug });
          }
        } catch (e) {
          lE(`[DOM_SEND] Error: ${e.message}`);
          sendResp({ ok: false, reason: e.message, slug });
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
      });
      return true;
    }
  });

  function lE(msg) { l(msg, 'ERROR'); }
  l(`[CS] v0.5.0.0 active — ${location.href}`);
})();
