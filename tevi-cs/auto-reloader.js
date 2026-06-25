/**
 * AUTO-RELOADER v2 — watches tevi-cs files, reloads extension via CDP
 *
 * How it works:
 * 1. File changes detected by chokidar
 * 2. CDP attaches to the extension's background page / service worker
 * 3. Injects chrome.runtime.sendMessage({type:'__TEVI_RELOAD__'})
 * 4. background.js receives → calls chrome.runtime.reload() → SW restarts with new code
 *
 * Prerequisites:
 * 1. Launch Edge: msedge --remote-debugging-port=9222
 *    (OR run: node auto-reloader.js — it will auto-launch Edge)
 * 2. Load extension at edge://extensions/ (keep Developer mode ON)
 *
 * Usage: node auto-reloader.js
 */

const WebSocket = require('ws');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const EXT_DIR = __dirname;
const CDP_PORT = 9222;
const DEBOUNCE_MS = 600;
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let ws = null;
let msgId = 0;
let pending = {};
let connected = false;
let reloadTimer = null;

// ── LOG ─────────────────────────────────────────────────────────────────────

function log(...args) {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  console.log(`[${ts}]`, ...args);
}

// ── EDGE CDP LIFECYCLE ──────────────────────────────────────────────────────

function isCDPReady() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: 'localhost', port: CDP_PORT, path: '/json/version', timeout: 2000 },
      (res) => resolve(res.statusCode === 200)
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function startEdgeWithCDP() {
  log('Launching Edge with --remote-debugging-port=' + CDP_PORT + '...');
  try {
    spawn(EDGE_PATH, [
      '--remote-debugging-port=' + CDP_PORT,
      '--no-first-run',
      '--no-default-browser-check',
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    return true;
  } catch (e) {
    log('ERROR: Failed to start Edge:', e.message);
    return false;
  }
}

async function connectWS() {
  return new Promise((resolve) => {
    if (ws) { ws.close(); ws = null; }
    const url = `ws://localhost:${CDP_PORT}/devtools/browser`;
    ws = new WebSocket(url);

    ws.on('open', () => { connected = true; resolve(true); });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id && pending[msg.id]) {
          pending[msg.id](msg);
          delete pending[msg.id];
        }
      } catch {}
    });
    ws.on('close', () => { connected = false; ws = null; });
    ws.on('error', () => { connected = false; ws = null; });
    setTimeout(() => { if (!connected) { try { ws?.close(); } catch {} resolve(false); } }, 5000);
  });
}

function cdpSend(method, params = {}) {
  return new Promise((resolve) => {
    if (!ws || !connected) { resolve(null); return; }
    const id = ++msgId;
    pending[id] = resolve;
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending[id]) { delete pending[id]; resolve(null); } }, 10000);
  });
}

function cdpSendToTarget(targetId, sessionId, method, params = {}) {
  return cdpSend('Target.sendMessageToTarget', { targetId, sessionId, message: JSON.stringify({ id: ++msgId, method, params }) });
}

// ── TARGET DISCOVERY ────────────────────────────────────────────────────────

async function getTargets() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: 'localhost', port: CDP_PORT, path: '/json', timeout: 3000 },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// ── RELOAD ─────────────────────────────────────────────────────────────────

async function reloadExtension() {
  if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }

  log('─'.repeat(50));
  log('[RELOAD] Triggering extension reload...');

  if (!connected) {
    const ok = await connectWS();
    if (!ok) { log('[RELOAD] FAIL — CDP not connected'); return; }
  }

  const targets = await getTargets();
  if (!targets.length) { log('[RELOAD] FAIL — no CDP targets'); return; }

  // Find extension service worker / background page
  const extTargets = targets.filter(t =>
    t.type === 'service_worker' ||
    t.type === 'background_page' ||
    (t.url && t.url.startsWith('chrome-extension://')) ||
    t.title === 'Tevi CS Bot'
  );

  if (!extTargets.length) {
    log('[RELOAD] Extension target not found. Your targets:');
    targets.slice(0, 6).forEach(t => log(`  [${t.type}] ${t.title} — ${t.id}`));
    return;
  }

  let anySuccess = false;

  for (const target of extTargets) {
    log(`[RELOAD] Target: [${target.type}] ${target.title || target.id}`);

    // Attach to target
    const attached = await cdpSend('Target.attachToTarget', {
      targetId: target.id,
      flatten: true,
    });

    const sessionId = attached?.sessionId || null;
    log(`[RELOAD] Attached: sessionId=${sessionId}`);

    // Inject the reload message — this goes to background.js's onMessage handler
    const script = `
      (function() {
        chrome.runtime.sendMessage({ type: '__TEVI_RELOAD__' }, function(resp) {
          console.log('TeviCS: __TEVI_RELOAD__ sent, response:', resp);
        });
      })();
    `;

    const evalResult = await cdpSend('Runtime.evaluate', {
      expression: script,
      returnByValue: false,
    });

    if (evalResult && !evalResult.error) {
      log(`[RELOAD] ✓ Sent __TEVI_RELOAD__ to background.js`);
      log(`[RELOAD] ✓ Extension will reload → new code active`);
      anySuccess = true;
    } else {
      log(`[RELOAD] eval failed:`, evalResult?.error?.message || 'unknown');
    }
  }

  if (!anySuccess) {
    log('[RELOAD] All methods failed — manual reload needed at edge://extensions/');
  }

  log('─'.repeat(50));
}

function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    reloadExtension();
  }, DEBOUNCE_MS);
}

// ── FILE WATCHER ─────────────────────────────────────────────────────────────

function watch() {
  let chokidar;
  try { chokidar = require('chokidar'); }
  catch { log('ERROR: chokidar not found. Run: npm install chokidar'); return; }

  const watchFiles = [
    'background.js',
    'content-script.js',
    'overlay.js',
    'manifest.json',
    'popup/popup.html',
    'popup/popup.js',
  ].map(f => path.join(EXT_DIR, f));

  const watcher = chokidar.watch(watchFiles, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 50 },
    usePolling: false,
  });

  watcher.on('change', (fp) => log(`[FILE] ${path.relative(EXT_DIR, fp)} changed`));
  watcher.on('add',    (fp) => log(`[FILE] ${path.relative(EXT_DIR, fp)} added`));
  watcher.on('error',  (e)  => log('[WATCHER]', e.message));

  // Debounce: collect all changes in 600ms window
  watcher.on('all', (event, fp) => {
    log(`[WATCH] ${event}: ${path.relative(EXT_DIR, fp)}`);
    scheduleReload();
  });

  log('[WATCHER] Monitoring:', watchFiles.map(f => path.basename(f)).join(', '));
}

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  log('╔' + '═'.repeat(56) + '╗');
  log('║          Tevi CS Bot — Auto Reloader v2               ║');
  log('╚' + '═'.repeat(56) + '╝');

  // Ensure Edge with CDP
  let cdpReady = await isCDPReady();
  if (!cdpReady) {
    log('CDP not ready — launching Edge...');
    startEdgeWithCDP();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      cdpReady = await isCDPReady();
      if (cdpReady) { log('Edge CDP ready ✓'); break; }
      if (i === 19) {
        log('ERROR: Edge did not start. Open Edge manually with:');
        log('  msedge --remote-debugging-port=9222');
        log('Then restart this script.');
        return;
      }
    }
  } else {
    log('Edge CDP detected ✓');
  }

  // Connect WS
  const wsOk = await connectWS();
  if (!wsOk) { log('ERROR: Could not connect to CDP WebSocket'); return; }

  // Show targets
  const targets = await getTargets();
  log(`Targets (${targets.length}):`);
  targets.forEach(t => log(`  [${t.type}] ${t.title || '?'} — ${t.id}`));

  // Start watching
  watch();
  log('[READY] Change any extension file to trigger auto-reload');
}

main().catch(e => log('Fatal:', e.message));
