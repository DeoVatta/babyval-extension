/**
 * CONTENT SCRIPT — Tevi CS Bot v0.9.12
 *
 * Unified system handles:
 * - SCAN_CONVS: find all convs needing reply (no ✓/✓✓ icon = user last)
 * - CHECK_DM: check if last msg has check icon + extract timestamp
 * - GET_MSGS: read last N USER messages (not Sukii)
 * - IS_MEMBERSHIP: detect membership badge
 * - INTERCEPT_SEND: capture Tevi's send-message API call
 * - SNIFFER: universal API discovery (all domains) at startup
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
    // Priority 1: anchor links matching /@username/messages (v0.8 strategy — PROVEN WORK)
    const allLinks = Array.from(document.querySelectorAll('a[href*="/@"]'));
    const convLinks = allLinks.filter(a => {
      return a.href && a.href.match(/tevi\.com\/@[^/]+\/messages/);
    });
    if (convLinks.length > 0) {
      const seen = new Set();
      const containers = [];
      for (const a of convLinks) {
        let el = a.closest('[class*="conversation"]') || a.closest('li') || a.parentElement;
        const key = el ? (el.dataset.convId || el.className || a.href) : a.href;
        if (!seen.has(key)) {
          seen.add(key);
          containers.push({ el: el || a, strategy: 'dm-link' });
        }
      }
      if (containers.length > 0) return containers;
    }

    // Priority 2: data attribute (Tevi's internal ID)
    const byData = Array.from(document.querySelectorAll('[data-conv-id]'));
    if (byData.length > 0) return byData.map(el => ({ el, strategy: 'data-conv-id' }));

    // Priority 3: specific conversation class names
    const byClass = Array.from(document.querySelectorAll('[class*="conversation-item"]'));
    if (byClass.length > 0) return byClass.map(el => ({ el, strategy: 'conversation-item' }));

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
    // Priority 1: From anchor href (MOST RELIABLE) — supports both full URL and relative
    const link = el.closest('a[href*="/@"]') || el.querySelector('a[href*="/@"]');
    if (link && link.href) {
      // Full URL: tevi.com/@username or relative: /@username
      const m = link.href.match(/(?:tevi\.com)?\/@([^/?#]+)/);
      if (m && m[1]) return m[1];
    }
    // Priority 2: From data attribute
    const dataSlug = el.dataset.username || el.dataset.slug || el.dataset.name || el.dataset.convId;
    if (dataSlug && dataSlug.length < 50 && dataSlug.match(/^[a-zA-Z0-9_]+$/)) {
      return dataSlug;
    }
    // Priority 3: walk up DOM to find anchor (supports relative href)
    let parent = el;
    for (let i = 0; i < 5; i++) {
      if (!parent) break;
      const anchors = parent.querySelectorAll('a[href*="/@"]');
      for (const a of anchors) {
        const m = a.href.match(/(?:tevi\.com)?\/@([^/?#]+)/);
        if (m && m[1]) return m[1];
      }
      parent = parent.parentElement;
    }
    return null; // Don't guess from text content
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
    l('[SCAN-DBG] findConvItems returned ' + items.length + ' items');
    if (items.length > 0) {
      l('[SCAN-DBG] first item class="' + (items[0].el?.className || items[0].className || '') + '"');
      l('[SCAN-DBG] first item tag="' + (items[0].el?.tagName || items[0].tagName || '') + '"');
    }
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
      // Capture ALL tevi.com API calls (universal — no hardcoded domain)
      // Tevi's API can be at any subdomain, so we check the hostname
      let hostname = '';
      try { hostname = new URL(url).hostname; } catch {}
      const isTeviApi = hostname.includes('tevi.com') || hostname.includes('flowstreamx') || hostname.includes('wapi');
      if (!isTeviApi) return;
      // Must look like a message/chat/send API
      if (!url.match(/send|message|chat|conversation/i)) return;

      captured = true;
      let parsedBody = {};
      if (body && typeof body === 'string') {
        try { parsedBody = JSON.parse(body); } catch {}
      } else if (typeof body === 'object') {
        parsedBody = body;
      }

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
      let domain = '';
      try { domain = new URL(url).hostname; } catch {}
      l('[INTERCEPT] Captured: ' + method + ' ' + domain + new URL(url).pathname);
    }

    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = (init?.method || 'GET').toUpperCase();
      const headers = init?.headers;
      if (method === 'POST') {
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
      if (this.__tevi_url && this.__tevi_method === 'POST') {
        tryCapture(this.__tevi_url, this.__tevi_method, {}, body);
      }
      return _xhrSend.call(this, body);
    };

    l('[INTERCEPT] Send capture active — universal (all tevi domains)');
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

  l('v0.9.12 active — ' + location.href);

  // ═══════════════════════════════════════════════════════════════
  // SNIFFER — Universal API Discovery (all domains)
  // Auto-runs at startup, captures every API call Tevi makes
  // ═══════════════════════════════════════════════════════════════

  (function() {
    if (window.__TEVI_SNIFFER__) return;
    window.__TEVI_SNIFFER__ = true;

    const LOG = 'http://localhost:3131';
    const SUPABASE_URL = 'https://qjemyvydivekolywleji.supabase.co';
    const LOG_FUNC = SUPABASE_URL + '/functions/v1/cs-bot-logger';
    const PROBE_FUNC = SUPABASE_URL + '/functions/v1/api-auto-probe';
    const SKIP_DOMAINS = new Set([
      'qjemyvydivekolywleji.supabase.co',
      'localhost',
    ]);

    function log(level, msg, data) {
      try {
        fetch(LOG + '/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'SNIFFER',
            level: level || 'INFO',
            message: '[SNIFFER] ' + msg,
            ts: new Date().toISOString(),
            ...(data || {}),
          }),
        }).catch(() => {});
      } catch {}
    }

    function extractUrlInfo(url) {
      try {
        if (url.startsWith('/')) url = location.origin + url;
        const u = new URL(url);
        return { domain: u.hostname, pathname: u.pathname, full: u.href };
      } catch {
        return { domain: 'unknown', pathname: url, full: url };
      }
    }

    function getTeviAuth() {
      const result = { tokens: {}, cookies: {}, localStorageKeys: [] };
      try {
        result.localStorageKeys = Object.keys(localStorage);
        for (const k of result.localStorageKeys) {
          if (k.includes('token') || k.includes('auth') || k.includes('user') || k === 'user_id') {
            result.tokens[k] = String(localStorage.getItem(k)).substring(0, 100);
          }
        }
      } catch {}
      try {
        for (const pair of document.cookie.split(';')) {
          const [k, ...v] = pair.trim().split('=');
          result.cookies[k] = v.join('=').substring(0, 100);
        }
      } catch {}
      return result;
    }

    const auth = getTeviAuth();
    log('INFO', 'Active on ' + auth.domain + location.pathname);
    log('INFO', 'localStorage keys: ' + auth.localStorageKeys.length, auth.tokens);

    const seenDomains = new Set();
    const seenEndpoints = [];

    function processApiCall(method, url, status, reqBody, resBody, latency) {
      const info = extractUrlInfo(url);
      if (SKIP_DOMAINS.has(info.domain)) return;
      if (info.domain.includes('google') || info.domain.includes('facebook') ||
          info.domain.includes('chrome-extension')) return;

      const ext = info.pathname.split('.').pop().toLowerCase();
      if (['jpg', 'png', 'gif', 'svg', 'css', 'js', 'woff'].includes(ext)) return;

      const entry = {
        domain: info.domain,
        method,
        path: info.pathname,
        fullUrl: info.full,
        status,
        reqBody: reqBody ? String(reqBody).substring(0, 200) : null,
        resBody: resBody ? String(resBody).substring(0, 300) : null,
        latency,
      };

      seenDomains.add(info.domain);
      seenEndpoints.push(entry);

      if (info.pathname.includes('auth') || info.pathname.includes('login') ||
          info.pathname.includes('token') || info.pathname.includes('conversations') ||
          info.pathname.includes('messages') || info.pathname.includes('users')) {
        log('INFO', 'KEY API: ' + info.domain + info.pathname + ' [' + status + ']', { latency });
      }
    }

    const _fetch = window.fetch;
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = (init?.method || 'GET').toUpperCase();
      const start = Date.now();
      try {
        const res = await _fetch.apply(this, arguments);
        const latency = Date.now() - start;
        const info = extractUrlInfo(url);
        if (info.domain && !SKIP_DOMAINS.has(info.domain)) {
          try {
            const text = await res.clone().text().catch(() => '');
            processApiCall(method, url, res.status, init?.body, text, latency);
          } catch {}
        }
        return res;
      } catch (e) {
        processApiCall(method, url, 0, init?.body, 'ERROR: ' + e.message, Date.now() - start);
        throw e;
      }
    };

    const _xhrOpen = XMLHttpRequest.prototype.open;
    const _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__xhr_url = url;
      this.__xhr_method = method.toUpperCase();
      this.__xhr_start = Date.now();
      return _xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(body) {
      const onLoad = () => {
        const latency = Date.now() - (this.__xhr_start || Date.now());
        try { processApiCall(this.__xhr_method || 'GET', this.__xhr_url, this.status || 200, body, this.responseText, latency); } catch {}
      };
      if (this.addEventListener) this.addEventListener('load', onLoad);
      return _xhrSend.call(this, body);
    };

    function reportToSupabase(data) {
      try {
        fetch(LOG_FUNC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer devata-token' },
          body: JSON.stringify({ _type: 'api_discovery', event: 'sniffer_capture', ...data, ts: new Date().toISOString() }),
        }).catch(() => {});
        fetch(PROBE_FUNC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer devata-token' },
          body: JSON.stringify({ event: 'sniffer_capture', ...data }),
        }).catch(() => {});
      } catch {}
    }

    function reportSummary() {
      if (!seenEndpoints.length) return;
      log('INFO', '=== SNIFFER SUMMARY ===', {
        domains: [...seenDomains],
        totalCalls: seenEndpoints.length,
      });
      reportToSupabase({ event: 'sniffer_summary', domains: [...seenDomains], topEndpoints: seenEndpoints.slice(0, 20) });
      seenEndpoints.length = 0;
    }

    setInterval(reportSummary, 30000);
    setTimeout(() => {
      const domains = [...seenDomains];
      log('INFO', 'Sniffer active 5s — domains: ' + (domains.join(', ') || 'NONE'));
      if (!domains.length) {
        log('INFO', 'NO API CALLS — Tevi may use WebSocket');
        reportToSupabase({ event: 'no_http_calls' });
      }
    }, 5000);
  })();
})();
