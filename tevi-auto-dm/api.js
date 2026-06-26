/**
 * API — Tevi Auto-DM Bot
 * Permanent browser + Direct API send (Method 2 primary, Method 1 fallback)
 * Browser launched ONCE, stays open. Login once, poll every 3 min.
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const cfg = require('./config');

const LOG = (...args) => console.log(`[${new Date().toISOString()}] [API]`, ...args);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HMAC ────────────────────────────────────────────────────────────────────
function hmac(pathname) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', cfg.WAPI_SIGN_KEY)
    .update(pathname + ts).digest('base64');
  return ts + '-' + sig;
}

// ── STATE ───────────────────────────────────────────────────────────────────
let _browser = null;
let _context = null;
let _page = null;
let _token = null;
let _tokenPayload = null;
let _pendingTokenResolve = null;
let _session = null; // page.request session for API calls

async function ensureBrowser() {
  if (_browser && _browser.isConnected()) return true;

  LOG('[BROWSER] Launching permanent browser...');
  _browser = await chromium.launch({
    headless: false,
    executablePath: cfg.CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
    ],
  });

  _context = await _browser.newContext({ viewport: { width: 1280, height: 800 } });
  _page = await _context.newPage();

  // Capture token from auth response headers
  _page.on('response', async res => {
    try {
      const url = res.url();
      if (url.includes('wapi.flowstreamx.com') && url.includes('/auth/v1/token')) {
        if (_token) return;
        if (res.request().method() !== 'GET') return;
        const authHdr = res.headers()['authorization'] || '';
        const tok = authHdr.replace('Bearer ', '');
        if (tok && tok.length > 50 && tok.includes('.')) {
          _token = tok;
          LOG('[TOKEN] Captured from response: %s...', tok.substring(0, 20));
          if (_pendingTokenResolve) { _pendingTokenResolve(true); _pendingTokenResolve = null; }
          return;
        }
        const text = await res.text().catch(() => '');
        try {
          const json = JSON.parse(text);
          const bodyTok = json?.data?.access_token || json?.access_token;
          if (bodyTok && bodyTok.length > 50 && bodyTok.includes('.')) {
            _token = bodyTok;
            LOG('[TOKEN] Captured from body: %s...', bodyTok.substring(0, 20));
            if (_pendingTokenResolve) { _pendingTokenResolve(true); _pendingTokenResolve = null; }
          }
        } catch {}
      }
    } catch {}
  });

  // Create a dedicated API session that inherits cookies
  _session = _context.request;

  LOG('[BROWSER] Launched');
  return true;
}

// ── LOGIN ────────────────────────────────────────────────────────────────────
async function login() {
  LOG('[LOGIN] Navigating to tevi.com...');
  await _page.goto('https://tevi.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await _page.waitForTimeout(cfg.LOGIN_WAIT_MS);

  // Click login banner if visible
  const loginBtn = _page.locator('#nav-login-banner-btn');
  if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await loginBtn.click();
    LOG('[LOGIN] Banner clicked');
    await _page.waitForTimeout(2000);
  }

  // Click "with email" button in modal
  const emailBtn = _page.locator('button').filter({ hasText: /^with\s+email$/i }).first();
  await emailBtn.waitFor({ timeout: 10000 });
  await emailBtn.click();
  LOG('[LOGIN] Email button clicked');
  await _page.waitForTimeout(3000);

  // Fill email — press Tab after to trigger validation
  const emailInput = _page.locator('input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.click({ clickCount: 3 });
  await emailInput.press('ControlOrMeta+a');
  await emailInput.type(cfg.EMAIL, { delay: 50 });
  await emailInput.press('Tab');
  LOG('[LOGIN] Email filled: %s', cfg.EMAIL);

  // Fill password — press Tab then Enter to submit
  const passInput = _page.locator('input[type="password"]').first();
  await passInput.waitFor({ timeout: 5000 });
  await passInput.click({ clickCount: 3 });
  await passInput.press('ControlOrMeta+a');
  await passInput.type(cfg.PASSWORD, { delay: 50 });
  LOG('[LOGIN] Password filled');

  // Submit via Enter key — more reliable than click
  await passInput.press('Enter');
  LOG('[LOGIN] Submitted (Enter)');
  await _page.waitForTimeout(10000);

  // Wait for login to complete (banner disappears)
  for (let i = 0; i < 30; i++) {
    const visible = await _page.locator('#nav-login-banner-btn').isVisible({ timeout: 1000 }).catch(() => false);
    if (!visible) {
      LOG('[LOGIN] Logged in after %ds ✅', i + 1);
      return true;
    }
    await _page.waitForTimeout(1000);
  }

  // Fallback: try direct form submit via JS
  LOG('[LOGIN] Banner still visible — trying JS submit...');
  const submitted = await _page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) { form.submit(); return true; }
    const btn = document.querySelector('button[type="submit"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await _page.waitForTimeout(5000);

  if (submitted) {
    for (let i = 0; i < 20; i++) {
      const visible = await _page.locator('#nav-login-banner-btn').isVisible({ timeout: 1000 }).catch(() => false);
      if (!visible) { LOG('[LOGIN] Logged in via JS submit ✅'); return true; }
      await _page.waitForTimeout(1000);
    }
  }

  // Take screenshot on failure
  await _page.screenshot({ path: 'login-fail.png' });
  LOG('[LOGIN] Failed — screenshot saved');
  return false;
}

// ── CAPTURE TOKEN ────────────────────────────────────────────────────────────
async function captureToken() {
  if (_token) {
    try {
      _tokenPayload = JSON.parse(Buffer.from(_token.split('.')[1], 'base64').toString());
      LOG('[TOKEN] Already have: UID=%s ✅', _tokenPayload.uid);
    } catch {}
    return true;
  }

  const tokenPromise = new Promise(r => { _pendingTokenResolve = r; });

  LOG('[TOKEN] Navigating to profile to trigger SW auth...');
  await _page.goto('https://tevi.com/@' + cfg.MY_SLUG, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _page.waitForTimeout(8000);

  const tokenReceived = await Promise.race([tokenPromise, new Promise(r => setTimeout(() => r(false), 10000))]);

  if (!tokenReceived && !_token) {
    // Fallback: read from localStorage
    const raw = await _page.evaluate(() => localStorage.getItem('user_logged_list'));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const userData = Object.values(parsed)[0];
        _token = userData?.access_token;
        if (_token) LOG('[TOKEN] From localStorage: %s...', _token.substring(0, 20));
      } catch {}
    }
  }

  if (!_token) {
    LOG('[TOKEN] ERROR: No token!');
    await _page.screenshot({ path: 'no-token.png' });
    return false;
  }

  try {
    _tokenPayload = JSON.parse(Buffer.from(_token.split('.')[1], 'base64').toString());
    LOG('[TOKEN] UID=%s anonymous=%s ✅', _tokenPayload.uid, _tokenPayload.anonymous);
  } catch {
    LOG('[TOKEN] Captured (decode failed)');
  }

  return true;
}

// ── API CALLS (Browser context — carries cf_clearance cookie) ────────────────

// Generic API fetch via browser context
async function apiFetch(method, pathname, body) {
  const baseUrl = 'https://wapi.flowstreamx.com';
  const verify = hmac(pathname);
  const url = `${baseUrl}${pathname}${pathname.includes('?') ? '&' : '?'}verify=${verify}`;

  const headers = {
    'Authorization': `Bearer ${_token}`,
    'Content-Type': 'application/json',
    'Origin': 'https://tevi.com',
    'Referer': 'https://tevi.com/messages',
    'Accept': 'application/json',
  };

  const postData = body ? JSON.stringify(body) : undefined;

  try {
    const resp = await _page.evaluate(async ({ url, method, headers, postData }) => {
      const opts = { method, headers };
      if (postData) opts.body = postData;
      const r = await fetch(url, opts);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, ok: r.ok, data };
    }, { url, method, headers, postData });

    return resp;
  } catch (e) {
    return { status: 0, ok: false, data: e.message };
  }
}

// ── GET CONVERSATIONS ────────────────────────────────────────────────────────
async function getConversations(filter = 'ALL', limit = 20) {
  const pathname = '/messenger/v2/rpc/get_recent_conversations';
  const resp = await apiFetch('GET', `${pathname}?limit=${limit}&filter=${filter}`);
  if (resp.ok && resp.data?.data?.results) {
    LOG('[CONVS] Got %d conversations', resp.data.data.results.length);
    return resp.data.data.results;
  }
  LOG('[CONVS] Failed: %s', JSON.stringify(resp.data).substring(0, 100));
  return null;
}

// ── GET MESSAGES ─────────────────────────────────────────────────────────────
async function getMessages(convId) {
  const pathname = '/messenger/v2/rpc/get_messages';
  const resp = await apiFetch('GET', `${pathname}?conversation_id=${convId}&limit=${cfg.MAX_MSGS}`);
  if (resp.ok) {
    const results = resp.data?.data?.results || resp.data?.results || resp.data?.data || [];
    return Array.isArray(results) ? results : [];
  }
  return [];
}

// ── SEND MESSAGE ─────────────────────────────────────────────────────────────
async function sendMessage(convId, text) {
  const pathname = '/messenger/v2/rpc/send_message';
  const resp = await apiFetch('POST', pathname, {
    conversation_id: convId,
    input_text: text,
    msg_type: 'TEXT',
    parser: 'PLAIN',
  });

  if (resp.ok) {
    LOG('[SEND] OK conv=%s', convId.substring(0, 8));
    return { ok: true, status: resp.status };
  }
  LOG('[SEND] Failed status=%s data=%s', resp.status, JSON.stringify(resp.data).substring(0, 100));
  return { ok: false, status: resp.status, data: resp.data };
}

// ── MARK READ ────────────────────────────────────────────────────────────────
async function markRead(convId) {
  const pathname = `/messenger/v2/conversation/${convId}/read`;
  const resp = await apiFetch('POST', pathname);
  // Try RPC fallback
  if (!resp.ok) {
    const resp2 = await apiFetch('POST', '/messenger/v2/rpc/mark_conversation_read', { conversation_id: convId });
    return resp2.ok;
  }
  return true;
}

// ── SHUTDOWN ─────────────────────────────────────────────────────────────────
async function shutdown() {
  if (_browser) {
    LOG('[BROWSER] Closing...');
    await _browser.close().catch(() => {});
    _browser = null; _context = null; _page = null; _token = null;
  }
}

function isConnected() {
  return !!_browser && _browser.isConnected();
}

function getToken() { return _token; }
function getTokenPayload() { return _tokenPayload; }

module.exports = {
  ensureBrowser, login, captureToken,
  getConversations, getMessages, sendMessage, markRead,
  shutdown, isConnected, getToken, getTokenPayload,
};
