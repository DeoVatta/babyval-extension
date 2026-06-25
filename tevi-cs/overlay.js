/**
 * UNIFIED OVERLAY + SNIFFER — Tevi CS Bot v0.5.1.0
 * Single FAB: shows bot status + sniffer ring
 * Popup has full rules editor — overlay is minimal companion
 */

(function() {
  'use strict';

  if (window.__TEVI_CS__) return;
  window.__TEVI_CS__ = true;

  const VER = '0.5.2.0';
  const LOG = 'http://localhost:3131';
  const SN_KEY = 'tevi_sniff';
  const EP_KEY = 'tevi_endpoints';

  // ═══════════════════════════════════════════════════════════════════
  // PART 1: SNIFFER (silent)
  // ═══════════════════════════════════════════════════════════════════

  function isTeviApi(url) {
    return url.includes('wapi.flowstreamx.com') ||
           url.includes('api.tevi') ||
           url.includes('firebase') ||
           url.includes('googleapis');
  }

  function snLog(msg) {
    try {
      fetch(`${LOG}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'SNIFFER', level: 'INFO', message: msg }),
      }).catch(() => {});
    } catch {}
  }

  function saveEntry(entry) {
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
      chrome.storage.local.get(EP_KEY, d => {
        const eps = d[EP_KEY] || {};
        const key = `${method}:${u.pathname}`;
        eps[key] = { method, pathname: u.pathname, status, isSend, capturedAt: new Date().toISOString(), count: (eps[key]?.count || 0) + 1 };
        chrome.storage.local.set({ [EP_KEY]: eps });
      });
    } catch {}
  }

  // Intercept fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();
    if (!isTeviApi(url)) return _fetch(input, init);

    let status = 0, bodyJson = null;
    try {
      const res = await _fetch(input, init);
      status = res.status;
      try {
        if (res.headers.get('content-type')?.includes('json')) {
          bodyJson = await res.clone().json().catch(() => null);
        }
      } catch {}
      saveEntry({ type: 'fetch', method, url, status, ts: Date.now() });
      saveEndpoint(method, url, status, method !== 'GET');
      return res;
    } catch {
      saveEntry({ type: 'fetch', method, url, status: 0, ts: Date.now() });
      return _fetch(input, init);
    }
  };

  // Intercept XHR
  const _xOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u, ...r) { this.__u = u; this.__m = m; return _xOpen.call(this, m, u, ...r); };
  const _xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    if (this.__u && isTeviApi(this.__u)) {
      saveEntry({ type: 'xhr', method: this.__m, url: this.__u, ts: Date.now() });
      saveEndpoint(this.__m, this.__u, 0, true);
    }
    return _xSend.call(this);
  };

  // Intercept WebSocket
  if (typeof WebSocket !== 'undefined') {
    const _WS = window.WebSocket;
    window.WebSocket = function(url, ...r) {
      if (isTeviApi(url)) saveEntry({ type: 'ws', url, ts: Date.now() });
      const ws = new _WS(url, ...r);
      const _send = ws.send.bind(ws);
      ws.send = function(data) {
        if (isTeviApi(url)) { saveEntry({ type: 'ws_send', url, data: String(data).substring(0, 150), ts: Date.now() }); saveEndpoint('WS', url, 0, true); }
        return _send(data);
      };
      return ws;
    };
    ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(k => { window.WebSocket[k] = _WS[k]; });
  }

  snLog(`[SNIFFER] ✅ ${location.href}`);

  // ═══════════════════════════════════════════════════════════════════
  // PART 2: OVERLAY UI
  // ═══════════════════════════════════════════════════════════════════

  function inject(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  inject(`
    .tc * { box-sizing: border-box; margin: 0; padding: 0; }
    .tc { position: fixed; bottom: 24px; right: 24px; z-index: 2147483647; font-family: 'Segoe UI', sans-serif; }

    /* FAB */
    .tc-fab {
      width: 56px; height: 56px; border-radius: 16px; border: none; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1); padding: 0; position: relative;
    }
    .tc-fab.on  { background: linear-gradient(135deg,#00cc6a,#009955); box-shadow: 0 4px 20px rgba(0,204,106,.35),0 2px 8px rgba(0,0,0,.3); }
    .tc-fab.off { background: linear-gradient(135deg,#2a2a3a,#1a1a28); box-shadow: 0 4px 16px rgba(0,0,0,.3); border: 1px solid #333; }
    .tc-fab:hover { transform: scale(1.08); }
    .tc-fab:active { transform: scale(.95); }
    .tc-fab .ic { font-size: 22px; line-height: 1; }
    .tc-fab .lb { font-size: 7px; font-weight: 700; color: rgba(255,255,255,.8); letter-spacing: .3px; }

    .tc-fab .dot { position: absolute; top: 8px; right: 8px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid #0f0f1a; }
    .dot.G { background: #00ff88; box-shadow: 0 0 6px #00ff88; }
    .dot.R { background: #ff4757; box-shadow: 0 0 6px #ff4757; }
    .dot.O { background: #ffa502; box-shadow: 0 0 6px #ffa502; }
    .dot.N { background: #555; }

    /* Sniffer ring */
    .tc-fab.sniffing::after { content: ''; position: absolute; inset: -4px; border-radius: 20px; border: 2px solid #a29bfe; box-shadow: 0 0 8px rgba(108,92,231,.5); pointer-events: none; animation: snr 2s ease-in-out infinite alternate; }
    @keyframes snr { from { opacity: .4; } to { opacity: 1; } }

    /* Panel */
    .tc-pn { position: absolute; bottom: 68px; right: 0; width: 260px; background: #0f0f1a; border: 1px solid #1e1e30; border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,.5); overflow: hidden; display: none; }
    .tc-pn.o { display: block; animation: tcp-in .22s cubic-bezier(.34,1.56,.64,1); }
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
    .tc-sr .lb { font-weight: 600; font-size: 13px; color: #fff; }
    .tc-sr .sb { font-size: 10px; color: #888; margin-top: 1px; }

    .tc-st { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }
    .tc-st .sk { background: #1a1a2e; border-radius: 8px; padding: 6px 4px; text-align: center; }
    .tc-st .sn { font-size: 18px; font-weight: 700; color: #fff; }
    .tc-st .sl { font-size: 8px; color: #555; margin-top: 1px; text-transform: uppercase; }

    .tc-if { background: #1a1a2e; border-radius: 10px; padding: 7px 12px; }
    .tc-if .ir { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; }
    .tc-if .ir:last-child { margin-bottom: 0; }
    .tc-if .ir span:first-child { color: #555; }
    .tc-if .ir span:last-child { color: #aaa; font-family: monospace; }

    .tc-link { display: block; text-align: center; font-size: 9px; color: #333; margin-top: 6px; text-decoration: none; }
    .tc-link:hover { color: #00cc6a; }
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
        <div class="tc-st">
          <div class="sk"><div class="sn" id="tcCS">—</div><div class="sl">Active</div></div>
          <div class="sk"><div class="sn" id="tcDone">—</div><div class="sl">Done</div></div>
          <div class="sk"><div class="sn" id="tcIntro">—</div><div class="sl">Intro</div></div>
        </div>
        <div class="tc-if">
          <div class="ir"><span>Last Poll</span><span id="tcLP">—</span></div>
          <div class="ir"><span>Hours</span><span id="tcHr">—</span></div>
          <div class="ir"><span>Sniffer</span><span id="tcSn" style="color:#a29bfe">—</span></div>
        </div>
        <a class="tc-link" href="#" id="tcPopup">Open Rules Editor →</a>
      </div>
    </div>
    <button class="tc-fab off" id="tcFab">
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
  const tcCS   = document.getElementById('tcCS');
  const tcDone = document.getElementById('tcDone');
  const tcIntro= document.getElementById('tcIntro');
  const tcLP   = document.getElementById('tcLP');
  const tcHr   = document.getElementById('tcHr');
  const tcSn   = document.getElementById('tcSn');

  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }
    catch { return '—'; }
  }

  function updateSniffUI() {
    chrome.storage.local.get([SN_KEY, EP_KEY], d => {
      const n = (d[SN_KEY] || []).length;
      tcSn.textContent = n > 0 ? `${n} calls` : '—';
      if (n > 10) fab.classList.add('sniffing'); else fab.classList.remove('sniffing');
    });
  }

  function render(state) {
    const { enabled, hasToken, result } = state;
    const ah = new Date().getHours() >= 17 || new Date().getHours() < 5;

    if (!enabled) {
      fab.className = 'tc-fab off'; fabDot.className = 'dot N';
      bd.textContent = 'OFF'; dot.className = 'do N';
      lb.textContent = 'Nonaktif'; sb.textContent = 'Toggle di popup';
    } else if (!hasToken) {
      fab.className = 'tc-fab off'; fabDot.className = 'dot R';
      bd.textContent = 'ERR'; dot.className = 'do R';
      lb.textContent = 'No Token'; sb.textContent = 'Login ke Tevi';
    } else {
      fab.className = 'tc-fab on'; fabDot.className = 'dot G';
      bd.textContent = 'ON'; dot.className = 'do G';
      lb.textContent = 'Aktif'; sb.textContent = ah ? '🟢 Memantau' : '🟡 Closed';
    }

    tcCS.textContent   = result?.stats?.activeConvs ?? '—';
    tcDone.textContent = result?.stats?.doneConvs   ?? '—';
    tcIntro.textContent= result?.stats?.introSent   ?? '—';
    tcLP.textContent   = fmt(result?.time);
    tcHr.innerHTML     = ah ? '<span style="color:#00cc6a;font-weight:600">BUKA</span>' : '<span style="color:#ff4757;font-weight:600">TUTUP</span>';
    updateSniffUI();
  }

  async function refresh() {
    let state = { enabled: false, hasToken: false, result: {} };
    try { const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' }); if (s) state = { ...state, ...s }; } catch {}
    render(state);
  }

  fab.addEventListener('click', () => {
    pn.classList.toggle('o');
    if (pn.classList.contains('o')) refresh();
  });

  document.getElementById('tcPopup').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
  });

  setInterval(() => {
    if (pn.classList.contains('o')) refresh();
    updateSniffUI();
  }, 15000);

  refresh();
  updateSniffUI();
})();
