/**
 * FULL API SNIFFER — Tevi CS Bot v0.2.1.0
 * Run SEPARATELY from overlay. Opens on tevi.com, captures ALL API calls.
 * Saves to chrome.storage.local → I (Claude) read from log server.
 *
 * HOW TO USE:
 * 1. Make sure extension is loaded (overlay.js normal)
 * 2. Open tevi.com and navigate to Messages / any page
 * 3. Open popup → Sniffer mode (or toggle sniff via chrome.storage)
 * 4. Use tevi.com normally for 2-3 minutes (open messages, profiles, etc.)
 * 5. Click the sniff button to dump to log server
 */

(function() {
  'use strict';

  if (window.__TEVI_SNIFFER__) return;
  window.__TEVI_SNIFFER__ = true;

  const VER = '0.2.1.0';
  const LOG = 'http://localhost:3131';
  const STORAGE_KEY = 'tevi_sniff';
  const SNIFF_ENABLED_KEY = 'tevi_sniff_enabled';

  // ── Logging ──────────────────────────────────────────────────────────────
  function sendLog(msg, level = 'INFO', data) {
    try {
      fetch(`${LOG}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'SNIFFER', level, message: msg, ts: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }

  // ── Save entry ───────────────────────────────────────────────────────────
  function saveEntry(entry) {
    chrome.storage.local.get(STORAGE_KEY, (d) => {
      const list = d[STORAGE_KEY] || [];
      list.push(entry);
      if (list.length > 1000) list.splice(0, list.length - 1000);
      chrome.storage.local.set({ [STORAGE_KEY]: list });
      updateBadge(list.length);
    });
  }

  function clearEntries() {
    chrome.storage.local.set({ [STORAGE_KEY]: [] });
    sendLog('[SNIFFER] Entries cleared', 'INFO');
    updateBadge(0);
  }

  // ── Dump all to log server ───────────────────────────────────────────────
  function dumpToLog() {
    chrome.storage.local.get(STORAGE_KEY, (d) => {
      const list = d[STORAGE_KEY] || [];
      sendLog(`[SNIFFER] ========== DUMP: ${list.length} entries ==========`, 'INFO');

      const byEndpoint = {};
      list.forEach(e => {
        try {
          const u = new URL(e.url, location.origin);
          const key = `${e.method} ${u.pathname}`;
          if (!byEndpoint[key]) byEndpoint[key] = [];
          byEndpoint[key].push({ status: e.status, bodyLen: e.bodyLen, ts: e.ts });
        } catch {}
      });

      sendLog(`[SNIFFER] Unique endpoints (${Object.keys(byEndpoint).length}):`, 'INFO');
      Object.entries(byEndpoint).forEach(([ep, entries]) => {
        const statuses = entries.map(e => e.status).filter(Boolean);
        const ok = statuses.filter(s => s >= 200 && s < 300).length;
        sendLog(`  ${ep} | ${entries.length}x | ${ok}/${statuses.length} OK | statuses: ${[...new Set(statuses)].join(',')}`, 'INFO');
      });

      sendLog('[SNIFFER] ========== FULL DETAIL ==========', 'INFO');
      list.forEach((e, i) => {
        try {
          const u = new URL(e.url, location.origin);
          const short = `${e.method} ${u.pathname}${u.search.substring(0, 60)}`;
          const bodyPreview = e.body ? (typeof e.body === 'string' ? e.body.substring(0, 100) : JSON.stringify(e.body).substring(0, 100)) : '';
          sendLog(`  [${i}] ${short} | status=${e.status || '?'} | body=${bodyPreview}`, 'INFO');
        } catch {
          sendLog(`  [${i}] ${e.url?.substring(0, 80)}`, 'INFO');
        }
      });
      sendLog('[SNIFFER] ========== END DUMP ==========', 'INFO');
    });
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  function inject(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  inject(`
    .tsf * { box-sizing: border-box; margin: 0; padding: 0; }
    .tsf {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      font-family: 'Segoe UI', sans-serif; font-size: 12px; color: #e0e0e0;
    }
    .tsf-badge {
      width: 48px; height: 48px; border-radius: 14px; border: none; cursor: pointer;
      background: linear-gradient(135deg, #6c5ce7, #a29bfe);
      box-shadow: 0 4px 16px rgba(108,92,231,0.4);
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
      transition: all 0.2s; padding: 0;
    }
    .tsf-badge:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(108,92,231,0.5); }
    .tsf-badge .ic { font-size: 18px; }
    .tsf-badge .lb { font-size: 6px; font-weight: 700; color: rgba(255,255,255,0.8); letter-spacing: 0.3px; }
    .tsf-badge .ct { font-size: 9px; font-weight: 700; color: #fff; }

    /* Panel */
    .tsf-pn {
      position: absolute; bottom: 60px; right: 0; width: 280px;
      background: #12121f; border: 1px solid #2a2a4a; border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); overflow: hidden;
      animation: tsf-in 0.2s ease; display: none;
    }
    .tsf-pn.o { display: block; }
    @keyframes tsf-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
    .tsf-hd {
      background: linear-gradient(135deg, #6c5ce7, #5541d9);
      padding: 10px 14px; display: flex; align-items: center; gap: 8px; border-radius: 14px 14px 0 0;
    }
    .tsf-hd .ic { font-size: 18px; }
    .tsf-hd .ti { flex: 1; }
    .tsf-hd .ti .tt { font-size: 13px; font-weight: 700; color: #fff; }
    .tsf-hd .ti .tv { font-size: 9px; color: rgba(255,255,255,0.5); }
    .tsf-bd { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    .tsf-info {
      background: #1a1a2e; border-radius: 8px; padding: 8px 12px; font-size: 11px; color: #888;
    }
    .tsf-info .ti { margin-bottom: 4px; color: #ccc; }
    .tsf-info .ti:last-child { margin-bottom: 0; }
    .tsf-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
    .tsf-btn {
      padding: 7px 4px; border: none; border-radius: 8px; font-size: 11px; font-weight: 600;
      cursor: pointer; text-align: center; transition: 0.2s;
    }
    .tsf-btn.pur { background: #6c5ce7; color: #fff; }
    .tsf-btn.pur:hover { background: #7c6cf7; }
    .tsf-btn.red { background: #ff4757; color: #fff; }
    .tsf-btn.red:hover { background: #ff6b7a; }
    .tsf-btn.gry { background: #2a2a4a; color: #ccc; }
    .tsf-btn.gry:hover { background: #3a3a5a; }
    .tsf-stat {
      background: #1a1a2e; border-radius: 8px; padding: 8px 12px;
      text-align: center; font-size: 11px; color: #888;
    }
    .tsf-stat .sn { font-size: 20px; font-weight: 700; color: #a29bfe; }
  `);

  const ui = document.createElement('div');
  ui.className = 'tsf';
  ui.innerHTML = `
    <div class="tsf-pn" id="tsfPn">
      <div class="tsf-hd">
        <div class="ic">🔍</div>
        <div class="ti"><div class="tt">API Sniffer</div><div class="tv">v${VER}</div></div>
      </div>
      <div class="tsf-bd">
        <div class="tsf-info">
          Buka halaman Messages, Profile, Followers di Tevi. Sniffer otomatis tangkap semua API call. Setelah selesai, klik <strong>📋 Dump</strong> untuk kirim ke log server.
        </div>
        <div class="tsf-stat">
          <div class="sn" id="tsfCount">0</div>
          API calls captured
        </div>
        <div class="tsf-btns">
          <button class="tsf-btn pur" id="tsfDump">📋 Dump</button>
          <button class="tsf-btn red" id="tsfClear">🗑 Clear</button>
        </div>
      </div>
    </div>
    <button class="tsf-badge" id="tsfFab" title="API Sniffer v${VER}">
      <div class="ic">🔍</div>
      <div class="lb">SNIFF</div>
      <div class="ct" id="tsfCount2">0</div>
    </button>
  `;
  document.body.appendChild(ui);

  function updateBadge(count) {
    const e1 = document.getElementById('tsfCount');
    const e2 = document.getElementById('tsfCount2');
    if (e1) e1.textContent = count;
    if (e2) e2.textContent = count;
    if (count > 0) {
      document.getElementById('tsfFab').style.background = 'linear-gradient(135deg, #00ff88, #00cc6a)';
    }
  }

  // Load initial count
  chrome.storage.local.get(STORAGE_KEY, d => updateBadge((d[STORAGE_KEY] || []).length));

  // Events
  document.getElementById('tsfFab').addEventListener('click', () => {
    const pn = document.getElementById('tsfPn');
    pn.classList.toggle('o');
    if (!pn.classList.contains('o')) {
      chrome.storage.local.get(STORAGE_KEY, d => updateBadge((d[STORAGE_KEY] || []).length));
    }
  });
  document.getElementById('tsfDump').addEventListener('click', () => {
    dumpToLog();
    document.getElementById('tsfDump').textContent = '⏳ Dumping...';
    setTimeout(() => { document.getElementById('tsfDump').textContent = '📋 Dump'; }, 3000);
  });
  document.getElementById('tsfClear').addEventListener('click', () => {
    clearEntries();
    document.getElementById('tsfClear').textContent = '✅ Cleared';
    setTimeout(() => { document.getElementById('tsfClear').textContent = '🗑 Clear'; }, 2000);
  });

  // Auto-refresh count
  setInterval(() => {
    chrome.storage.local.get(STORAGE_KEY, d => {
      const n = (d[STORAGE_KEY] || []).length;
      const e = document.getElementById('tsfCount');
      if (e) e.textContent = n;
      if (n > parseInt(document.getElementById('tsfCount2').textContent)) {
        document.getElementById('tsfFab').style.background = 'linear-gradient(135deg, #00ff88, #00cc6a)';
        document.getElementById('tsfCount2').textContent = n;
      }
    });
  }, 3000);

  // ── INTERCEPT FETCH ────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();

    if (!isRelevantUrl(url)) return _fetch.apply(this, arguments);

    const start = Date.now();
    let status = 0, bodyLen = 0, bodyPreview = null;

    // Mask auth header
    let maskedAuth = '';
    try {
      const h = init?.headers;
      if (h instanceof Headers) maskedAuth = h.get('Authorization')?.substring(0, 15) + '...' || '';
      else if (h) {
        const auth = h['Authorization'] || h['authorization'] || '';
        maskedAuth = auth ? auth.substring(0, 15) + '...' : '';
      }
    } catch {}

    try {
      const res = await _fetch.apply(this, arguments);
      status = res.status;
      const clone = res.clone();
      try {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json') || ct.includes('text')) {
          const txt = await clone.text().catch(() => '');
          bodyLen = txt.length;
          bodyPreview = txt.substring(0, 200);
        }
      } catch {}

      const entry = {
        type: 'fetch', method, url, status, bodyLen, bodyPreview,
        auth: maskedAuth, ts: Date.now(), durationMs: Date.now() - start
      };
      saveEntry(entry);

      // Immediate console feedback for conversations
      if (status === 200 && url.includes('conversation')) {
        sendLog(`[SNIFFER] ✅ ${method} ${status} conversation: ${bodyPreview?.substring(0, 80)}`, 'INFO');
      }

      return res;
    } catch (e) {
      saveEntry({ type: 'fetch', method, url, status: 0, bodyLen: 0, bodyPreview: e.message, auth: maskedAuth, ts: Date.now(), durationMs: Date.now() - start });
      return _fetch.apply(this, arguments);
    }
  };

  // ── INTERCEPT XHR ─────────────────────────────────────────────────────
  const _xOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__sniff_url = url;
    this.__sniff_method = method;
    return _xOpen.call(this, method, url, ...rest);
  };

  const _xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__sniff_url && isRelevantUrl(this.__sniff_url)) {
      saveEntry({ type: 'xhr', method: this.__sniff_method, url: this.__sniff_url, status: 0, bodyLen: 0, bodyPreview: null, auth: '', ts: Date.now(), durationMs: 0 });
      sendLog(`[SNIFFER] 🔶 XHR ${this.__sniff_method} ${new URL(this.__sniff_url, location.origin).pathname}`, 'DEBUG');
    }
    return _xSend.call(this, body);
  };

  function isRelevantUrl(url) {
    return url.includes('wapi.flowstreamx.com') ||
           url.includes('api.tevi.') ||
           url.includes('firebase') ||
           url.includes('graph.facebook') ||
           url.includes('googleapis');
  }

  // ── PERFORMANCE OBSERVER ───────────────────────────────────────────────
  if (window.PerformanceObserver) {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name && isRelevantUrl(e.name)) {
            saveEntry({ type: 'perf', method: 'RESOURCE', url: e.name, status: 0, bodyLen: 0, bodyPreview: null, auth: '', ts: Date.now(), durationMs: e.duration });
          }
        }
      });
      obs.observe({ entryTypes: ['resource'] });
    } catch {}
  }

  sendLog(`[SNIFFER] ✅ Active — watching API calls on ${location.href}`, 'INFO');
  sendLog(`[SNIFFER] Capturing: wapi.flowstreamx.com, firebase, googleapis`, 'INFO');
})();
