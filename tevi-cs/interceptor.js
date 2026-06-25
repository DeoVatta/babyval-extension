/**
 * API INTERCEPTOR — Tevi CS Bot (v0.1.0.3)
 * Monkey-patch fetch/XHR on tevi.com to auto-capture the real API endpoint
 * Stores discovered endpoint in chrome.storage.local — background.js uses it
 */

(function() {
  'use strict';

  const LOG_SERVER = 'http://localhost:3131';
  const STORAGE_KEY = 'tevi_cs_api_state';

  function sendLog(msg, level = 'INFO') {
    try {
      fetch(`${LOG_SERVER}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'INTERCEPTOR', level, message: msg }),
      }).catch(() => {});
    } catch {}
  }

  function isConversationUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      return u.hostname.includes('wapi.flowstreamx.com') &&
             u.pathname.includes('conversation') &&
             !u.pathname.includes('/read') &&
             !u.pathname.includes('/send') &&
             !u.pathname.includes('/message');
    } catch { return false; }
  }

  function saveEndpoint(url) {
    try {
      const u = new URL(url, window.location.origin);
      const clean = u.pathname + '?' + u.search.split('&').filter(p =>
        !p.startsWith('verify=')
      ).join('&');
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        const state = data[STORAGE_KEY] || {};
        if (!state.discoveredEndpoint) {
          state.discoveredEndpoint = clean;
          state.discoveredAt = new Date().toISOString();
          chrome.storage.local.set({ [STORAGE_KEY]: state });
          sendLog(`[INTERCEPTOR] ✅ Endpoint discovered: ${clean}`, 'INFO');
        }
      });
    } catch {}
  }

  // ── Monkey-patch fetch — once ──────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = init?.method || 'GET';

    if (url.includes('wapi.flowstreamx.com') && isConversationUrl(url)) {
      sendLog(`[INTERCEPTOR] 🔍 ${method} ${url.substring(url.indexOf('/messenger'))}`, 'DEBUG');
    }

    const res = await _fetch.apply(this, arguments);

    // If this was a conversations GET, capture the endpoint
    if (url.includes('wapi.flowstreamx.com') && isConversationUrl(url) && method === 'GET') {
      saveEndpoint(url);
      // Also try to read response body
      try {
        const clone = res.clone();
        const json = await clone.json();
        if (json?.data?.results) {
          sendLog(`[INTERCEPTOR] ✅ Conversations response OK! count=${json.data.results.length}`, 'INFO');
        } else if (json?.success === false) {
          sendLog(`[INTERCEPTOR] ❌ Conversations response FAIL: ${json.message}`, 'ERROR');
        }
      } catch {}
    }

    return res;
  };

  // ── Monkey-patch XMLHttpRequest ───────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__tevi_url = url;
    this.__tevi_method = method;
    return _open.call(this, method, url, ...rest);
  };

  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__tevi_url && isConversationUrl(this.__tevi_url)) {
      sendLog(`[INTERCEPTOR] 🔍 XHR ${this.__tevi_method} ${this.__tevi_url.substring(this.__tevi_url.indexOf('/messenger'))}`, 'DEBUG');
      saveEndpoint(this.__tevi_url);
    }
    return _send.call(this, body);
  };

  sendLog('[INTERCEPTOR] ✅ Active — watching tevi.com API calls');
})();
