/**
 * CONTENT SCRIPT — Tevi CS Bot v0.9.1
 *
 * Handles:
 * - SCAN_CONVS: find all convs needing reply (no ✓/✓✓ icon = user last)
 * - CHECK_DM: check if last msg has check icon + extract timestamp
 * - GET_MSGS: read last N USER messages (not Sukii)
 * - IS_MEMBERSHIP: detect membership badge
 * - INTERCEPT_SEND: capture Tevi's send-message API call
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const LOG = 'http://localhost:3131';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isVisible(el) {
    if (!el) return false;
    try {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
    } catch { return false; }
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

  function findConvItems() {
    // Priority 1: data attribute (most reliable — Tevi's internal ID)
    const byData = Array.from(document.querySelectorAll('[data-conv-id]'));
    if (byData.length > 0) return byData.map(el => ({ el, strategy: 'data-conv-id' }));

    // Priority 2: specific conversation class names
    const byClass = Array.from(document.querySelectorAll(
      '[class*="conversation-item"]'
    ));
    if (byClass.length > 0) return byClass.map(el => ({ el, strategy: 'conversation-item' }));

    // Priority 3: links matching /@username/messages
    const allLinks = Array.from(document.querySelectorAll('a[href*="/@"]'));
    const convLinks = allLinks.filter(a => {
      return a.href && a.href.match(/tevi\.com\/@[^/]+\/messages/);
    });
    if (convLinks.length > 0) {
      const seen = new Set();
      const containers = [];
      for (const a of convLinks) {
        // Walk up to find the conv container
        let el = a.closest('[class*="conversation"]');
        if (!el) el = a.closest('li') || a.parentElement;
        const key = el ? (el.dataset.convId || el.className || a.href) : a.href;
        if (!seen.has(key)) {
          seen.add(key);
          containers.push({ el: el || a, strategy: 'dm-link' });
        }
      }
      if (containers.length > 0) return containers;
    }

    // Priority 4: list items in conversation list
    const listItems = Array.from(document.querySelectorAll(
      'ul[class*="list"] > li, ul[class*="conv"] > li, ul[class*="message"] > li'
    ));
    const filtered = listItems.filter(li => {
      const text = li.textContent || '';
      return text.includes('@') && text.length > 5 && text.length < 200;
    });
    if (filtered.length > 0) return filtered.map(el => ({ el, strategy: 'list-item' }));

    // Priority 5: any element with username-like content
    const candidates = Array.from(document.querySelectorAll('a[href*="/@"], [data-username]'));
    const unique = [];
    const keys = new Set();
    for (const c of candidates) {
      const el = c.closest('[class*="conv"]') || c.closest('li') || c;
      const key = el.className + (el.dataset.convId || '');
      if (!keys.has(key) && (el.textContent || '').length > 3) {
        keys.add(key);
        unique.push({ el, strategy: 'fallback' });
      }
    }
    return unique;
  }

  // ── CHECK ICON (✓ = Sukii replied, no icon = USER last) ──────────────

  function hasRepliedIcon(el) {
    if (!el) return false;
    // Look for SVG check icons
    const svgs = el.querySelectorAll('svg');
    for (const svg of svgs) {
      const outer = svg.outerHTML || '';
      const alt = svg.getAttribute('alt') || '';
      const aria = svg.getAttribute('aria-label') || '';
      const src = svg.getAttribute('src') || '';

      // Double check = Sukii sent and delivered
      if (outer.includes('check-double') || outer.includes('icon-check-double')) return true;
      if (alt.includes('check-double') || aria.includes('check-double')) return true;
      if (src.includes('check-double')) return true;

      // Single check = Sukii read receipt
      if (outer.includes('icon-check') && !outer.includes('double')) return true;
      if (alt.includes('check') && !alt.includes('double')) return true;
      if (src.includes('icon-check') && !src.includes('double')) return true;
    }

    // Look for img with check icon
    const imgs = el.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      if (src.includes('check-double')) return true;
      if (src.includes('icon-check') && !src.includes('double')) return true;
      if (alt.includes('check') && !alt.includes('double')) return true;
    }

    // Look for icon-font elements
    const icons = el.querySelectorAll('[class*="icon-check"]');
    for (const ic of icons) {
      const cls = ic.className || '';
      if (cls.includes('check-double')) return true;
      if (cls.includes('check') && !cls.includes('double')) return true;
    }

    return false;
  }

  // ── EXTRACT INFO FROM CONV ITEM ───────────────────────────────────────

  function extractConvSlug(containerEl) {
    const el = containerEl.el || containerEl;
    // From anchor href
    const link = el.closest('a') || el.querySelector('a[href*="/@"]');
    if (link && link.href) {
      const m = link.href.match(/tevi\.com\/@([^/]+)/);
      if (m && m[1]) return m[1];
    }
    // From data attribute
    const dataSlug = el.dataset.username || el.dataset.slug || el.dataset.name;
    if (dataSlug) return dataSlug;
    // From text content
    const text = el.textContent || '';
    const m = text.match(/@([a-zA-Z0-9_]{2,20})/);
    if (m) return m[1];
    return null;
  }

  function getLastMsgPreview(containerEl) {
    const el = containerEl.el || containerEl;
    // Try specific selectors for message preview
    const selectors = [
      '[class*="last-message"]',
      '[class*="preview"]',
      '[class*="msg-preview"]',
      '[class*="message-preview"]',
      'p[class*="msg"]',
      'span[class*="msg"]',
      '[class*="conv-preview"]',
    ];
    for (const s of selectors) {
      const found = el.querySelector(s);
      if (found && isVisible(found)) return found;
    }
    // Fallback: return the conv item itself if it has text
    if ((el.textContent || '').length > 0) return el;
    return null;
  }

  function hasUnreadBadge(containerEl) {
    const el = containerEl.el || containerEl;
    const selectors = [
      '[class*="unread"]',
      '[class*="badge"]',
      '[class*="notification-dot"]',
      '[data-unread="true"]',
      '[aria-label*="unread" i]',
    ];
    for (const s of selectors) {
      const found = el.querySelector(s);
      if (found && isVisible(found)) return true;
    }
    return false;
  }

  function isMembershipConv(containerEl) {
    const el = containerEl.el || containerEl;
    const selectors = [
      '[class*="badge"][class*="member"]',
      '[class*="badge"][class*="premium"]',
      '[class*="badge"][class*="vip"]',
      '[class*="member-badge"]',
      '[class*="premium-badge"]',
      '[data-membership="true"]',
      '[data-plan*="member"]',
      '[data-plan*="premium"]',
    ];
    for (const s of selectors) {
      const found = el.querySelector(s);
      if (found) {
        const text = (found.textContent || '').toLowerCase();
        if (text.match(/member|premium|vip| subscribed/i)) return true;
      }
    }
    // Also check data attributes
    const attrs = ['membership', 'member', 'premium', 'plan', 'subscription'];
    for (const attr of attrs) {
      const val = el.getAttribute('data-' + attr) || el.dataset[attr] || '';
      if (String(val).toLowerCase().match(/member|premium|vip/)) return true;
    }
    return false;
  }

  function getConvTimestamp(containerEl) {
    const el = containerEl.el || containerEl;
    // Look for time element
    const timeEl = el.querySelector('time') ||
                    el.querySelector('[class*="time"]') ||
                    el.querySelector('[class*="date"]') ||
                    el.querySelector('[data-time]');
    if (timeEl) {
      const datetime = timeEl.getAttribute('datetime');
      if (datetime) {
        const ts = new Date(datetime).getTime();
        if (!isNaN(ts)) return ts;
      }
      const text = (timeEl.textContent || '').trim();
      // Parse relative time: "2m ago", "1h ago", "yesterday"
      const mins = text.match(/(\d+)\s*m(?!s)/);
      const hours = text.match(/(\d+)\s*h/);
      const days = text.match(/(\d+)\s*d/);
      if (mins) return Date.now() - parseInt(mins[1]) * 60 * 1000;
      if (hours) return Date.now() - parseInt(hours[1]) * 60 * 60 * 1000;
      if (days) return Date.now() - parseInt(days[1]) * 24 * 60 * 60 * 1000;
    }
    return null;
  }

  // ── SCAN ─────────────────────────────────────────────────────────────

  function scanConvs() {
    const items = findConvItems();
    if (!items.length) return [];

    const currentSlug = getSlug();
    const unreplied = [];

    for (const container of items) {
      const slug = extractConvSlug(container);
      if (!slug || slug.toLowerCase() === 'cutieval' || slug.toLowerCase() === currentSlug) continue;

      const lastMsgEl = getLastMsgPreview(container);
      const replied = hasRepliedIcon(lastMsgEl);
      const unreadBadge = hasUnreadBadge(container);
      const isMember = isMembershipConv(container);
      const lastMsgTs = getConvTimestamp(container);

      // Unreplied: Sukii NOT the last replier (no check icon = user last)
      // Membership: skip entirely
      if (!replied && !isMember) {
        unreplied.push({ slug, hasUnread: unreadBadge, lastMsgTs, isMember });
      }
    }

    return unreplied;
  }

  // ── MESSAGE SCANNER (DM page) ───────────────────────────────────────────

  function findMessageEls() {
    const selectors = [
      '[class*="message-item"]',
      '[class*="chat-item"]',
      '[class*="msg-item"]',
      '[class*="bubble"]',
      '[data-msg-id]',
      '[class*="message-bubble"]',
    ];
    for (const s of selectors) {
      const els = Array.from(document.querySelectorAll(s));
      if (els.length > 2) return els;
    }
    // Fallback: all divs that look like messages
    return [];
  }

  // Detect if message is from USER (not from Sukii/cutieval)
  // Strategy: right/left alignment, avatar, sender name, position
  function isFromUser(msgEl) {
    const cls = (msgEl.className || '').toLowerCase();
    const text = msgEl.textContent || '';
    const html = msgEl.innerHTML || '';

    // Strategy 1: CSS alignment classes
    if (cls.includes('right') || cls.includes('outgoing') || cls.includes('sent')) {
      return false; // Sukii's message (right-aligned = outgoing)
    }
    if (cls.includes('left') || cls.includes('incoming') || cls.includes('received')) {
      return true; // User's message
    }

    // Strategy 2: Avatar — if avatar is Sukii/cutieval, it's NOT from user
    const avatarEl = msgEl.querySelector('[class*="avatar"] img') ||
                     msgEl.querySelector('img[class*="avatar"]') ||
                     msgEl.querySelector('[class*="avatar"]');
    if (avatarEl) {
      const avatarAlt = (avatarEl.getAttribute('alt') || '').toLowerCase();
      const avatarSrc = (avatarEl.getAttribute('src') || '').toLowerCase();
      if (avatarAlt.includes('sukii') || avatarSrc.includes('sukii')) return false;
      if (avatarAlt.includes('cutieval') || avatarSrc.includes('cutieval')) return false;
      // Has avatar that's not Sukii → from user
      if (avatarAlt || avatarSrc) return true;
    }

    // Strategy 3: Sender name element
    const senderEl = msgEl.querySelector('[class*="sender-name"]') ||
                     msgEl.querySelector('[class*="username"]') ||
                     msgEl.querySelector('[data-sender]') ||
                     msgEl.querySelector('[class*="name"]');
    if (senderEl) {
      const senderText = (senderEl.textContent || '').toLowerCase();
      const senderData = senderEl.getAttribute('data-sender') || '';
      if (senderText.includes('sukii') || senderData.includes('sukii')) return false;
      if (senderText.includes('cutieval') || senderData.includes('cutieval')) return false;
      if (senderText || senderData) return true;
    }

    // Strategy 4: "You:" prefix in text
    if (text.trim().startsWith('You:') || text.trim().startsWith('Kamu:')) return true;

    // Strategy 5: Image attachment = user sent it
    if (msgEl.querySelector('img[src*="attachment"]') ||
        msgEl.querySelector('img[class*="media"]') ||
        msgEl.querySelector('[class*="image"] img')) {
      return true;
    }

    // Strategy 6: Checkmark icon = Sukii's message (already sent)
    if (hasRepliedIcon(msgEl)) return false;

    // Strategy 7: CSS float/textAlign
    try {
      const style = window.getComputedStyle(msgEl);
      if (style.textAlign === 'right' || style.cssFloat === 'right') return false;
      if (style.textAlign === 'left') return true;
    } catch {}

    return false;
  }

  function checkLastMsgReplied() {
    const msgs = findMessageEls();
    if (!msgs.length) return { replied: false, lastMsgText: '', hasImage: false, lastMsgTs: null };

    const lastMsg = msgs[msgs.length - 1];
    const replied = hasRepliedIcon(lastMsg);
    const text = (lastMsg.textContent || '').trim();
    const hasImage = !!(lastMsg.querySelector('img'));

    // Extract timestamp
    let lastMsgTs = null;
    const timeEl = lastMsg.querySelector('[class*="time"]') ||
                   lastMsg.querySelector('time') ||
                   lastMsg.querySelector('[class*="date"]');
    if (timeEl) {
      const datetime = timeEl.getAttribute('datetime');
      if (datetime) {
        const ts = new Date(datetime).getTime();
        if (!isNaN(ts)) lastMsgTs = ts;
      }
    }

    return { replied, lastMsgText: text.substring(0, 100), hasImage, lastMsgTs };
  }

  function getLastNMessages(n = 4) {
    const msgs = findMessageEls();
    const userMsgs = [];

    for (const msgEl of msgs) {
      if (isFromUser(msgEl)) {
        const text = (msgEl.textContent || '').trim();
        if (text && text.length > 0) {
          const hasImage = !!(msgEl.querySelector('img'));
          userMsgs.push({ text: text.substring(0, 500), hasImage });
        }
      }
    }

    // Return last N user messages
    return userMsgs.slice(-n);
  }

  // ── SEND (fallback — primary is API-based) ─────────────────────────────

  function findInput() {
    const byId = document.getElementById('_r_17_');
    if (byId && isVisible(byId)) return byId;
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
    const BLOCK = ['get-star','buy','purchase','donate','tip','payment','subscribe','premium'];
    const byId = document.getElementById('dm-chat-send-message-btn');
    if (byId && isVisible(byId)) return byId;
    const btns = document.querySelectorAll('button');
    for (const el of btns) {
      if (!isVisible(el)) continue;
      const txt = (el.textContent || '').toLowerCase();
      const title = (el.title || '').toLowerCase();
      if (BLOCK.some(k => txt.includes(k) || title.includes(k))) continue;
      if (el.textContent.trim().length > 30) continue;
      const svg = el.querySelector('svg');
      if (svg && !txt.includes('send') && !txt.includes('kirim')) continue;
      return el;
    }
    return null;
  }

  async function domSend(text) {
    const input = findInput();
    if (!input) return false;
    await sleep(1500);
    input.focus();
    if (input.tagName === 'TEXTAREA') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (input.tagName === 'DIV') { input.textContent = ''; input.innerHTML = ''; }
    await sleep(800);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (input.tagName === 'TEXTAREA') input.value += ch;
      else input.textContent += ch;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: ch === '\n' ? 'insertLineBreak' : 'insertText', data: ch }));
      let ms;
      if (ch === ' ') ms = 50 + Math.random() * 40;
      else if (ch === '.') ms = 80 + Math.random() * 60;
      else if (ch === ',') ms = 60 + Math.random() * 40;
      else ms = 30 + Math.random() * 40;
      await sleep(ms);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1200);
    const btn = findSendBtn();
    if (btn) btn.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(2000);
    const msgs = findMessageEls();
    for (const m of msgs) {
      if ((m.textContent || '').includes('Halo aku Sukii')) return true;
    }
    const inp = findInput();
    if (inp) {
      const val = inp.tagName === 'TEXTAREA' ? inp.value : inp.textContent;
      if (!val || val.trim() === '') return true;
    }
    return false;
  }

  // ── INTERCEPT SEND (capture Tevi's API call) ───────────────────────────

  let _interceptActive = false;

  function activateIntercept() {
    if (_interceptActive) return;
    _interceptActive = true;

    const _fetch = window.fetch;
    const _xhrOpen = XMLHttpRequest.prototype.open;
    const _xhrSend = XMLHttpRequest.prototype.send;
    let captured = false;

    function tryCapture(url, method, headers, body) {
      if (captured) return;
      if (!url.includes('wapi.flowstreamx')) return;
      if (!url.match(/send|message|chat/i)) return;

      captured = true;
      // Parse JSON body
      let parsedBody = {};
      if (body && typeof body === 'string') {
        try { parsedBody = JSON.parse(body); } catch {}
      } else if (typeof body === 'object') {
        parsedBody = body;
      }

      // Extract auth headers
      let authToken = '';
      if (headers) {
        if (typeof headers.get === 'function') {
          authToken = headers.get('Authorization') || headers.get('authorization') || '';
        } else {
          authToken = headers['Authorization'] || headers['authorization'] || '';
        }
      }

      chrome.runtime.sendMessage({
        type: 'API_SEND_PATTERN',
        url,
        method,
        headers: { Authorization: authToken },
        bodyFields: parsedBody,
        capturedAt: Date.now(),
      });
      l('[INTERCEPT] Captured: ' + method + ' ' + url.substring(url.indexOf('/wapi')));
    }

    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = (init?.method || 'GET').toUpperCase();
      const headers = init?.headers;
      if (url.includes('wapi.flowstreamx') && method === 'POST') {
        tryCapture(url, method, headers, init?.body);
      }
      return _fetch.apply(this, arguments);
    };

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__tevi_url = url;
      this.__tevi_method = method.toUpperCase();
      return _xhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
      if (this.__tevi_url) {
        tryCapture(this.__tevi_url, this.__tevi_method, {}, body);
      }
      return _xhrSend.call(this, body);
    };

    l('[INTERCEPT] Send capture active');
  }

  // ── MESSENGER ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {

    if (msg.type === 'SCAN_CONVS') {
      const convs = scanConvs();
      l('[SCAN] ' + convs.length + ' unreplied convs');
      sendResp({ ok: true, convs, currentSlug: getSlug(), url: location.href });
      return true;
    }

    if (msg.type === 'CHECK_DM') {
      const status = checkLastMsgReplied();
      l('[CHECK] replied=' + status.replied + ' ts=' + status.lastMsgTs);
      sendResp({ ok: true, ...status, slug: getSlug(), url: location.href });
      return true;
    }

    if (msg.type === 'GET_MSGS') {
      const msgs = getLastNMessages(msg.count || 4);
      l('[GET_MSGS] ' + msgs.length + ' user msgs');
      sendResp({ ok: true, messages: msgs, slug: getSlug() });
      return true;
    }

    if (msg.type === 'IS_MEMBERSHIP') {
      // Check current DM page for membership
      const convEl = document.querySelector('[class*="conversation"]') ||
                      document.querySelector('[class*="chat-header"]') ||
                      document.querySelector('[class*="dm-header"]');
      const isMember = convEl ? isMembershipConv({ el: convEl }) : false;
      sendResp({ ok: true, isMembership: isMember });
      return true;
    }

    if (msg.type === 'DOM_SEND') {
      const { text } = msg;
      l('[DOM_SEND] ' + text.length + ' chars');
      (async () => {
        try {
          const ok = await domSend(text);
          sendResp({ ok });
        } catch (e) {
          l('[DOM_SEND] ERROR: ' + e.message);
          sendResp({ ok: false, reason: e.message });
        }
      })();
      return true;
    }

    if (msg.type === 'INTERCEPT_SEND') {
      activateIntercept();
      sendResp({ ok: true });
      return true;
    }

    if (msg.type === 'GET_DOM') {
      sendResp({ slug: getSlug(), hasInput: !!findInput(), hasSendBtn: !!findSendBtn(), url: location.href });
      return true;
    }

    if (msg.type === 'REFRESH') {
      location.reload();
      sendResp({ ok: true });
      return true;
    }

    if (msg.type === 'PING') {
      sendResp({ ok: true, slug: getSlug(), url: location.href });
      return true;
    }
  });

  l('v0.9.1 active — ' + location.href);
})();
