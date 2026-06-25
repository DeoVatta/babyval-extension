/**
 * INTERCEPTOR v0.8 — Capture Tevi API send-message endpoint + auth
 * Run ONCE on tevi.com to capture the exact API call used to send DMs
 * Sends captured data to log server
 */

(function() {
  if (window.__TEVI_INTERCEPT__) return;
  window.__TEVI_INTERCEPT__ = true;

  const LOG = 'http://localhost:3131';

  function sendLog(msg) {
    try {
      fetch(LOG + '/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'INTERCEPT', level: 'INFO', message: msg, ts: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }

  function captureCookies() {
    const needed = ['access_token', 'token', 'session', 'auth'];
    const found = {};
    for (const name of needed) {
      const val = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
      if (val) found[name] = val.trim();
    }
    return found;
  }

  function captureLocalStorage() {
    const keys = ['token', 'accessToken', 'authToken', 'user', 'session', 'apiKey'];
    const found = {};
    for (const k of keys) {
      try {
        const v = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (v) found[k] = v;
      } catch {}
    }
    return found;
  }

  // Monkey-patch fetch
  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();

    // Log ALL wapi.flowstreamx calls
    if (url.includes('wapi.flowstreamx')) {
      const headers = init?.headers || {};
      const headersObj = {};
      if (headers instanceof Headers) {
        headers.forEach((v, k) => headersObj[k] = v);
      } else if (Array.isArray(headers)) {
        headers.forEach(([k, v]) => headersObj[k] = v);
      } else {
        Object.assign(headersObj, headers);
      }

      sendLog('[INTERCEPT] ' + method + ' ' + url.substring(url.indexOf('/wapi')) + ' HEADERS:' + JSON.stringify(headersObj).substring(0, 300));

      // Capture response too
      const res = await _fetch.apply(this, arguments);
      try {
        const clone = res.clone();
        const text = await clone.text();
        if (text.length < 2000) {
          sendLog('[INTERCEPT] RESP ' + method + ' ' + url.substring(url.indexOf('/wapi')) + ' → ' + text.substring(0, 500));
        }
      } catch {}
      return res;
    }

    return _fetch.apply(this, arguments);
  };

  // Monkey-patch XHR send
  const _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__tevi_url = url;
    this.__tevi_method = method.toUpperCase();
    return _xhrOpen.call(this, method, url, ...rest);
  };

  const _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__tevi_url && this.__tevi_url.includes('wapi.flowstreamx')) {
      sendLog('[INTERCEPT] XHR ' + this.__tevi_method + ' ' + this.__tevi_url.substring(this.__tevi_url.indexOf('/wapi')) + ' BODY:' + String(body).substring(0, 300));
    }
    return _xhrSend.call(this, body);
  };

  // Capture onload
  const _xhrOnload = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'onload')?.get;
  if (!_xhrOnload) {
    XMLHttpRequest.prototype.addEventListener('load', function() {
      if (this.__tevi_url && this.__tevi_url.includes('wapi.flowstreamx')) {
        sendLog('[INTERCEPT] XHR RESP ' + this.__tevi_method + ' → ' + (this.responseText || '').substring(0, 500));
      }
    });
  }

  // Also capture WebSocket messages (Tevi might use WS for real-time)
  if (window.WebSocket) {
    const _ws = window.WebSocket;
    window.WebSocket = function(url, ...rest) {
      if (url && url.includes('wapi.flowstreamx')) {
        sendLog('[INTERCEPT] WS CONNECT: ' + url);
      }
      const ws = new _ws(url, ...rest);
      const _onmsg = ws.onmessage;
      ws.onmessage = function(e) {
        sendLog('[INTERCEPT] WS MSG: ' + String(e.data).substring(0, 300));
        if (_onmsg) _onmsg.call(ws, e);
      };
      return ws;
    };
    window.WebSocket.CONNECTING = _ws.CONNECTING;
    window.WebSocket.OPEN = _ws.OPEN;
    window.WebSocket.CLOSING = _ws.CLOSING;
    window.WebSocket.CLOSED = _ws.CLOSED;
  }

  const cookies = captureCookies();
  const storage = captureLocalStorage();

  sendLog('[INTERCEPT] Active on ' + location.href);
  sendLog('[INTERCEPT] Cookies: ' + JSON.stringify(Object.keys(cookies)));
  sendLog('[INTERCEPT] Storage keys: ' + JSON.stringify(Object.keys(storage)));
  if (storage.token || storage.accessToken) {
    sendLog('[INTERCEPT] TOKEN FOUND: ' + (storage.token || storage.accessToken));
  }

  // Send stored auth to log
  chrome.runtime.sendMessage({ type: 'INTERCEPT_AUTH', cookies, storage }).catch(() => {});
})();
