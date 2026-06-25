/**
 * CONTENT SCRIPT — Tevi CS Bot
 * Inject ke tevi.com untuk capture token + logging
 */

const LOG_SERVER = 'http://localhost:3131';
const LOG_SOURCE = 'CS';

async function sendLog(message, level = 'INFO', data = null) {
  try {
    await fetch(`${LOG_SERVER}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: LOG_SOURCE, level, message, data }),
    });
  } catch {}
}

function getTeviToken() {
  try {
    const raw = localStorage.getItem('user_logged_list');
    if (!raw) return { success: false, error: 'no raw data' };
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return { success: false, error: 'user_logged_list is empty object' };
    const userData = Object.values(parsed)[0];
    const token = userData?.access_token;
    if (token) return { success: true, token, uid: userData?.uid };
    return { success: false, error: 'no access_token', userDataKeys: Object.keys(userData || {}) };
  } catch (e) {
    return { success: false, error: e.message };
  }
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

// Auto-report token saat page load
(function() {
  const result = getTeviToken();
  if (result.success) {
    const payload = decodePayload(result.token);
    sendLog(`[CS] Token found — UID=${payload?.uid} | prefix=${result.token.substring(0, 20)}`);
    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_UPDATE',
        token: result.token,
        uid: payload?.uid || null,
      }).catch(() => {});
    } catch {}
  } else {
    sendLog(`[CS] No token — ${result.error}`, 'DEBUG');
  }
})();

// Listen dari background / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_TOKEN') {
    const result = getTeviToken();
    sendLog(`[CS] GET_TOKEN → ${result.success ? 'OK' : 'FAIL'} (${result.error || 'OK'})`, 'DEBUG');
    sendResponse(result);
    return true;
  }

  if (msg.type === 'DIAGNOSE') {
    // Full diagnostic report
    const raw = localStorage.getItem('user_logged_list');
    const rawKeys = raw ? Object.keys(JSON.parse(raw)) : [];
    const result = getTeviToken();
    const payload = result.token ? decodePayload(result.token) : null;

    const report = {
      pageUrl: window.location.href,
      hasRaw: !!raw,
      rawKeys,
      rawLength: raw?.length || 0,
      tokenFound: result.success,
      tokenPrefix: result.token?.substring(0, 20) || null,
      tokenLength: result.token?.length || 0,
      payloadUid: payload?.uid || null,
      payloadAnonymous: payload?.anonymous || null,
      payloadExp: payload?.exp || null,
      userDataKeys: result.userDataKeys || null,
    };

    sendLog('[CS] DIAGNOSE request', 'DEBUG', report);
    sendResponse(report);
    return true;
  }

  if (msg.type === 'PING') {
    sendResponse({ pong: true, url: window.location.href });
    return true;
  }
});
