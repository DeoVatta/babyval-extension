/**
 * TEVI FULL API SNIFFER — v0.9.8
 *
 * Purpose: Auto-discover ALL domains that Tevi.com uses for API calls.
 * Replaces fixed-domain sniffer with universal capture.
 * Reports findings to both local storage AND Supabase.
 *
 * How it works:
 * - Monkey-patches window.fetch (captures ALL fetch calls)
 * - Monkey-patches XMLHttpRequest (captures ALL XHR calls)
 * - Reads localStorage for Tevi auth tokens
 * - Reads cookies for Tevi session
 * - Reports to log server + Supabase
 */

(function() {
  if (window.__TEVI_SNIFFER__) return;
  window.__TEVI_SNIFFER__ = true;

  // ── Guard: prevent self-capture loop ────────────────────────────────
  // When reporting TO Supabase, set this flag so the patched fetch skips it.
  let __reporting = false;
  function safeReport(fn) {
    __reporting = true;
    try { fn(); } catch {}
    __reporting = false;
  }

  // ── Supabase domain list to skip (don't capture our own calls) ───────
  const SKIP_DOMAINS = new Set([
    'qjemyvydivekolywleji.supabase.co',
    'localhost',
  ]);

  const LOG = 'http://localhost:3131';
  const SUPABASE_URL = 'https://qjemyvydivekolywleji.supabase.co';
  const LOG_FUNC = SUPABASE_URL + '/functions/v1/cs-bot-logger';
  const PROBE_FUNC = SUPABASE_URL + '/functions/v1/api-auto-probe';
  const STORAGE_KEY = 'tevi_api_catalog';

  // ── Logging ────────────────────────────────────────────────────────

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

  // ── Supabase logging (uses safeReport to prevent self-capture) ───────

  function logToSupabase(data) {
    safeReport(() => {
      fetch(LOG_FUNC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer devata-token',
        },
        body: JSON.stringify({
          _type: 'api_discovery',
          event: 'sniffer_capture',
          ...data,
          ts: new Date().toISOString(),
        }),
      }).catch(() => {});
      fetch(PROBE_FUNC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer devata-token',
        },
        body: JSON.stringify({
          event: 'sniffer_capture',
          ...data,
        }),
      }).catch(() => {});
    });
  }

  // ── Read Tevi Auth ─────────────────────────────────────────────────

  function getTeviAuth() {
    const result = {
      domain: window.location.hostname,
      url: window.location.href,
      tokens: {},
      cookies: {},
      localStorageKeys: [],
    };

    // Read localStorage
    try {
      const keys = Object.keys(localStorage);
      result.localStorageKeys = keys;
      for (const k of keys) {
        const v = localStorage.getItem(k);
        if (k.includes('token') || k.includes('auth') || k.includes('user')) {
          result.tokens[k] = String(v).substring(0, 100);
        }
        // Also check for user_id (your UID is 392388705)
        if (k === 'user_id') {
          result.tokens['user_id'] = v;
        }
      }
    } catch {}

    // Read cookies
    try {
      const pairs = document.cookie.split(';');
      for (const pair of pairs) {
        const [k, ...v] = pair.trim().split('=');
        result.cookies[k] = v.join('=').substring(0, 100);
      }
    } catch {}

    return result;
  }

  // ── Capture & Report Auth ──────────────────────────────────────────

  const auth = getTeviAuth();
  log('INFO', 'Active on ' + auth.domain + auth.url);
  log('INFO', 'localStorage keys: ' + auth.localStorageKeys.length, auth.tokens);
  log('INFO', 'Cookies: ' + Object.keys(auth.cookies).join(', '));

  // Report to Supabase
  safeReport(() => logToSupabase({
    event: 'sniffer_activated',
    url: auth.url,
    tokens: auth.tokens,
    localStorageKeys: auth.localStorageKeys,
    cookieKeys: Object.keys(auth.cookies),
  });

  // ── Universal Fetch Interceptor ─────────────────────────────────────
  // Capture ALL fetch calls, not just wapi.flowstreamx.com

  const _fetch = window.fetch;
  const _xhrOpen = XMLHttpRequest.prototype.open;
  const _xhrSend = XMLHttpRequest.prototype.send;

  // Track unique domains seen
  const seenDomains = new Set();
  const seenEndpoints = [];
  const startTime = Date.now();

  function extractUrlInfo(url) {
    try {
      // Handle relative URLs
      if (url.startsWith('/')) {
        url = window.location.origin + url;
      }
      const u = new URL(url);
      return {
        domain: u.hostname,
        pathname: u.pathname,
        search: u.search,
        full: u.href,
      };
    } catch {
      return { domain: 'unknown', pathname: url, search: '', full: url };
    }
  }

  function processApiCall(method, url, status, reqBody, resBody, latency) {
    const info = extractUrlInfo(url);

    // Skip self-calls and browser internal calls
    if (SKIP_DOMAINS.has(info.domain)) return;
    if (info.domain.includes('google') || info.domain.includes('facebook') ||
        info.domain.includes('doubleclick') || info.domain.includes('postman') ||
        info.domain.includes('chrome-extension')) {
      return;
    }

    // Skip non-API calls (images, fonts, etc)
    const ext = info.pathname.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'css', 'js', 'woff', 'woff2'].includes(ext)) {
      return;
    }

    const entry = {
      domain: info.domain,
      method,
      path: info.pathname,
      fullUrl: info.full,
      status,
      reqBody: reqBody ? String(reqBody).substring(0, 200) : null,
      resBody: resBody ? String(resBody).substring(0, 300) : null,
      latency,
      ts: Date.now() - startTime,
    };

    seenDomains.add(info.domain);
    seenEndpoints.push(entry);

    // Log first time we see a new domain
    log('INFO', 'API: ' + method + ' ' + info.domain + info.pathname + ' → ' + status, { latency, body: reqBody });

    // Send to Supabase immediately for new domains
    logToSupabase({
      event: 'api_call',
      ...entry,
    });
  }

  // Monkey-patch fetch
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();
    const start = Date.now();

    // Guard: skip if we're in a report cycle
    if (__reporting) return _fetch.apply(this, arguments);

    try {
      const res = await _fetch.apply(this, arguments);
      const latency = Date.now() - start;
      const info = extractUrlInfo(url);

      if (info.domain && !SKIP_DOMAINS.has(info.domain)) {
        try {
          const clone = res.clone();
          const text = await clone.text().catch(() => '');
          processApiCall(method, url, res.status, init?.body, text, latency);

          if (info.pathname.includes('auth') || info.pathname.includes('login') ||
              info.pathname.includes('token') || info.pathname.includes('conversations') ||
              info.pathname.includes('messages') || info.pathname.includes('users')) {
            safeReport(() => log('INFO', 'KEY API: ' + info.domain + info.pathname + ' [' + res.status + ']', { latency }));
          }
        } catch {}
      }

      return res;
    } catch (e) {
      const latency = Date.now() - start;
      processApiCall(method, url, 0, init?.body, 'ERROR: ' + e.message, latency);
      throw e;
    }
  };

  // Monkey-patch XHR
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__xhr_url = url;
    this.__xhr_method = method.toUpperCase();
    this.__xhr_start = Date.now();
    return _xhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const url = this.__xhr_url;

    const onLoadHandler = () => {
      if (__reporting) return;
      const latency = Date.now() - (this.__xhr_start || Date.now());
      try {
        processApiCall(this.__xhr_method || 'GET', url, this.status || 200, body, this.responseText, latency);
      } catch {}
    };

    if (this.addEventListener) {
      this.addEventListener('load', onLoadHandler);
    }

    return _xhrSend.call(this, body);
  };

  // ── Periodic Summary Report ─────────────────────────────────────────

  function reportSummary() {
    if (seenEndpoints.length === 0) return;

    log('INFO', '=== SNIFFER SUMMARY ===', {
      domains: [...seenDomains],
      totalCalls: seenEndpoints.length,
      uptime: Date.now() - startTime,
    });

    // Save to local storage
    try {
      chrome.storage.local.get(STORAGE_KEY, r => {
        const catalog = r[STORAGE_KEY] || { endpoints: {}, domains: [] };
        for (const ep of seenEndpoints) {
          const key = ep.method + ' ' + ep.path;
          if (!catalog.endpoints[key]) {
            catalog.endpoints[key] = { ...ep, seenCount: 1, firstSeen: Date.now() };
          } else {
            catalog.endpoints[key].seenCount++;
          }
        }
        catalog.domains = [...new Set([...(catalog.domains || []), ...seenDomains])];
        catalog.lastUpdated = Date.now();
        chrome.storage.local.set({ [STORAGE_KEY]: catalog });
      });
    } catch {}

    logToSupabase({
      event: 'sniffer_summary',
      domains: [...seenDomains],
      totalCalls: seenEndpoints.length,
      topEndpoints: seenEndpoints.slice(0, 20),
    });

    seenEndpoints.length = 0; // reset
  }

  // Report every 30 seconds
  setInterval(reportSummary, 30000);

  // ── Send initial activation report ─────────────────────────────────

  setTimeout(() => {
    log('INFO', 'Sniffer active for 5s — domains seen: ' + [...seenDomains].join(', '));
    if (seenDomains.size === 0) {
      log('INFO', 'NO API CALLS DETECTED — Tevi might use WebSocket instead of HTTP');
      logToSupabase({ event: 'no_http_calls', url: auth.url });
    }
  }, 5000);

})();
