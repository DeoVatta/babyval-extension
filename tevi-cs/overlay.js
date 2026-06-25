/**
 * FLOATING OVERLAY — Tevi CS Bot (v0.1.0.3)
 * Injected via content-script into tevi.com
 * Appears automatically on page load — right side, non-intrusive
 * Inspired by updog.marketing floating widget style
 */

(function() {
  'use strict';

  // Prevent double injection
  if (window.__TEVI_CS_OVERLAY__) return;
  window.__TEVI_CS_OVERLAY__ = true;

  const VER = '0.1.0.3';
  const LOG_SERVER = 'http://localhost:3131';

  // ── Inject styles ────────────────────────────────────────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .tevi-cs-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      color: #e0e0e0;
    }

    /* Floating trigger button */
    .tevi-cs-trigger {
      width: 52px;
      height: 52px;
      border-radius: 16px;
      background: linear-gradient(135deg, #00cc6a 0%, #009955 100%);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,204,106,0.35), 0 2px 8px rgba(0,0,0,0.3);
      transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-direction: column;
      gap: 2px;
      padding: 0;
    }
    .tevi-cs-trigger:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(0,204,106,0.5), 0 3px 12px rgba(0,0,0,0.35);
    }
    .tevi-cs-trigger:active {
      transform: scale(0.95);
    }
    .tevi-cs-trigger .t-icon {
      font-size: 22px;
      line-height: 1;
    }
    .tevi-cs-trigger .t-label {
      font-size: 7px;
      font-weight: 700;
      color: rgba(255,255,255,0.8);
      letter-spacing: 0.3px;
    }
    .tevi-cs-trigger.off {
      background: linear-gradient(135deg, #333 0%, #222 100%);
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    }
    .tevi-cs-trigger.off:hover {
      box-shadow: 0 6px 20px rgba(0,0,0,0.4);
    }

    /* Status dot on trigger */
    .tevi-cs-trigger .t-dot {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 2px solid #0a0a0f;
    }
    .tevi-cs-trigger .t-dot.green { background: #00ff88; box-shadow: 0 0 6px #00ff88; }
    .tevi-cs-trigger .t-dot.red { background: #ff4757; box-shadow: 0 0 6px #ff4757; }
    .tevi-cs-trigger .t-dot.gray { background: #555; }
    .tevi-cs-trigger .t-dot.orange { background: #ffa502; box-shadow: 0 0 6px #ffa502; }

    /* Floating panel */
    .tevi-cs-panel {
      position: absolute;
      bottom: 64px;
      right: 0;
      width: 280px;
      background: #0f0f1a;
      border: 1px solid #1e1e30;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
      overflow: hidden;
      transform-origin: bottom right;
      animation: tpanel-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: none;
    }
    .tevi-cs-panel.open { display: block; }

    @keyframes tpanel-in {
      from { opacity: 0; transform: scale(0.85) translateY(10px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* Panel header */
    .tph {
      background: linear-gradient(135deg, #00cc6a 0%, #008844 100%);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-radius: 16px 16px 0 0;
    }
    .tph-icon { font-size: 20px; }
    .tph-info { flex: 1; }
    .tph-title { font-size: 13px; font-weight: 700; color: #fff; }
    .tph-ver { font-size: 9px; color: rgba(255,255,255,0.5); }
    .tph-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
      background: rgba(255,255,255,0.2);
      color: #fff;
    }

    /* Panel body */
    .tpb {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Status row */
    .tsr {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #1a1a2e;
      border-radius: 10px;
      padding: 8px 12px;
    }
    .tsrdot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .tsrdot.g { background: #00ff88; box-shadow: 0 0 8px #00ff88; }
    .tsrdot.r { background: #ff4757; box-shadow: 0 0 8px #ff4757; }
    .tsrdot.n { background: #555; }
    .tsrlabel { font-weight: 600; font-size: 13px; color: #fff; }
    .tsrsub { font-size: 10px; color: #888; margin-top: 1px; }

    /* Toggle row */
    .ttr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1a1a2e;
      border-radius: 10px;
      padding: 8px 12px;
    }
    .ttl { font-size: 12px; color: #ccc; }
    .t-toggle { position: relative; width: 38px; height: 22px; }
    .t-toggle input { opacity: 0; width: 0; height: 0; }
    .t-slider {
      position: absolute; cursor: pointer; inset: 0;
      background: #333; border-radius: 22px; transition: 0.3s;
    }
    .t-slider::before {
      content: ''; position: absolute; width: 16px; height: 16px;
      left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.3s;
    }
    .t-toggle input:checked + .t-slider { background: #00cc6a; }
    .t-toggle input:checked + .t-slider::before { transform: translateX(16px); }

    /* Mini stats */
    .tstats {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
    }
    .tstat {
      background: #1a1a2e;
      border-radius: 8px;
      padding: 6px 4px;
      text-align: center;
    }
    .tstatn { font-size: 16px; font-weight: 700; color: #fff; }
    .tstatl { font-size: 8px; color: #555; margin-top: 1px; text-transform: uppercase; }

    /* Info rows */
    .tinfo {
      background: #1a1a2e;
      border-radius: 10px;
      padding: 8px 12px;
    }
    .tir { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px; }
    .tir:last-child { margin-bottom: 0; }
    .tir span:first-child { color: #555; }
    .tir span:last-child { color: #aaa; font-family: monospace; }

    /* Action buttons */
    .tbtns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .tbtn {
      padding: 7px 4px;
      border: none;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: 0.2s;
    }
    .tbtn-g { background: #00cc6a; color: #000; }
    .tbtn-g:hover { background: #00e676; }
    .tbtn-b { background: #2a2a4a; color: #ccc; }
    .tbtn-b:hover { background: #3a3a5a; }
    .tbtn-r { background: #ff4757; color: #fff; }
    .tbtn-r:hover { background: #ff6b7a; }

    /* Log mini */
    .tlog {
      background: #080810;
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 9px;
      font-family: 'Consolas', monospace;
      color: #555;
      max-height: 80px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      display: none;
    }
    .tlog.show { display: block; }
  `;

  function injectStyle(css) {
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    return el;
  }

  function sendLog(msg, level = 'INFO') {
    try {
      fetch(`${LOG_SERVER}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'OVERLAY', level, message: msg }),
      }).catch(() => {});
    } catch {}
  }

  // ── Token helpers ────────────────────────────────────────────────────────
  function getTeviToken() {
    try {
      const raw = localStorage.getItem('user_logged_list');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const userData = Object.values(parsed)[0];
      return userData?.access_token || null;
    } catch { return null; }
  }

  function decodePayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      let str = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      return JSON.parse(atob(str));
    } catch { return null; }
  }

  // ── Build overlay ────────────────────────────────────────────────────────
  function buildOverlay() {
    injectStyle(CSS);

    const container = document.createElement('div');
    container.className = 'tevi-cs-fab';
    container.innerHTML = `
      <!-- Floating panel -->
      <div class="tevi-cs-panel" id="tPanel">
        <div class="tph">
          <div class="tph-icon">🤖</div>
          <div class="tph-info">
            <div class="tph-title">Tevi CS Bot</div>
            <div class="tph-ver">v${VER}</div>
          </div>
          <div class="tph-badge" id="tBadge">—</div>
        </div>
        <div class="tpb">
          <!-- Status -->
          <div class="tsr">
            <div class="tsrdot n" id="tDot"></div>
            <div>
              <div class="tsrlabel" id="tLabel">Loading...</div>
              <div class="tsrsub" id="tSub">—</div>
            </div>
          </div>

          <!-- Toggle -->
          <div class="ttr">
            <span class="ttl">Aktifkan Bot</span>
            <label class="t-toggle">
              <input type="checkbox" id="tToggle">
              <span class="t-slider"></span>
            </label>
          </div>

          <!-- Stats -->
          <div class="tstats">
            <div class="tstat"><div class="tstatn" id="tP">—</div><div class="tstatl">Proc</div></div>
            <div class="tstat"><div class="tstatn" id="tR">—</div><div class="tstatl">Replied</div></div>
            <div class="tstat"><div class="tstatn" id="tI">—</div><div class="tstatl">Ign</div></div>
          </div>

          <!-- Info -->
          <div class="tinfo">
            <div class="tir"><span>Last Poll</span><span id="tLP">—</span></div>
            <div class="tir"><span>Token UID</span><span id="tUID">—</span></div>
            <div class="tir"><span>Hours</span><span id="tHrs">—</span></div>
          </div>

          <!-- Buttons -->
          <div class="tbtns">
            <button class="tbtn tbtn-g" id="tPoll">🔄 Poll</button>
            <button class="tbtn tbtn-b" id="tLogs">📋 Logs</button>
          </div>

          <!-- Mini log -->
          <div class="tlog" id="tLog"></div>
        </div>
      </div>

      <!-- FAB trigger -->
      <button class="tevi-cs-trigger off" id="tFab" title="Tevi CS Bot v${VER}">
        <div class="t-dot gray" id="tFabDot"></div>
        <div class="t-icon">🤖</div>
        <div class="t-label">TEVI</div>
      </button>
    `;

    document.body.appendChild(container);

    // ── Element refs ──────────────────────────────────────────────────────
    const panel     = document.getElementById('tPanel');
    const fab       = document.getElementById('tFab');
    const fabDot    = document.getElementById('tFabDot');
    const badge     = document.getElementById('tBadge');
    const dot       = document.getElementById('tDot');
    const label     = document.getElementById('tLabel');
    const sub       = document.getElementById('tSub');
    const toggle    = document.getElementById('tToggle');
    const tP        = document.getElementById('tP');
    const tR        = document.getElementById('tR');
    const tI        = document.getElementById('tI');
    const tLP       = document.getElementById('tLP');
    const tUID      = document.getElementById('tUID');
    const tHrs      = document.getElementById('tHrs');
    const btnPoll   = document.getElementById('tPoll');
    const btnLogs   = document.getElementById('tLogs');
    const miniLog   = document.getElementById('tLog');

    // ── Helpers ────────────────────────────────────────────────────────────
    function fmtTime(iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString('id-ID', {
          day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'
        });
      } catch { return '—'; }
    }

    function setStatus(mode, text, subText, dotClass) {
      dot.className = `tsrdot ${dotClass}`;
      label.textContent = text;
      sub.textContent = subText;
    }

    function setFab(enabled, hasToken) {
      if (!enabled) {
        fab.className = 'tevi-cs-trigger off';
        fabDot.className = 't-dot gray';
        badge.textContent = 'OFF';
        badge.style.background = 'rgba(255,255,255,0.2)';
      } else if (!hasToken) {
        fab.className = 'tevi-cs-trigger off';
        fabDot.className = 't-dot red';
        badge.textContent = 'ERR';
        badge.style.background = 'rgba(255,71,87,0.4)';
      } else {
        fab.className = 'tevi-cs-trigger';
        fabDot.className = 't-dot green';
        badge.textContent = 'ON';
        badge.style.background = 'rgba(0,0,0,0.2)';
      }
    }

    async function refreshUI() {
      let enabled = false, lastResult = null, tokenUID = null;

      // Read storage
      try {
        const stored = await new Promise(resolve => {
          chrome.storage.local.get('tevi_cs_state', resolve);
        });
        const s = stored?.tevi_cs_state || {};
        enabled = !!s.botEnabled;
        lastResult = s.lastPollResult || null;
      } catch {}

      // Read popup localStorage for extra data
      let popupData = null;
      try {
        const raw = localStorage.getItem('tevi_cs_popup');
        if (raw) popupData = JSON.parse(raw);
      } catch {}

      // Get token from tab (sync read)
      const token = getTeviToken();
      const payload = token ? decodePayload(token) : null;
      tokenUID = payload?.uid || null;
      const hasToken = !!token;

      // Update toggle
      toggle.checked = enabled;

      // Update stats
      if (lastResult) {
        tP.textContent = lastResult.processed ?? '—';
        tR.textContent = lastResult.replied ?? '—';
        tI.textContent = lastResult.ignored ?? '—';
        tLP.textContent = fmtTime(lastResult.time);
      }
      tUID.textContent = tokenUID || '—';

      // Active hours
      const hour = new Date().getHours();
      const active = hour >= 17 || hour < 5;
      tHrs.innerHTML = active
        ? '<span style="color:#00cc6a;font-weight:600">BUKA</span>'
        : '<span style="color:#ff4757;font-weight:600">TUTUP</span>';

      // Status text
      if (!enabled) {
        setStatus('off', 'Nonaktif', 'Toggle untuk aktifkan', 'n');
        setFab(false, hasToken);
      } else if (!hasToken) {
        setStatus('err', 'No Token', 'Login ke Tevi dulu', 'r');
        setFab(true, false);
      } else {
        setStatus('ok', 'Aktif', active ? '🟢 Memantau' : '🟡 Closed (dry)', 'g');
        setFab(true, true);
      }
    }

    // ── Event: FAB click → toggle panel ─────────────────────────────────
    fab.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) refreshUI();
    });

    // ── Event: Toggle bot ────────────────────────────────────────────────
    toggle.addEventListener('change', async () => {
      const enabled = toggle.checked;
      if (enabled) {
        setStatus('ok', 'Aktif', '⏳ Menyimpan...', 'g');
        setFab(true, true);
      } else {
        setStatus('off', 'Nonaktif', '⏳ Menyimpan...', 'n');
        setFab(false, false);
      }

      // Save to chrome.storage
      try {
        const stored = await new Promise(resolve => {
          chrome.storage.local.get('tevi_cs_state', resolve);
        });
        const s = stored?.tevi_cs_state || {};
        await new Promise(resolve => {
          chrome.storage.local.set({ tevi_cs_state: { ...s, botEnabled: enabled } }, resolve);
        });
      } catch { sendLog('Storage save failed', 'ERROR'); }

      // Tell background
      try {
        chrome.runtime.sendMessage({ type: 'TOGGLE_BOT', enabled });
        sub.textContent = enabled ? 'Sedang memantau' : 'Nonaktif';
      } catch { sub.textContent = enabled ? 'Alarm pending' : 'Nonaktif'; }

      setFab(enabled, !!getTeviToken());
    });

    // ── Event: Poll ──────────────────────────────────────────────────────
    btnPoll.addEventListener('click', async () => {
      btnPoll.textContent = '⏳...';
      btnPoll.disabled = true;
      sendLog('[OVERLAY] Manual poll triggered');
      try {
        const r = await chrome.runtime.sendMessage({ type: 'MANUAL_POLL' });
        tP.textContent = r.processed ?? '0';
        tR.textContent = r.replied ?? '0';
        tI.textContent = r.ignored ?? '0';
        tLP.textContent = fmtTime(new Date().toISOString());
        btnPoll.textContent = r.error === 'no_token' ? '❌ No Token' : `✅ ${r.replied} replied`;
        if (r.error === 'no_token') {
          setStatus('err', 'No Token', 'Buka tab Tevi & login', 'r');
          setFab(true, false);
        }
      } catch {
        btnPoll.textContent = '❌ Error';
        sendLog('[OVERLAY] Poll failed', 'ERROR');
      }
      setTimeout(() => { btnPoll.textContent='🔄 Poll'; btnPoll.disabled=false; }, 3000);
    });

    // ── Event: Logs ─────────────────────────────────────────────────────
    btnLogs.addEventListener('click', async () => {
      if (miniLog.classList.contains('show')) {
        miniLog.classList.remove('show');
        btnLogs.textContent = '📋 Logs';
        return;
      }
      btnLogs.textContent = '⏳...';
      try {
        const r = await fetch(`${LOG_SERVER}/logs?count=20`).then(x => x.json());
        if (r?.logs) {
          const lines = r.logs.split('\n').filter(Boolean).slice(-15).join('\n');
          miniLog.textContent = lines;
          miniLog.classList.add('show');
          btnLogs.textContent = '📋 Logs ▲';
        }
      } catch {
        miniLog.textContent = 'Cannot connect to log server';
        miniLog.classList.add('show');
      }
      setTimeout(() => { btnLogs.textContent='📋 Logs'; }, 500);
    });

    // ── Auto-refresh every 10s when panel open ───────────────────────────
    setInterval(() => {
      if (panel.classList.contains('open')) refreshUI();
    }, 10000);

    // ── Initial load ─────────────────────────────────────────────────────
    refreshUI();
    sendLog(`[OVERLAY] Loaded v${VER} on ${window.location.href}`);

    // ── Listen for TOKEN_UPDATE from content-script ───────────────────────
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOKEN_UPDATE' && msg.token) {
        sendLog(`[OVERLAY] Token updated — UID=${msg.uid}`);
        refreshUI();
      }
    });
  }

  // ── Inject when DOM ready ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildOverlay);
  } else {
    buildOverlay();
  }
})();
