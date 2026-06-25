/**
 * CONTENT SCRIPT — Tevi CS Bot v0.8
 * DOM-based detection: scan convs via ✓/✓✓ icons
 * getUnreadConvs: returns all convs that need a reply
 * getMessages: returns last N messages from the chat
 * getLastMsgStatus: checks if last msg has ✓/✓✓ icon
 * domSend: type + send + verify
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const LOG = 'http://localhost:3131';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function l(msg) {
    try {
      fetch(LOG + '/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'CS', level: 'INFO', message: '[CS] ' + msg, ts: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }

  // ── CONV LIST SCANNER (tevi.com/messages) ───────────────────────────────

  function getSlug() {
    const m = location.href.match(/tevi\.com\/@([^/]+)/);
    return m ? m[1] : null;
  }

  // Find all conversation items in the sidebar
  function findConvItems() {
    // Try multiple selectors — Tevi uses dynamic class names
    const selectors = [
      'a[href*="/messages"]',
      '[data-conv-id]',
      '[data-sender]',
      '[class*="conversation"]',
      '[class*="conv-item"]',
      'li[class*="conversation"]',
    ];
    for (const s of selectors) {
      const els = Array.from(document.querySelectorAll(s));
      if (els.length > 0) return els;
    }
    return [];
  }

  // Check if last message has ✓ or ✓✓ icon (Sukii already replied)
  function hasRepliedIcon(msgEl) {
    if (!msgEl) return false;
    // Look for check icons: ✓✓ = icon-check-double, ✓ = icon-check
    const html = msgEl.innerHTML;
    if (html.includes('icon-check-double') || html.includes('check-double')) return true;
    if (html.includes('icon-check"') || html.includes('check"') || html.includes('icon-check\'')) {
      // Make sure it's not check-double
      if (html.includes('check-double')) return true;
      return true; // single check = Sukii replied
    }
    // Also check for SVG-based icons
    const svgs = msgEl.querySelectorAll('svg');
    for (const svg of svgs) {
      const alt = svg.getAttribute('alt') || '';
      const html2 = svg.outerHTML || '';
      if (alt.includes('check-double') || html2.includes('check-double')) return true;
      if (alt.includes('check') || html2.includes('icon-check') || html2.includes('check.svg')) return true;
    }
    return false;
  }

  // Get the latest message element in a conv list item
  function getLastMsgEl(convEl) {
    // Try to find the message preview text element
    const selectors = [
      '[class*="last-message"]',
      '[class*="lastMsg"]',
      '[class*="preview"]',
      '[class*="message-preview"]',
      '[class*="conv-preview"]',
      'p[class*="message"]',
      'span[class*="message"]',
    ];
    for (const s of selectors) {
      const el = convEl.querySelector(s);
      if (el) return el;
    }
    // Fallback: just return the conv element itself if it has text
    return convEl;
  }

  // Extract conv slug from a conversation element
  function extractConvSlug(convEl) {
    // Try href attribute
    const link = convEl.closest('a') || convEl.querySelector('a');
    if (link) {
      const m = link.href.match(/tevi\.com\/@([^/]+)/);
      if (m) return m[1];
    }
    // Try data attributes
    const slug = convEl.dataset.slug || convEl.dataset.username || convEl.dataset.name;
    if (slug) return slug;
    // Try text content to find @username
    const text = convEl.textContent || '';
    const m = text.match(/@([a-zA-Z0-9_]+)/);
    if (m) return m[1];
    return null;
  }

  // Check if conv has an unread indicator (dot, badge, etc)
  function hasUnreadBadge(convEl) {
    const selectors = [
      '[class*="unread"]',
      '[class*="badge"]',
      '[class*="dot"]',
      '[class*="notification"]',
      '[data-unread]',
    ];
    for (const s of selectors) {
      const el = convEl.querySelector(s);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  // Scan ALL conversations on messages page, return slugs that need reply
  function scanConvs() {
    const items = findConvItems();
    const unread = [];

    for (const item of items) {
      const slug = extractConvSlug(item);
      if (!slug || slug === 'cutieval' || slug === getSlug()) continue;

      const lastMsgEl = getLastMsgEl(item);
      const replied = hasRepliedIcon(lastMsgEl);
      const unreadBadge = hasUnreadBadge(item);

      if (!replied || unreadBadge) {
        unread.push({ slug, hasUnread: unreadBadge });
      }
    }

    return unread;
  }

  // ── MESSAGE SCANNER (DM page) ────────────────────────────────────────────

  // Get all message elements in the current DM chat
  function findMessageEls() {
    const selectors = [
      '[class*="message"]',
      '[class*="chat-item"]',
      '[class*="msg-item"]',
      '[role="listitem"]',
      '[data-msg-id]',
      'div[class*="bubble"]',
    ];
    for (const s of selectors) {
      const els = Array.from(document.querySelectorAll(s));
      if (els.length > 3) return els;
    }
    return [];
  }

  // Check if a message is from the USER (not from Sukii/cutieval)
  function isFromUser(msgEl) {
    // Check for "you" indicator or sender info
    const html = msgEl.innerHTML || '';
    const cls = (msgEl.className || '').toLowerCase();
    const text = msgEl.textContent || '';

    // Own messages often have different styling
    // Try to find sender info
    const senderEl = msgEl.querySelector('[class*="sender"]') || msgEl.querySelector('[class*="name"]');
    if (senderEl) {
      const senderText = senderEl.textContent || '';
      if (senderText.toLowerCase().includes('you') || senderText.toLowerCase().includes('kamu')) {
        return true;
      }
    }

    // Right-aligned messages are typically own messages
    if (cls.includes('right') || cls.includes('outgoing') || cls.includes('own') || cls.includes('sent')) {
      return false; // This is Sukii's message
    }

    // Left-aligned messages are from others
    if (cls.includes('left') || cls.includes('incoming') || cls.includes('received')) {
      return true; // This is user's message
    }

    // Check if message has avatar of the other user
    const avatarEl = msgEl.querySelector('[class*="avatar"]');
    if (avatarEl) {
      // If the avatar shows something other than Sukii, it's from user
      const avatarText = avatarEl.textContent || '';
      if (!avatarText.includes('Sukii') && !avatarText.includes('cutieval')) {
        return true;
      }
    }

    // Check for image in message (user sending content)
    if (msgEl.querySelector('img[class*="attachment"]') || msgEl.querySelector('[class*="image"] img')) {
      return true;
    }

    // Check for the "you" prefix in text
    if (text.trim().startsWith('You:') || text.trim().startsWith('Kamu:')) {
      return true;
    }

    return false;
  }

  // Check if last message has ✓/✓✓ icon (Sukii replied)
  function checkLastMsgReplied() {
    const msgs = findMessageEls();
    if (msgs.length === 0) return { replied: false, lastMsgText: '', hasImage: false };

    const lastMsg = msgs[msgs.length - 1];
    const replied = hasRepliedIcon(lastMsg);
    const text = (lastMsg.textContent || '').trim();

    // Check if last msg has image
    const hasImage = !!(lastMsg.querySelector('img[src*="image"]') ||
      lastMsg.querySelector('img[class*="attachment"]') ||
      lastMsg.querySelector('[class*="image"]') ||
      lastMsg.querySelector('[class*="media"]'));

    return { replied, lastMsgText: text.substring(0, 100), hasImage };
  }

  // Get last N messages from USER (not Sukii)
  function getLastNMessages(n = 4) {
    const msgs = findMessageEls();
    const userMsgs = [];

    for (const msgEl of msgs) {
      if (isFromUser(msgEl)) {
        const text = (msgEl.textContent || '').trim();
        if (text) {
          const hasImage = !!(msgEl.querySelector('img'));
          userMsgs.push({ text: text.substring(0, 500), hasImage });
        }
      }
    }

    return userMsgs.slice(-n);
  }

  // ── SEND ────────────────────────────────────────────────────────────────

  function findInput() {
    const specific = document.getElementById('_r_17_');
    if (specific && isVisible(specific)) return specific;
    const sels = ['textarea', 'div[contenteditable="true"]', 'div[role="textbox"]', 'div[contenteditable]', 'input[type="text"]'];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findSendBtn() {
    const BLOCKLIST = ['get-star','buy','purchase','donate','tip','payment','bayar','langganan','subscribe','premium','upgrade'];
    const byId = document.getElementById('dm-chat-send-message-btn');
    if (byId && isVisible(byId)) return byId;
    const sels = [
      'button[aria-label*="Kirim" i]',
      'button[aria-label*="Send" i]',
      'button:has(svg[data-icon="paper-plane"])',
      'button:has(svg[data-icon="send"])',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    const btns = document.querySelectorAll('button');
    for (const el of btns) {
      if (!isVisible(el)) continue;
      const txt = (el.textContent || '').toLowerCase();
      const title = (el.title || '').toLowerCase();
      if (BLOCKLIST.some(k => txt.includes(k) || title.includes(k))) continue;
      if (el.textContent.trim().length > 25) continue;
      if (el.querySelector('svg') && !txt.includes('send') && !txt.includes('kirim')) continue;
      return el;
    }
    return null;
  }

  async function typeText(inputEl, text) {
    inputEl.focus();
    if (inputEl.tagName === 'TEXTAREA') { inputEl.value = ''; inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (inputEl.tagName === 'DIV') { inputEl.textContent = ''; inputEl.innerHTML = ''; }
    await sleep(800);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inputEl.tagName === 'TEXTAREA') inputEl.value += ch;
      else inputEl.textContent += ch;
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: ch === '\n' ? 'insertLineBreak' : 'insertText', data: ch }));
      let ms;
      if (ch === ' ') ms = 50 + Math.random() * 40;
      else if (ch === '.') ms = 80 + Math.random() * 60;
      else if (ch === ',') ms = 60 + Math.random() * 40;
      else if (ch === '\n') ms = 100 + Math.random() * 80;
      else ms = 30 + Math.random() * 40;
      await sleep(ms);
    }
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickSend() {
    const inp = findInput();
    if (!inp) return false;
    const textBefore = inp.tagName === 'TEXTAREA' ? inp.value : inp.textContent;
    if (!textBefore || textBefore.trim().length === 0) return false;
    const btn = findSendBtn();
    if (btn) { btn.click(); return true; }
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }

  async function verifySent() {
    await sleep(2000);
    const msgs = findMessageEls();
    for (const m of msgs) {
      const t = m.textContent || '';
      if (t.includes('Halo aku Sukii') || t.includes('Sukii, AI')) return true;
    }
    const inp = findInput();
    if (inp) {
      const val = inp.tagName === 'TEXTAREA' ? inp.value : inp.textContent;
      if (!val || val.trim() === '') return true;
    }
    return false;
  }

  async function domSend(text) {
    const input = findInput();
    if (!input) return false;
    await sleep(1500);
    await typeText(input, text);
    await sleep(1200);
    const sent = await clickSend();
    if (!sent) return false;
    return await verifySent();
  }

  // ── MESSENGER ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {

    // SCAN: get all unread convs from messages page
    if (msg.type === 'SCAN_CONVS') {
      const slug = getSlug();
      const convs = scanConvs();
      l('[SCAN] ' + convs.length + ' unread convs found');
      sendResp({ ok: true, convs, currentSlug: slug, url: location.href });
      return true;
    }

    // CHECK: check if current DM needs reply
    if (msg.type === 'CHECK_DM') {
      const status = checkLastMsgReplied();
      l('[CHECK] replied=' + status.replied + ' text="' + status.lastMsgText.substring(0, 30) + '"');
      sendResp({ ok: true, ...status, slug: getSlug(), url: location.href });
      return true;
    }

    // GET_MSGS: get last N user messages from current DM
    if (msg.type === 'GET_MSGS') {
      const msgs = getLastNMessages(msg.count || 4);
      l('[GET_MSGS] ' + msgs.length + ' user msgs');
      sendResp({ ok: true, messages: msgs, slug: getSlug() });
      return true;
    }

    // DOM_SEND: type + send in current DM
    if (msg.type === 'DOM_SEND') {
      const { text } = msg;
      l('[DOM_SEND] ' + text.length + ' chars');
      (async () => {
        try {
          const ok = await domSend(text);
          sendResp({ ok, slug: getSlug() });
        } catch (e) {
          l('[DOM_SEND] ERROR: ' + e.message);
          sendResp({ ok: false, reason: e.message });
        }
      })();
      return true;
    }

    // GET_DOM: basic DOM state
    if (msg.type === 'GET_DOM') {
      sendResp({ slug: getSlug(), hasInput: !!findInput(), hasSendBtn: !!findSendBtn(), url: location.href });
      return true;
    }

    // REFRESH: reload current page
    if (msg.type === 'REFRESH') {
      l('[REFRESH] Reloading...');
      location.reload();
      sendResp({ ok: true });
      return true;
    }

    // INTERCEPT_SEND: monkey-patch fetch/XHR to capture Tevi's send-message API call
    if (msg.type === 'INTERCEPT_SEND') {
      (function() {
        const _fetch = window.fetch;
        const _xhrOpen = XMLHttpRequest.prototype.open;
        const _xhrSend = XMLHttpRequest.prototype.send;
        let captured = false;
        function tryCapture(url, method, headers, body) {
          if (captured) return;
          if (url.includes('send') || url.includes('message') || url.includes('chat')) {
            captured = true;
            chrome.runtime.sendMessage({ type: 'API_SEND_PATTERN', url, method, headers, bodyFields: body });
            l('[INTERCEPT] Captured: ' + method + ' ' + url.substring(url.indexOf('/wapi')));
          }
        }
        window.fetch = async function(input, init) {
          const url = typeof input === 'string' ? input : input?.url || '';
          const method = (init?.method || 'GET').toUpperCase();
          if (url.includes('wapi.flowstreamx') && method === 'POST') {
            let hdrs = {}; if (init?.headers instanceof Headers) init.headers.forEach((v, k) => hdrs[k] = v);
            else if (init?.headers) hdrs = { ...init.headers };
            tryCapture(url, method, hdrs, init?.body);
          }
          return _fetch.apply(this, arguments);
        };
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__tevi_url = url; this.__tevi_method = method.toUpperCase();
          return _xhrOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function(body) {
          if (this.__tevi_url && this.__tevi_url.includes('wapi.flowstreamx')) tryCapture(this.__tevi_url, this.__tevi_method, {}, body);
          return _xhrSend.call(this, body);
        };
        l('[INTERCEPT] Send capture active');
      })();
      sendResp({ ok: true });
      return true;
    }

    // PING
    if (msg.type === 'PING') {
      sendResp({ ok: true, slug: getSlug(), url: location.href });
      return true;
    }
  });

  l('v0.9 active — ' + location.href);
})();
