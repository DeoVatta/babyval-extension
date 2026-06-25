/**
 * UNIFIED OVERLAY + SNIFFER — Tevi CS Bot v0.3.0.0
 * Single FAB: green TEVI = bot, purple ring = sniffer active
 * Fully automated — no buttons needed
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const VER = '0.3.0.0';
  const LOG = 'http://localhost:3131';
  const SN_KEY = 'tevi_sniff';
  const EP_KEY = 'tevi_endpoints';

  // ═══════════════════════════════════════════════════════════════════
  // PART 1: SNIFFER (runs silent, no UI)
  // ═══════════════════════════════════════════════════════════════════

  function isTeviApi(url) {
    return url.includes('wapi.flowstreamx.com') ||
           url.includes('api.tevi') ||
           url.includes('firebase') ||
           url.includes('googleapis');
  }

  function snLog(msg, level = 'INFO') {
    try {
      fetch(`${LOG}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'SNIFFER', level, message: msg }),
      }).catch(() => {});
    } catch {}
  }

  function saveSniffEntry(entry) {
    chrome.storage.local.get(SN_KEY, d => {
      const list = d[SN_KEY] || [];
      list.push(entry);
      if (list.length > 3000) list.splice(0, list.length - 3000);
      chrome.storage.local.set({ [SN_KEY]: list });
    });
  }

  function saveEndpoint(method, url, status, isSend) {
    try {
      const u = new URL(url, location.href);
      const pathname = u.pathname;
      chrome.storage.local.get(EP_KEY, d => {
        const eps = d[EP_KEY] || {};
        const key = `${method}:${pathname}`;
        if (!eps[key] || (status && !eps[key].status)) {
          eps[key] = {
            method, pathname, status, isSend,
            capturedAt: new Date().toISOString(),
            count: (eps[key]?.count || 0) + 1,
          };
          chrome.storage.local.set({ [EP_KEY]: eps });
        }
      });
    } catch {}
  }

  // Intercept fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();
    if (isTeviApi(url)) {
      const start = Date.now();
      let status = 0, bodyJson = null;
      try {
        const res = await _fetch(input, init);
        status = res.status;
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            const clone = res.clone();
            bodyJson = await clone.json().catch(() => null);
          }
        } catch {}
        const entry = { type: 'fetch', method, url, status, ts: Date.now(), ms: Date.now() - start };
        saveSniffEntry(entry);
        saveEndpoint(method, url, status, method !== 'GET');
        if (status === 200 && bodyJson?.data?.results) {
          snLog(`🎯 CONVS ${bodyJson.data.results.length} unread: ${url.substring(url.indexOf('/messenger'))}`);
        }
        if (method !== 'GET' && status >= 200 && status < 300) {
          snLog(`✅ SEND OK: ${method} ${new URL(url, location.href).pathname}`);
        }
        return res;
      } catch {
        saveSniffEntry({ type: 'fetch', method, url, status: 0, ts: Date.now() });
        return _fetch(input, init);
      }
    }
    return _fetch(input, init);
  };

  // Intercept XHR
  const _xOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; this.__m = m; return _xOpen.call(this, m, u, ...r); };
  const _xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    if (this.__u && isTeviApi(this.__u)) {
      saveSniffEntry({ type: 'xhr', method: this.__m, url: this.__u, ts: Date.now() });
      saveEndpoint(this.__m, this.__u, 0, true);
    }
    return _xSend.call(this);
  };

  // Intercept WebSocket
  if (typeof WebSocket !== 'undefined') {
    const _WS = WebSocket;
    window.WebSocket = function(url, ...rest) {
      if (isTeviApi(url)) {
        saveSniffEntry({ type: 'ws', url, ts: Date.now() });
        snLog(`🔌 WS: ${url}`);
      }
      const ws = new _WS(url, ...rest);
      const _send = ws.send.bind(ws);
      ws.send = function(data) {
        if (isTeviApi(url)) {
          saveSniffEntry({ type: 'ws_send', url, data: String(data).substring(0, 150), ts: Date.now() });
          saveEndpoint('WS_SEND', url, 0, true);
          snLog(`📤 WS SEND: ${String(data).substring(0, 80)}`);
        }
        return _send(data);
      };
      return ws;
    };
    Object.keys(_WS).forEach(k => { if (k !== 'prototype') window.WebSocket[k] = _WS[k]; });
  }

  // PerformanceObserver
  if (window.PerformanceObserver) {
    try {
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (e.name && isTeviApi(e.name)) {
            saveSniffEntry({ type: 'perf', url: e.name, ms: e.duration, ts: Date.now() });
          }
        }
      }).observe({ entryTypes: ['resource'] });
    } catch {}
  }

  snLog(`[SNIFFER] ✅ Active — ${location.href}`);

  // ═══════════════════════════════════════════════════════════════════
  // PART 2: OVERLAY UI (single unified FAB)
  // ═══════════════════════════════════════════════════════════════════

  function inject(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  inject(`
    .tc * { box-sizing: border-box; margin: 0; padding: 0; }
    .tc { position: fixed; bottom: 24px; right: 24px; z-index: 2147483647; font-family: 'Segoe UI', sans-serif; }

    /* Single unified FAB */
    .tc-fab {
      width: 56px; height: 56px; border-radius: 16px; border: none; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1); padding: 0;
      position: relative;
    }
    .tc-fab.on  { background: linear-gradient(135deg,#00cc6a,#009955); box-shadow: 0 4px 20px rgba(0,204,106,.35),0 2px 8px rgba(0,0,0,.3); }
    .tc-fab.off { background: linear-gradient(135deg,#2a2a3a,#1a1a28); box-shadow: 0 4px 16px rgba(0,0,0,.3); border: 1px solid #333; }
    .tc-fab:hover { transform: scale(1.08); }
    .tc-fab:active { transform: scale(.95); }
    .tc-fab .ic { font-size: 22px; line-height: 1; }
    .tc-fab .lb { font-size: 7px; font-weight: 700; color: rgba(255,255,255,.8); letter-spacing: .3px; }

    /* Status dot */
    .tc-fab .dot {
      position: absolute; top: 8px; right: 8px;
      width: 9px; height: 9px; border-radius: 50%; border: 2px solid #0f0f1a;
    }
    .dot.G { background: #00ff88; box-shadow: 0 0 6px #00ff88; }
    .dot.R { background: #ff4757; box-shadow: 0 0 6px #ff4757; }
    .dot.O { background: #ffa502; box-shadow: 0 0 6px #ffa502; }
    .dot.N { background: #555; }

    /* Sniffer ring — purple glow when sniffer has captures */
    .tc-fab.sniffing::after {
      content: ''; position: absolute; inset: -4px; border-radius: 20px;
      border: 2px solid #a29bfe; box-shadow: 0 0 8px rgba(108,92,231,.5);
      pointer-events: none; animation: sn-ring 2s ease-in-out infinite alternate;
    }
    @keyframes sn-ring { from { opacity: .4; } to { opacity: 1; } }

    /* Panel */
    .tc-pn {
      position: absolute; bottom: 68px; right: 0; width: 264px;
      background: #0f0f1a; border: 1px solid #1e1e30; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,.5); overflow: hidden;
      transform-origin: bottom right;
      animation: tcp-in .22s cubic-bezier(.34,1.56,.64,1); display: none;
    }
    .tc-pn.o { display: block; }
    @keyframes tcp-in { from { opacity:0; transform:scale(.88) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }

    .tc-hd { background: linear-gradient(135deg,#00cc6a,#008844); padding: 10px 14px; display: flex; align-items: center; gap: 8px; border-radius: 16px 16px 0 0; }
    .tc-hd .ic { font-size: 20px; }
    .tc-hd .ti { flex: 1; }
    .tc-hd .ti .tt { font-size: 13px; font-weight: 700; color: #fff; }
    .tc-hd .ti .tv { font-size: 9px; color: rgba(255,255,255,.5); }
    .tc-hd .bd { font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 20px; background: rgba(255,255,255,.2); color: #fff; }

    .tc-bd { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }

    .tc-sr { display: flex; align-items: center; gap: 10px; background: #1a1a2e; border-radius: 10px; padding: 8px 12px; }
    .tc-sr .do { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .tc-sr .do.G { background: #00ff88; box-shadow: 0 0 8px #00ff88; }
    .tc-sr .do.R { background: #ff4757; box-shadow: 0 0 8px #ff4757; }
    .tc-sr .do.N { background: #555; }
    .tc-sr .do.O { background: #ffa502; box-shadow: 0 0 8px #ffa502; }
    .tc-sr .lb { font-weight: 600; font-size: 13px; color: #fff; }
    .tc-sr .sb { font-size: 10px; color: #888; margin-top: 1px; }

    .tc-er { background: #2a1a1a; border: 1px solid #ff475744; border-radius: 8px; padding: 6px 10px; font-size: 10px; color: #ff6b6b; display: none; }
    .tc-er.sh { display: block; }

    .tc-tr { display: flex; align-items: center; justify-content: space-between; background: #1a1a2e; border-radius: 10px; padding: 8px 12px; }
    .tc-tr .tl { font-size: 12px; color: #ccc; }
    .tc-tg { position: relative; width: 38px; height: 22px; }
    .tc-tg input { opacity: 0; width: 0; height: 0; }
    .tc-sl { position: absolute; cursor: pointer; inset: 0; background: #333; border-radius: 22px; transition: .3s; }
    .tc-sl::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .3s; }
    .tc-tg input:checked + .tc-sl { background: #00cc6a; }
    .tc-tg input:checked + .tc-sl::before { transform: translateX(16px); }

    .tc-st { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }
    .tc-st .sk { background: #1a1a2e; border-radius: 8px; padding: 6px 4px; text-align: center; }
    .tc-st .sn { font-size: 18px; font-weight: 700; color: #fff; }
    .tc-st .sl { font-size: 8px; color: #555; margin-top: 1px; text-transform: uppercase; }

    .tc-if { background: #1a1a2e; border-radius: 10px; padding: 7px 12px; }
    .tc-if .ir { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; }
    .tc-if .ir:last-child { margin-bottom: 0; }
    .tc-if .ir span:first-child { color: #555; }
    .tc-if .ir span:last-child { color: #aaa; font-family: monospace; }
  `);

  const ui = document.createElement('div');
  ui.className = 'tc';
  ui.innerHTML = `
    <div class="tc-pn" id="tcPn">
      <div class="tc-hd">
        <div class="ic">🤖</div>
        <div class="ti"><div class="tt">Tevi CS Bot</div><div class="tv">v${VER}</div></div>
        <div class="bd" id="tcBd">OFF</div>
      </div>
      <div class="tc-bd">
        <div class="tc-sr">
          <div class="do N" id="tcDot"></div>
          <div><div class="lb" id="tcLb">Memuat...</div><div class="sb" id="tcSb">—</div></div>
        </div>
        <div class="tc-er" id="tcEr"></div>
        <div class="tc-tr">
          <span class="tl">Aktifkan Bot</span>
          <label class="tc-tg">
            <input type="checkbox" id="tcTg">
            <span class="tc-sl"></span>
          </label>
        </div>
        <div class="tc-st">
          <div class="sk"><div class="sn" id="tcP">—</div><div class="sl">Proc</div></div>
          <div class="sk"><div class="sn" id="tcR">—</div><div class="sl">Replied</div></div>
          <div class="sk"><div class="sn" id="tcI">—</div><div class="sl">Ignored</div></div>
        </div>
        <div class="tc-if">
          <div class="ir"><span>Last Poll</span><span id="tcLP">—</span></div>
          <div class="ir"><span>Token UID</span><span id="tcUID">—</span></div>
          <div class="ir"><span>Hours</span><span id="tcHr">—</span></div>
          <div class="ir"><span>Sniffer</span><span id="tcSn" style="color:#a29bfe">—</span></div>
        </div>
      </div>
    </div>
    <button class="tc-fab off" id="tcFab" title="Tevi CS Bot v${VER}">
      <div class="dot N" id="tcFabDot"></div>
      <div class="ic">🤖</div>
      <div class="lb">TEVI</div>
    </button>
  `;
  document.body.appendChild(ui);

  const fab    = document.getElementById('tcFab');
  const fabDot = document.getElementById('tcFabDot');
  const pn     = document.getElementById('tcPn');
  const bd     = document.getElementById('tcBd');
  const dot    = document.getElementById('tcDot');
  const lb     = document.getElementById('tcLb');
  const sb     = document.getElementById('tcSb');
  const er     = document.getElementById('tcEr');
  const tg     = document.getElementById('tcTg');
  const tP     = document.getElementById('tcP');
  const tR     = document.getElementById('tcR');
  const tI     = document.getElementById('tcI');
  const tLP    = document.getElementById('tcLP');
  const tUID   = document.getElementById('tcUID');
  const tHr    = document.getElementById('tcHr');
  const tSn    = document.getElementById('tcSn');

  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
    catch { return '—'; }
  }

  let sniffCount = 0;
  function updateSniffUI() {
    chrome.storage.local.get([SN_KEY, EP_KEY], d => {
      const n = (d[SN_KEY] || []).length;
      const eps = Object.keys(d[EP_KEY] || {}).length;
      sniffCount = n;
      tSn.textContent = n > 0 ? `${n} calls` : '—';
      if (n > 10) {
        fab.classList.add('sniffing');
      } else {
        fab.classList.remove('sniffing');
      }
    });
  }

  function render(state) {
    const { enabled, hasToken, result } = state;
    const ah = new Date().getHours() >= 17 || new Date().getHours() < 5;

    if (!enabled) {
      fab.className = 'tc-fab off'; fabDot.className = 'dot N';
      bd.textContent = 'OFF'; dot.className = 'do N';
      lb.textContent = 'Nonaktif'; sb.textContent = 'Toggle untuk aktifkan';
      er.classList.remove('sh');
    } else if (!hasToken) {
      fab.className = 'tc-fab off'; fabDot.className = 'dot R';
      bd.textContent = 'ERR'; dot.className = 'do R';
      lb.textContent = 'No Token'; sb.textContent = 'Buka Tevi & login';
      er.classList.add('sh'); er.textContent = '⚠️ Login ke tevi.com, refresh';
    } else if (result?.error) {
      fab.className = 'tc-fab on'; fabDot.className = 'dot O';
      bd.textContent = 'ERR'; dot.className = 'do O';
      lb.textContent = 'Error'; sb.textContent = result.error;
      er.classList.add('sh'); er.textContent = '⚠️ ' + result.error;
    } else {
      fab.className = 'tc-fab on'; fabDot.className = 'dot G';
      bd.textContent = 'ON'; dot.className = 'do G';
      lb.textContent = 'Aktif'; sb.textContent = ah ? '🟢 Memantau' : '🟡 Closed (dry)';
      er.classList.remove('sh');
    }

    tP.textContent = result?.processed ?? '—';
    tR.textContent = result?.replied ?? '—';
    tI.textContent = result?.ignored ?? '—';
    tLP.textContent = fmt(result?.time);
    tHr.innerHTML = ah ? '<span style="color:#00cc6a;font-weight:600">BUKA</span>' : '<span style="color:#ff4757;font-weight:600">TUTUP</span>';
    updateSniffUI();
  }

  async function refresh() {
    let state = { enabled: false, hasToken: false, result: {}, uid: null };
    try {
      const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (s) state = { ...state, ...s };
    } catch {}
    tUID.textContent = state.uid || '—';
    tg.checked = state.enabled;
    render(state);
  }

  fab.addEventListener('click', () => {
    pn.classList.toggle('o');
    if (pn.classList.contains('o')) refresh();
  });

  tg.addEventListener('change', async () => {
    const enabled = tg.checked;
    render({ enabled, hasToken: true, result: {} });
    try { await chrome.runtime.sendMessage({ type: 'TOGGLE', enabled }); } catch {}
  });

  setInterval(() => {
    if (pn.classList.contains('o')) refresh();
    updateSniffUI();
  }, 15000);

  refresh();
  updateSniffUI();
})();
