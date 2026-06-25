/**
 * OVERLAY — Tevi CS Bot v0.8.0
 * Cute cat character with CSS animations
 * States: sleeping (idle) / alert (new msg) / typing (sukii typing)
 * Shares state via chrome.storage.local
 */

(function() {
  'use strict';

  // NOTE: Must NOT share __TEVI_CS__ guard with content-script.js
  // Both scripts run on the same page; use separate flags so both initialize.
  if (window.__TEVI_OVERLAY__) return;
  window.__TEVI_OVERLAY__ = true;

  const VER = '0.9.1';
  const STATE_KEY = 'tevi_cs_overlay_state';
  const LOG = 'http://localhost:3131';

  // ── STYLES ────────────────────────────────────────────────────────────────
  function inject(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  inject(`
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-4px); }
    }
    @keyframes blink {
      0%, 90%, 100% { transform: scaleY(1); }
      95% { transform: scaleY(0.1); }
    }
    @keyframes tail {
      0%, 100% { transform: rotate(-15deg); }
      50% { transform: rotate(15deg); }
    }
    @keyframes breath {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(1.04); }
    }
    @keyframes ear_twitch {
      0%, 80%, 100% { transform: rotate(0deg); }
      85% { transform: rotate(-8deg); }
      90% { transform: rotate(5deg); }
      95% { transform: rotate(-3deg); }
    }
    @keyframes zzz {
      0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
      20% { opacity: 1; }
      80% { opacity: 1; }
      100% { opacity: 0; transform: translate(15px, -20px) scale(0.8); }
    }
    @keyframes notif_pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,100,148,0.6); }
      50% { box-shadow: 0 0 0 10px rgba(255,100,148,0); }
    }
    @keyframes notif_bounce {
      0%, 100% { transform: translateY(0); }
      25% { transform: translateY(-6px); }
      50% { transform: translateY(0); }
      75% { transform: translateY(-3px); }
    }
    @keyframes sparkle {
      0%, 100% { opacity: 0; transform: scale(0); }
      50% { opacity: 1; transform: scale(1); }
    }
    @keyframes typing_dots {
      0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
      30% { opacity: 1; transform: translateY(-4px); }
    }
    @keyframes msg_fade {
      0% { opacity: 0; transform: translateY(4px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes paw_tap {
      0%, 100% { transform: rotate(0deg); }
      50% { transform: rotate(-10deg); }
    }

    .tc-wrap * { box-sizing: border-box; margin: 0; padding: 0; }

    .tc-wrap {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      font-family: 'Quicksand', 'Nunito', 'Segoe UI', sans-serif;
      user-select: none;
    }

    /* ── CAT CONTAINER ─────────────────────────────────────────────── */
    .tc-cat {
      width: 80px; height: 80px; position: relative; cursor: pointer;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
      transition: transform 0.2s;
    }
    .tc-cat:hover { transform: scale(1.08); }
    .tc-cat:active { transform: scale(0.95); }

    /* ── CAT BODY ─────────────────────────────────────────────────── */
    .tc-body {
      width: 52px; height: 38px; background: #FFE0B2; border-radius: 50% 50% 46% 46%;
      position: absolute; bottom: 4px; left: 14px;
      animation: breath 3s ease-in-out infinite;
      box-shadow: inset -4px -4px 8px rgba(0,0,0,0.08);
    }
    .tc-body::before {
      content: ''; position: absolute; top: 2px; left: 6px; right: 6px; height: 8px;
      background: rgba(255,255,255,0.5); border-radius: 50%;
    }

    /* ── CAT HEAD ─────────────────────────────────────────────────── */
    .tc-head {
      width: 46px; height: 40px; background: #FFE0B2; border-radius: 50% 50% 44% 44%;
      position: absolute; top: 2px; left: 17px;
      box-shadow: inset -3px -3px 7px rgba(0,0,0,0.07);
    }
    /* Ears */
    .tc-ear {
      width: 16px; height: 18px; background: #FFE0B2;
      position: absolute; top: -8px; clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
      transform-origin: bottom center;
    }
    .tc-ear.l { left: 3px; transform: rotate(-12deg); }
    .tc-ear.r { right: 3px; transform: rotate(12deg); }
    .tc-ear::after {
      content: ''; position: absolute; top: 6px; left: 4px; width: 8px; height: 10px;
      background: #FFB6C1; clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
    }
    .tc-ear.l { animation: ear_twitch 5s ease-in-out infinite; }
    /* Face patch */
    .tc-head::after {
      content: ''; position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
      width: 26px; height: 20px; background: rgba(255,255,255,0.35);
      border-radius: 50% 50% 44% 44%;
    }

    /* ── EYES ──────────────────────────────────────────────────────── */
    .tc-eyes { position: absolute; top: 14px; left: 0; right: 0; display: flex; justify-content: center; gap: 8px; }
    .tc-eye {
      width: 10px; height: 10px; background: #3D2914; border-radius: 50%;
      position: relative; transition: all 0.2s;
    }
    .tc-eye::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 4px; height: 4px; background: white; border-radius: 50%;
    }

    /* Alert eyes — big + sparkle */
    .tc-alert .tc-eye {
      width: 13px; height: 13px; background: #5DADE2;
      animation: notif_bounce 0.5s ease infinite;
    }
    .tc-alert .tc-eye::after { width: 5px; height: 5px; top: 2px; left: 3px; }
    .tc-alert .tc-eye::before {
      content: '★'; position: absolute; top: -10px; right: -8px;
      font-size: 7px; color: #FFD700; animation: sparkle 0.8s ease infinite;
    }

    /* Sleep eyes — closed lines */
    .tc-sleep .tc-eye {
      height: 2px; background: #3D2914; border-radius: 2px;
      animation: blink 4s ease-in-out infinite;
    }
    .tc-sleep .tc-eye::after { display: none; }
    .tc-sleep .tc-eye:nth-child(2) { animation-delay: 0.2s; }

    /* Typing eyes — looking down curious */
    .tc-typing .tc-eye {
      height: 6px; border-radius: 0 0 6px 6px;
      background: #3D2914;
    }
    .tc-typing .tc-eye::after { display: none; }

    /* ── NOSE ─────────────────────────────────────────────────────── */
    .tc-nose {
      width: 6px; height: 5px; background: #FF8A80; border-radius: 50% 50% 40% 40%;
      position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
    }
    .tc-mouth {
      position: absolute; top: 28px; left: 50%; transform: translateX(-50%);
      width: 10px; height: 6px;
      border-bottom: 1.5px solid #C97A7A;
      border-left: 1.5px solid #C97A7A;
      border-right: 1.5px solid #C97A7A;
      border-top: none; border-radius: 0 0 50% 50%;
    }
    /* Smile when typing */
    .tc-typing .tc-mouth {
      border-bottom: 2px solid #C97A7A;
      border-left: 2px solid #C97A7A;
      border-right: 2px solid #C97A7A;
      height: 8px; width: 12px;
    }

    /* ── WHISKERS ─────────────────────────────────────────────────── */
    .tc-whiskers { position: absolute; top: 26px; left: 0; right: 0; }
    .tc-wh { position: absolute; width: 14px; height: 1px; background: rgba(61,41,20,0.3); }
    .tc-wh.l1 { left: -2px; top: 0; transform: rotate(-10deg); }
    .tc-wh.l2 { left: -4px; top: 5px; transform: rotate(0deg); }
    .tc-wh.l3 { left: -2px; top: 10px; transform: rotate(10deg); }
    .tc-wh.r1 { right: -2px; top: 0; transform: rotate(10deg); }
    .tc-wh.r2 { right: -4px; top: 5px; transform: rotate(0deg); }
    .tc-wh.r3 { right: -2px; top: 10px; transform: rotate(-10deg); }

    /* ── PAWS ─────────────────────────────────────────────────────── */
    .tc-paw {
      width: 14px; height: 12px; background: #FFE0B2; border-radius: 50% 50% 40% 40%;
      position: absolute; bottom: 0;
      box-shadow: inset -2px -2px 4px rgba(0,0,0,0.06);
    }
    .tc-paw.l { left: 16px; }
    .tc-paw.r { right: 16px; }
    .tc-typing .tc-paw.r {
      animation: paw_tap 0.4s ease infinite;
      animation-delay: 0.2s;
    }
    .tc-paw::after {
      content: ''; position: absolute; top: 1px; left: 3px;
      width: 8px; height: 5px; background: rgba(255,255,255,0.4);
      border-radius: 50%;
    }

    /* ── TAIL ─────────────────────────────────────────────────────── */
    .tc-tail {
      width: 8px; height: 24px; background: #FFE0B2;
      position: absolute; bottom: 8px; right: 2px;
      border-radius: 4px 4px 0 0;
      transform-origin: bottom center; transform: rotate(25deg);
      animation: tail 2s ease-in-out infinite;
    }
    .tc-tail::after {
      content: ''; position: absolute; top: -2px; left: -2px;
      width: 12px; height: 12px; background: #FFE0B2;
      border-radius: 50%;
    }

    /* ── SLEEP ZZZ ────────────────────────────────────────────────── */
    .tc-zzz {
      position: absolute; top: 0; right: 0;
      font-size: 10px; color: #7EB6FF; font-weight: 900;
      display: none;
    }
    .tc-sleep .tc-zzz { display: flex; flex-direction: column; gap: 2px; align-items: center; }
    .tc-zzz span {
      animation: zzz 2.5s ease-in-out infinite;
      display: block;
    }
    .tc-zzz span:nth-child(1) { font-size: 8px; animation-delay: 0s; }
    .tc-zzz span:nth-child(2) { font-size: 11px; animation-delay: 0.8s; }
    .tc-zzz span:nth-child(3) { font-size: 14px; animation-delay: 1.6s; }

    /* ── HEART SPARKLES ───────────────────────────────────────────── */
    .tc-hearts { position: absolute; top: -4px; left: 50%; transform: translateX(-50%); display: none; }
    .tc-alert .tc-hearts { display: flex; gap: 2px; }
    .tc-hearts span {
      font-size: 9px; color: #FF6B9D;
      animation: sparkle 1s ease infinite;
    }
    .tc-hearts span:nth-child(2) { animation-delay: 0.3s; }
    .tc-hearts span:nth-child(3) { animation-delay: 0.6s; }

    /* ── BUBBLE ────────────────────────────────────────────────────── */
    .tc-bubble {
      position: absolute; bottom: 88px; left: 50%; transform: translateX(-50%);
      min-width: 140px; max-width: 220px;
      background: #fff; border-radius: 16px 16px 16px 4px;
      padding: 8px 12px; font-size: 11px; color: #333;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      display: none; white-space: pre-wrap; line-height: 1.5;
      animation: msg_fade 0.2s ease;
    }
    .tc-bubble.show { display: block; }
    .tc-bubble::after {
      content: ''; position: absolute; bottom: -6px; left: 12px;
      border-left: 6px solid transparent; border-right: 6px solid transparent;
      border-top: 7px solid #fff;
    }
    .tc-bubble .tc-bubble-tail {
      display: block; margin-top: 3px; color: #aaa; font-size: 9px;
    }
    /* Typing dots inside bubble */
    .tc-bubble .typing-dots { display: inline-flex; gap: 3px; margin-left: 4px; vertical-align: middle; }
    .tc-bubble .typing-dots span {
      width: 4px; height: 4px; background: #999; border-radius: 50%;
      display: inline-block; animation: typing_dots 1.2s ease infinite;
    }
    .tc-bubble .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .tc-bubble .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

    /* ── PANEL ─────────────────────────────────────────────────────── */
    .tc-panel {
      position: absolute; bottom: 90px; right: 0; width: 200px;
      background: #FFF8F0; border: 1.5px solid #FFE0B2;
      border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      overflow: hidden; display: none; font-size: 11px;
    }
    .tc-panel.open { display: block; animation: msg_fade 0.2s ease; }
    .tc-ph {
      background: linear-gradient(135deg,#FF9EB5,#FF6B9D);
      padding: 8px 12px; color: white; font-weight: 700; font-size: 12px;
      display: flex; align-items: center; gap: 6px;
    }
    .tc-pb { padding: 8px 12px; display: flex; flex-direction: column; gap: 5px; }
    .tc-pr { display: flex; justify-content: space-between; }
    .tc-pr span:first-child { color: #999; }
    .tc-pr span:last-child { color: #555; font-weight: 600; }
    .tc-pf {
      margin-top: 4px; padding-top: 6px; border-top: 1px solid #FFE0B2;
      display: flex; justify-content: space-between;
    }
    .tc-pf span:first-child { color: #999; }
    .tc-pf .tc-badge {
      padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 700;
    }
    .tc-badge.on  { background: #E8F5E9; color: #2E7D32; }
    .tc-badge.off { background: #FFEBEE; color: #C62828; }
    .tc-badge.err { background: #FFF3E0; color: #E65100; }

    /* ── STATUS DOT on cat ────────────────────────────────────────── */
    .tc-dot {
      width: 12px; height: 12px; border-radius: 50%;
      position: absolute; top: -2px; right: -2px;
      border: 2px solid #FFF8F0; font-size: 7px; color: white;
      display: flex; align-items: center; justify-content: center;
      font-weight: 900;
    }
    .tc-dot.G { background: #4CAF50; }
    .tc-dot.R { background: #F44336; }
    .tc-dot.O { background: #FF9800; }
    .tc-dot.N { background: #9E9E9E; }

    /* ── TOGGLE BAR — always visible ─────────────────────────── */
    .tc-toggle-bar {
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(15,15,26,0.88); border: 1.5px solid rgba(255,255,255,0.12);
      border-radius: 14px; padding: 7px 12px; margin-bottom: 6px;
      backdrop-filter: blur(6px); min-width: 180px;
    }
    .tc-toggle-label { font-size: 11px; color: #aaa; font-weight: 600; }
    .tc-toggle-btn {
      padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 800;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .tc-toggle-btn.on  { background: #4CAF50; color: #fff; }
    .tc-toggle-btn.off { background: #333; color: #777; border: 1px solid #444; }
  `);

  // ── BUILD CAT DOM ─────────────────────────────────────────────────────────
  const ui = document.createElement('div');
  ui.className = 'tc-wrap';
  ui.innerHTML = `
    <div class="tc-toggle-bar" id="tcToggleBar">
      <span class="tc-toggle-label">🐱 Sukii Bot</span>
      <button class="tc-toggle-btn off" id="tcToggleBtn">OFF</button>
    </div>
    <div class="tc-bubble" id="tcBubble">
      <span id="tcBubbleText"></span>
      <span class="tc-bubble-tail" id="tcBubbleTail"></span>
    </div>
    <div class="tc-panel" id="tcPanel">
      <div class="tc-ph">🐱 Sukii Status</div>
      <div class="tc-pb">
        <div class="tc-pr"><span>Mode</span><span id="tcPdMode">—</span></div>
        <div class="tc-pr"><span>Poll</span><span id="tcPdPoll">—</span></div>
        <div class="tc-pf">
          <span>Counter</span>
          <span id="tcPdCount">Intro:— Done:— CS:—</span>
        </div>
      </div>
    </div>
    <div class="tc-cat" id="tcCat">
      <div class="tc-dot N" id="tcDot">?</div>
      <div class="tc-hearts"><span>♥</span><span>♥</span><span>♥</span></div>
      <div class="tc-zzz"><span>z</span><span>z</span><span>z</span></div>
      <div class="tc-ear l"></div>
      <div class="tc-ear r"></div>
      <div class="tc-head">
        <div class="tc-eyes">
          <div class="tc-eye"></div>
          <div class="tc-eye"></div>
        </div>
        <div class="tc-nose"></div>
        <div class="tc-mouth"></div>
        <div class="tc-whiskers">
          <div class="tc-wh l1"></div><div class="tc-wh l2"></div><div class="tc-wh l3"></div>
          <div class="tc-wh r1"></div><div class="tc-wh r2"></div><div class="tc-wh r3"></div>
        </div>
      </div>
      <div class="tc-body"></div>
      <div class="tc-paw l"></div>
      <div class="tc-paw r"></div>
      <div class="tc-tail"></div>
    </div>
  `;
  document.body.appendChild(ui);

  // ── ELEMENTS ──────────────────────────────────────────────────────────────
  const cat       = document.getElementById('tcCat');
  const dot       = document.getElementById('tcDot');
  const bubble    = document.getElementById('tcBubble');
  const bText     = document.getElementById('tcBubbleText');
  const bTail     = document.getElementById('tcBubbleTail');
  const panel     = document.getElementById('tcPanel');
  const pdMode    = document.getElementById('tcPdMode');
  const pdPoll    = document.getElementById('tcPdPoll');
  const pdCount   = document.getElementById('tcPdCount');
  const toggleBtn = document.getElementById('tcToggleBtn');

  // ── STATE ─────────────────────────────────────────────────────────────────
  // 'sleep' | 'alert' | 'typing'
  let currentState = 'sleep';
  let typingText = '';
  let typingTimer = null;

  function setState(state, msg) {
    if (currentState === state) {
      if (state === 'typing' && msg) showBubble(msg);
      return;
    }
    currentState = state;

    // Remove all states
    cat.classList.remove('tc-sleep', 'tc-alert', 'tc-typing');

    if (state === 'sleep') {
      dot.className = 'tc-dot G'; dot.textContent = 'Z';
      hideBubble();
    } else if (state === 'alert') {
      dot.className = 'tc-dot R'; dot.textContent = '!';
      cat.classList.add('tc-alert');
      hideBubble();
      setTimeout(() => setState('sleep'), 6000);
    } else if (state === 'typing') {
      dot.className = 'tc-dot O'; dot.textContent = '…';
      cat.classList.add('tc-typing');
    }
  }

  function showBubble(text, tail) {
    if (text) {
      bText.textContent = text;
      bTail.textContent = tail || '';
      bubble.classList.add('show');
    } else {
      hideBubble();
    }
  }

  function hideBubble() {
    bubble.classList.remove('show');
  }

  // Typing animation: show text being typed char by char
  let typeIdx = 0;
  function animateTyping(fullText, onDone) {
    if (typingTimer) clearInterval(typingTimer);
    typeIdx = 0;
    showBubble('', 'Sukii sedang mengetik…');
    bubble.classList.add('show');

    // Add dots
    const dotsEl = document.createElement('span');
    dotsEl.className = 'typing-dots';
    dotsEl.innerHTML = '<span></span><span></span><span></span>';
    bText.textContent = '';
    bText.appendChild(dotsEl);

    typingTimer = setInterval(() => {
      if (typeIdx < fullText.length) {
        // Show partial text + dots
        bText.textContent = fullText.substring(0, typeIdx + 1);
        bText.appendChild(dotsEl);
        typeIdx++;
      } else {
        clearInterval(typingTimer);
        typingTimer = null;
        bText.textContent = fullText;
        if (onDone) setTimeout(onDone, 1500);
      }
    }, 60);
  }

  // ── PANEL TOGGLE ──────────────────────────────────────────────────────────
  cat.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) refreshPanel();
  });
  document.addEventListener('click', () => panel.classList.remove('open'));

  // ── STORAGE WATCH ─────────────────────────────────────────────────────────
  // Poll storage for overlay state changes
  let lastPollKey = '';
  function pollOverlayState() {
    chrome.storage.local.get([STATE_KEY, 'tevi_cs_state', 'tevi_cs_config'], d => {
      const os = d[STATE_KEY] || {};
      const st = d['tevi_cs_state'] || {};
      const cfg = d['tevi_cs_config'] || {};
      renderOverlay(os, st, cfg);
    });
  }

  function renderOverlay(os, st, cfg) {
    // Read botEnabled from overlay state (SW writes here on every poll/toggle)
    if (os.botEnabled) {
      dot.className = 'tc-dot G'; dot.textContent = 'Z';
      toggleBtn.textContent = 'ON';
      toggleBtn.className = 'tc-toggle-btn on';
    } else {
      dot.className = 'tc-dot N'; dot.textContent = '✕';
      toggleBtn.textContent = 'OFF';
      toggleBtn.className = 'tc-toggle-btn off';
    }

    // Click toggle → write directly to storage (bypasses SW message channel)
    toggleBtn.onclick = async () => {
      const newVal = !os.botEnabled;
      await chrome.storage.local.set({ tevi_cs_toggle_req: { enabled: newVal, ts: Date.now() } });
      // Optimistic update
      os.botEnabled = newVal;
      dot.className = newVal ? 'tc-dot G' : 'tc-dot N';
      dot.textContent = newVal ? 'Z' : '✕';
      toggleBtn.textContent = newVal ? 'ON' : 'OFF';
      toggleBtn.className = newVal ? 'tc-toggle-btn on' : 'tc-toggle-btn off';
    };

    // React to typing state
    if (os.typing === true && os.typingText) {
      setState('typing', os.typingText);
      animateTyping(os.typingText, () => {
        setState('sleep');
        chrome.storage.local.set({ [STATE_KEY]: { ...os, typing: false, typingText: '' } });
      });
    } else if (os.newMessage) {
      setState('alert', os.newMessage);
      showBubble(os.newMessage, os.newSlug ? `@${os.newSlug}` : '');
      // Clear after 5s
      setTimeout(() => {
        chrome.storage.local.get(STATE_KEY, d => {
          const s = d[STATE_KEY] || {};
          if (s.newMessage === os.newMessage) {
            chrome.storage.local.set({ [STATE_KEY]: { ...s, newMessage: '' } });
          }
        });
      }, 5000);
    }

    // 24/7 mode — always show Active (user controls ON/OFF via extension popup)
    pdMode.textContent = '🌙 24/7';
    pdPoll.textContent = os.pollTime ? `~${os.pollTime}s` : '—';
    const lr = st.lastResult || {};
    const lastTs = lr.ts ? new Date(lr.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    pdCount.textContent = `Last:${lr.conv || '—'} ${lastTs}`;
  }

  // ── INITIAL ───────────────────────────────────────────────────────────────
  pollOverlayState();
  setInterval(pollOverlayState, 3000);
})();
