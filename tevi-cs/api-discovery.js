/**
 * API DISCOVERY & INTERCEPTOR — Tevi CS Bot v0.9.5
 *
 * Two modes:
 * 1. DISCOVERY — capture ALL wapi.flowstreamx.com calls, log everything
 *    → Used to discover all available Tevi API endpoints
 * 2. PATTERN — capture specific send-message pattern for bot usage
 *    → Used by the bot to send DMs without tab
 *
 * All discovered endpoints are stored in chrome.storage for future use.
 */

(function() {
  if (window.__TEVI_API__) return;
  window.__TEVI_API__ = true;

  const LOG = 'http://localhost:3131';
  const API_HOST = 'wapi.flowstreamx.com';
  const STORAGE_KEY = 'tevi_api_catalog';
  const SUPABASE_URL = 'https://qjemyvydivekolywleji.supabase.co';
  const LOG_FUNC = SUPABASE_URL + '/functions/v1/cs-bot-logger';

  // ── Logging ────────────────────────────────────────────────────────

  function log(msg, data) {
    try {
      fetch(LOG + '/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'API',
          level: 'INFO',
          message: '[API] ' + msg,
          ts: new Date().toISOString(),
          ...(data || {}),
        }),
      }).catch(() => {});
    } catch {}
  }

  // ── Log to Supabase (persistent, not just local) ──────────────────
  function logToSupabase(endpointData) {
    try {
      // Send to the existing edge function with a special type
      fetch(LOG_FUNC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer devata-token', // validated server-side
        },
        body: JSON.stringify({
          _type: 'api_discovery',
          ...endpointData,
          ts: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
  }

  // ── API Catalog Storage ─────────────────────────────────────────────

  function getCatalog() {
    return new Promise(resolve => {
      chrome.storage.local.get(STORAGE_KEY, r => {
        resolve(r[STORAGE_KEY] || { endpoints: {}, conversations: [], messages: {}, lastUpdated: null });
      });
    });
  }

  function saveCatalog(catalog) {
    catalog.lastUpdated = Date.now();
    chrome.storage.local.set({ [STORAGE_KEY]: catalog });
  }

  // ── Endpoint Discovery ──────────────────────────────────────────────

  async function discoverEndpoint(method, url, status, reqBody, resBody) {
    // Extract path from full URL
    let path = url;
    try {
      const u = new URL(url);
      path = u.pathname + u.search;
    } catch {}

    const catalog = await getCatalog();
    const epKey = `${method} ${path}`;

    // Check if this is a new or updated endpoint
    const isNew = !catalog.endpoints[epKey];
    const prev = catalog.endpoints[epKey] || {};

    catalog.endpoints[epKey] = {
      method,
      path,
      url,
      firstSeen: prev.firstSeen || Date.now(),
      lastSeen: Date.now(),
      lastStatus: status,
      sampleRequest: prev.sampleRequest || (reqBody ? String(reqBody).substring(0, 500) : null),
      sampleResponse: prev.sampleResponse || (resBody ? String(resBody).substring(0, 500) : null),
      queryParams: prev.queryParams || extractQueryParams(path),
      seenCount: (prev.seenCount || 0) + 1,
    };

    saveCatalog(catalog);

    // Log to Supabase for persistence
    logToSupabase({
      event: 'endpoint_discovered',
      method,
      path,
      url,
      status,
      seenCount: catalog.endpoints[epKey]?.seenCount || 1,
    });

    if (isNew) {
      log('[DISCOVER] NEW ENDPOINT: ' + method + ' ' + path + ' → ' + status, { url, reqBody, resBody });
      logToSupabase({ event: 'new_endpoint', method, path, url, status, reqBody, resBody });
    }
  }

  function extractQueryParams(path) {
    try {
      const u = new URL('https://x.com' + path);
      return Object.fromEntries(u.searchParams.entries());
    } catch { return {}; }
  }

  // ── Conversation Cache ───────────────────────────────────────────────

  async function cacheConversations(method, url, resBody) {
    if (!url.includes('/conversations') && !url.includes('/dm/')) return;
    try {
      const data = typeof resBody === 'string' ? JSON.parse(resBody) : resBody;
      if (data.conversations || data.data || Array.isArray(data)) {
        const list = data.conversations || data.data || data;
        const catalog = await getCatalog();
        catalog.conversations = list.map(c => ({
          id: c.id || c.conv_id || c.conversationId,
          username: c.username || c.user?.username || c.name,
          slug: c.slug || c.username,
          lastMessage: c.lastMessage || c.last_message || c.message,
          lastMessageAt: c.lastMessageAt || c.last_message_at || c.updatedAt,
          unreadCount: c.unreadCount || c.unread_count || 0,
          isMember: c.isMember || c.is_member || c.membership || false,
          hasReplied: c.hasReplied || c.has_replied || false,
          avatar: c.avatar || c.avatarUrl || c.user?.avatar,
          cachedAt: Date.now(),
        }));
        saveCatalog(catalog);
        log('[CACHE] ' + list.length + ' conversations cached from API', { url });
      }
    } catch (e) {
      log('[CACHE] Failed to parse conversations: ' + e.message);
    }
  }

  // ── Message Cache ──────────────────────────────────────────────────

  async function cacheMessages(url, resBody) {
    if (!url.includes('/messages') && !url.includes('/chat/')) return;
    try {
      const data = typeof resBody === 'string' ? JSON.parse(resBody) : resBody;
      const msgs = data.messages || data.data || data;
      if (Array.isArray(msgs)) {
        const slug = extractSlugFromUrl(url);
        const catalog = await getCatalog();
        catalog.messages[slug] = {
          messages: msgs.map(m => ({
            id: m.id,
            sender: m.sender?.username || m.senderUsername || m.from,
            text: m.text || m.message || m.content,
            hasImage: !!(m.image || m.media || m.attachments?.length),
            timestamp: m.createdAt || m.timestamp || m.sentAt,
            readAt: m.readAt || null,
            seen by: m.seenAt || null,
          })),
          cachedAt: Date.now(),
        };
        saveCatalog(catalog);
      }
    } catch (e) {}
  }

  function extractSlugFromUrl(url) {
    try {
      const m = url.match(/tevi\.com\/@([^/]+)/);
      return m ? m[1] : 'unknown';
    } catch { return 'unknown'; }
  }

  // ── Auth Token Capture ─────────────────────────────────────────────

  function captureAuth() {
    const needed = ['access_token', 'token', 'session', 'auth', 'Authorization'];
    const found = {};
    for (const name of needed) {
      const val = document.cookie.split(';').find(c => c.trim().startsWith(name + '='));
      if (val) found[name] = val.trim();
    }
    // Also check localStorage/sessionStorage
    for (const k of ['token', 'accessToken', 'authToken', 'user', 'session']) {
      try {
        const v = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (v) found['ls_' + k] = String(v).substring(0, 100);
      } catch {}
    }
    return found;
  }

  // ── Monkey-patch Fetch ─────────────────────────────────────────────

  const _fetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();

    if (url.includes(API_HOST)) {
      const reqBody = init?.body;
      const headers = init?.headers || {};
      let authHeader = '';
      if (typeof headers.get === 'function') {
        authHeader = headers.get('Authorization') || '';
      } else if (Array.isArray(headers)) {
        authHeader = Object.fromEntries(headers)['Authorization'] || '';
      } else {
        authHeader = headers['Authorization'] || '';
      }

      log('[API] ' + method + ' ' + url.replace('https://' + API_HOST, ''), { reqBody: String(reqBody).substring(0, 200) });

      const res = await _fetch.apply(this, arguments);

      // Clone response to read body
      try {
        const clone = res.clone();
        const text = await clone.text();
        if (text.length < 10000) {
          discoverEndpoint(method, url, res.status, reqBody, text);
          cacheConversations(method, url, text);
          cacheMessages(url, text);

          // Check for send-message pattern
          if (url.match(/send|message/i) && method === 'POST') {
            chrome.runtime.sendMessage({
              type: 'API_SEND_PATTERN',
              url,
              method,
              headers: { Authorization: authHeader },
              bodyFields: parseBody(reqBody),
              capturedAt: Date.now(),
            });
          }
        } else {
          discoverEndpoint(method, url, res.status, reqBody, '[RESPONSE TOO LARGE — ' + text.length + ' bytes]');
        }
      } catch (e) {
        discoverEndpoint(method, url, res.status, reqBody, '[PARSE ERROR: ' + e.message + ']');
      }

      return res;
    }

    return _fetch.apply(this, arguments);
  };

  function parseBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch { return { raw: body }; }
    }
    return body;
  }

  // ── Monkey-patch XHR ────────────────────────────────────────────────

  const _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__tevi_url = url;
    this.__tevi_method = method.toUpperCase();
    return _xhrOpen.call(this, method, url, ...rest);
  };

  const _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__tevi_url && this.__tevi_url.includes(API_HOST)) {
      log('[XHR] ' + this.__tevi_method + ' ' + this.__tevi_url.replace('https://' + API_HOST, ''), { body: String(body).substring(0, 200) });
      discoverEndpoint(this.__tevi_method, this.__tevi_url, null, body, null);
    }
    return _xhrSend.call(this, body);
  };

  // ── Init ───────────────────────────────────────────────────────────

  const auth = captureAuth();
  log('[DISCOVER] Active on ' + location.href);
  log('[DISCOVER] Auth keys found: ' + Object.keys(auth).join(', '), { auth });

  if (auth.token || auth.accessToken || auth.ls_token || auth.ls_accessToken) {
    log('[DISCOVER] AUTH TOKEN AVAILABLE — API calls will be authenticated');
  }

  chrome.storage.local.get(STORAGE_KEY, r => {
    const cat = r[STORAGE_KEY] || {};
    const epCount = Object.keys(cat.endpoints || {}).length;
    log('[DISCOVER] Catalog: ' + epCount + ' endpoints known', cat.endpoints);
  });
})();
