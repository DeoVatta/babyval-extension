/**
 * BACKGROUND.JS — Tevi CS Bot v0.9
 *
 * API-based message sending — no tab required for sending
 * Flow:
 * - Intercept user's manual send → capture exact API call + auth
 * - Toggle ON → chrome.alarms every 20s → scan via CS (tab)
 * - Process convs → send via API (no tab needed)
 */

const EXT = 'Tevi CS v0.9';
const LOG = 'http://localhost:3131';
const MY_SLUG = 'cutieval';
const MY_UID = '392388705';

// ── Utilities ───────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function log(level, msg, data) {
  const payload = { source: 'BG', level, message: '[BG] ' + msg, ts: new Date().toISOString(), ...(data || {}) };
  try { await fetch(LOG + '/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); } catch {}
  if (level === 'ERROR') console.error('[BG]', msg, data || '');
}

async function storageGet(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}
async function storageSet(obj) {
  return new Promise(r => chrome.storage.local.set(obj));
}

// ── API Send (tabless) ──────────────────────────────────────────────────

// Captured from interceptor when user manually sends a DM
async function apiSendMessage(recipientSlug, text) {
  const { apiSendPattern } = await storageGet(['apiSendPattern']) || {};
  if (!apiSendPattern) {
    log('ERROR', '[API] No send pattern captured yet — send a DM manually first');
    return false;
  }

  log('INFO', '[API] Sending to @' + recipientSlug + ': ' + text.substring(0, 50) + '...');

  try {
    // Replay the captured request with new body
    const headers = { ...apiSendPattern.headers };
    // Override Content-Type if needed
    headers['Content-Type'] = 'application/json';

    // Build body — try to adapt from captured pattern
    let body;
    if (apiSendPattern.bodyFields) {
      // Build from field map
      const bf = apiSendPattern.bodyFields;
      body = {
        conversationId: bf.conversationId || recipientSlug,
        recipientId: bf.recipientId || recipientSlug,
        message: text,
        content: text,
        text: text,
        body: text,
      };
      // Keep original fields that should persist
      for (const [k, v] of Object.entries(bf)) {
        if (!['message','content','text','body'].includes(k)) {
          body[k] = v;
        }
      }
    } else {
      body = { message: text, recipient: recipientSlug };
    }

    const res = await fetch(apiSendPattern.url, {
      method: apiSendPattern.method || 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include', // include cookies
    });

    const status = res.status;
    let respText = '';
    try { respText = await res.text(); } catch {}

    if (res.ok) {
      log('INFO', '[API] Sent OK to @' + recipientSlug + ' (status=' + status + ')');
      return true;
    } else {
      log('ERROR', '[API] Send failed @' + recipientSlug + ' (status=' + status + '): ' + respText.substring(0, 200));
      return false;
    }
  } catch (e) {
    log('ERROR', '[API] Send error @' + recipientSlug + ': ' + e.message);
    return false;
  }
}

// ── Tab helpers ─────────────────────────────────────────────────────────

async function getTeviTab() {
  const tabs = await new Promise(r => chrome.tabs.query({}, r));
  let tab = tabs.find(t => t.url && t.url.match(/tevi\.com\//)) || null;
  if (!tab && tabs.length > 0) {
    tab = await new Promise(r => chrome.tabs.create({ url: 'https://tevi.com/messages', active: false }, r));
    await sleep(3000);
  }
  return tab;
}

async function ensureCS(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: 'PING' }); return true; } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
      await sleep(2000);
      try { await chrome.tabs.sendMessage(tabId, { type: 'PING' }); return true; } catch { return false; }
    } catch { return false; }
  }
}

// ── AI Reply ────────────────────────────────────────────────────────────

async function generateReply(userSlug, messages, slot) {
  const { aiKey, hmacSecret } = await storageGet(['tevi_cs_secrets']) || {};
  if (!aiKey) return buildFallbackReply(messages, slot);

  const { persona, rules } = await storageGet(['tevi_cs_config']) || {};
  const ctx = messages.map((m, i) => `[${i+1}]${m.hasImage ? ' [IMG] ' : ' '}${m.text}`).join('\n');

  let systemPrompt = persona || 'Kamu Sukii, AI Assistant-nya Baby Val. Jawaban pendek, dingin, informatif.';

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    temperature: 0.8,
    system: systemPrompt,
    messages: [{ role: 'user', content: `User @${userSlug}:\n${ctx}\n\nBalas sebagai Sukii (slot ${slot}):` }]
  });

  try {
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body
    });
    if (!res.ok) return buildFallbackReply(messages, slot);
    const data = await res.json();
    let reply = (data.content?.[0]?.text || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    if (reply.length > 500) reply = reply.substring(0, 497) + '...';
    return reply || buildFallbackReply(messages, slot);
  } catch (e) {
    log('ERROR', 'AI failed: ' + e.message);
    return buildFallbackReply(messages, slot);
  }
}

function buildFallbackReply(messages, slot) {
  if (slot === 1) return null;
  const last = (messages[messages.length - 1]?.text || '').toLowerCase();
  if (last.match(/foto|video|konten|porn|sexy/)) return 'Konten untuk member.';
  if (last.match(/vcs|videocall/)) return 'VCS tersedia. babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/payment|transfer|bayar/)) return 'babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/member/)) return 'tevi.com/@cutieval. Pilih membership.';
  if (last.match(/terima kasih/)) return 'Sukii. Ada yang perlu ditanyakan?';
  return 'Chat langsung dengan Baby Val: membership Tevi.';
}

const GREETING = `Halo aku Sukii, AI Assistant-nya Baby Val 💕\nKalau mau Chat sama Baby Val, membership dulu ya di Tevi\nKalau mau VCS bisa bayar di babyval.com`;

// ── Conv Meta ───────────────────────────────────────────────────────────

async function getConvMeta(slug) {
  const { convMeta } = await storageGet(['convMeta']) || {};
  return convMeta[slug.toLowerCase()] || null;
}

async function setConvMeta(slug, meta) {
  const { convMeta } = await storageGet(['convMeta']) || {};
  convMeta[slug.toLowerCase()] = { ...(convMeta[slug.toLowerCase()] || {}), ...meta, updatedAt: Date.now() };
  await storageSet({ convMeta });
}

const GREETING_COOLDOWN_MS = 3 * 60 * 60 * 1000;

async function decideSlot(slug, lastMsgTs) {
  const meta = await getConvMeta(slug);
  const now = Date.now();
  if (!meta) return { type: 'greeting', slot: 1, greetingCooldownTs: now + GREETING_COOLDOWN_MS };
  if (meta.slot >= 4) return { type: 'greeting', slot: 1, greetingCooldownTs: now + GREETING_COOLDOWN_MS };
  if (lastMsgTs && (now - lastMsgTs) > GREETING_COOLDOWN_MS) return { type: 'greeting', slot: 1, greetingCooldownTs: now + GREETING_COOLDOWN_MS };
  return { type: 'reply', slot: (meta.slot || 0) + 1 };
}

// ── Image Cooldown ──────────────────────────────────────────────────────

const IMAGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

async function isImageCooldown(slug) {
  const { imageCooldownUsers } = await storageGet(['imageCooldownUsers']) || {};
  const ts = imageCooldownUsers?.[slug.toLowerCase()];
  if (!ts) return false;
  if (Date.now() - ts > IMAGE_COOLDOWN_MS) return false;
  return true;
}

async function addImageCooldown(slug) {
  const { imageCooldownUsers } = await storageGet(['imageCooldownUsers']) || {};
  imageCooldownUsers[slug.toLowerCase()] = Date.now();
  await storageSet({ imageCooldownUsers });
}

// ── Process One Conversation ─────────────────────────────────────────────

async function processConv(tabId, slug) {
  log('INFO', '[PROC] Processing @' + slug);
  await setConvMeta(slug, { status: 'processing' });

  // Navigate to DM page to get messages
  try {
    await chrome.tabs.update(tabId, { url: `https://tevi.com/@${slug}/messages`, active: true });
    await sleep(4000);
  } catch (e) {
    log('ERROR', '[PROC] Navigate error @' + slug + ': ' + e.message);
    return false;
  }

  await ensureCS(tabId);

  // Get messages
  const msgsResp = await chrome.tabs.sendMessage(tabId, { type: 'GET_MSGS', count: 4 }).catch(() => null);
  const userMessages = msgsResp?.messages || [];
  log('INFO', '[PROC] Got ' + userMessages.length + ' msgs for @' + slug);

  const checkResp = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_DM' }).catch(() => ({}));
  const lastMsgTs = checkResp?.lastMsgTs || Date.now();

  // Check for images
  if (checkResp?.hasImage) {
    await addImageCooldown(slug);
    log('INFO', '[PROC] Image from @' + slug + ' → cooldown 6h');
  }

  // Decide slot
  const { type, slot, greetingCooldownTs } = await decideSlot(slug, lastMsgTs);
  log('INFO', '[PROC] Slot=' + slot + ' type=' + type + ' for @' + slug);

  const reply = type === 'greeting' ? GREETING : (await generateReply(slug, userMessages, slot) || GREETING);

  // Send via API (no tab needed)
  const sent = await apiSendMessage(slug, reply);
  log('INFO', '[PROC] Send result=' + sent + ' @' + slug);

  await setConvMeta(slug, {
    status: sent ? 'done' : 'failed',
    slot: sent ? slot : null,
    greetingCooldownTs: type === 'greeting' ? greetingCooldownTs : (await getConvMeta(slug))?.greetingCooldownTs,
    lastReplyAt: sent ? Date.now() : null,
  });

  return sent;
}

// ── Main Scan ───────────────────────────────────────────────────────────

async function runScan(tabId) {
  const { botEnabled } = await storageGet(['tevi_cs_state']) || {};
  if (!botEnabled) return;

  // Navigate to messages page
  try { await chrome.tabs.update(tabId, { url: 'https://tevi.com/messages', active: true }); } catch {}
  await sleep(3000);
  await ensureCS(tabId);
  await sleep(2000);

  const scanResp = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_CONVS' }).catch(() => null);
  if (!scanResp?.ok) {
    log('ERROR', '[SCAN] Scan failed');
    return;
  }

  const raw = scanResp.convs || [];
  log('INFO', '[SCAN] ' + raw.length + ' unreplied convs');

  const filtered = [];
  for (const conv of raw) {
    const slug = conv.slug;
    if (!slug || slug.toLowerCase() === MY_SLUG) continue;
    const meta = await getConvMeta(slug);
    if (meta?.status === 'processing') continue;
    if ((meta?.navigateFailCount || 0) >= 3) continue;
    if (await isImageCooldown(slug)) continue;
    filtered.push(conv);
  }

  log('INFO', '[SCAN] ' + filtered.length + ' after filter');
  if (!filtered.length) return;

  const sent = await processConv(tabId, filtered[0].slug);

  const st = await storageGet(['tevi_cs_state']) || {};
  st.lastResult = { conv: filtered[0].slug, ok: sent, ts: Date.now() };
  st.lastScanAt = Date.now();
  await storageSet({ tevi_cs_state: st });

  await syncOverlay({ botEnabled: true, pollTime: 20 });
  log('INFO', '[SCAN] Done: @' + filtered[0].slug + ' result=' + sent);
}

// ── Overlay Sync ────────────────────────────────────────────────────────

async function syncOverlay(state) {
  await storageSet({ tevi_cs_overlay_state: { ...state, updatedAt: Date.now() } });
}

// ── Alarms ──────────────────────────────────────────────────────────────

const POLL = 20; // seconds

async function setupAlarms() {
  try {
    for (const n of ['tevi_cs_keepalive', 'tevi_cs_poll']) {
      const a = await chrome.alarms.get(n);
      if (a) chrome.alarms.clear(n);
    }
    chrome.alarms.create('tevi_cs_keepalive', { delayInMinutes: 0.4, periodInMinutes: 0.4 });
    chrome.alarms.create('tevi_cs_poll', { delayInMinutes: POLL / 60, periodInMinutes: POLL / 60 });
  } catch {}
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tevi_cs_poll') return;
  const { botEnabled } = await storageGet(['tevi_cs_state']) || {};
  if (!botEnabled) return;

  let tab = await getTeviTab();
  if (!tab) return;

  const ok = await ensureCS(tab.id);
  if (!ok) {
    log('WARN', '[ALARM] CS inject failed, retrying...');
    tab = await getTeviTab();
    if (tab) await ensureCS(tab.id);
  }

  await runScan(tab?.id);
});

// ── Init ────────────────────────────────────────────────────────────────

async function init() {
  log('INFO', 'SW v0.9 starting...');

  const st = await storageGet(['tevi_cs_state']) || {};
  st.queueBusy = false;
  await storageSet({ tevi_cs_state: st });

  await setupAlarms();
  await syncOverlay({ botEnabled: false, pollTime: POLL });

  // Listen for toggle
  chrome.storage.onChanged.addListener(async (changes) => {
    if (!changes.tevi_cs_toggle_req) return;
    const req = changes.tevi_cs_toggle_req.newValue;
    if (!req) return;

    const st = await storageGet(['tevi_cs_state']) || {};
    const newEnabled = req.enabled;
    log('INFO', '[TOGGLE] ' + (st.botEnabled ? 'ON' : 'OFF') + ' → ' + (newEnabled ? 'ON' : 'OFF'));

    await storageSet({
      tevi_cs_toggle_req: null,
      tevi_cs_toggle_ack: { enabled: newEnabled, ts: Date.now() },
      tevi_cs_state: { ...st, botEnabled: newEnabled },
    });

    await syncOverlay({ botEnabled: newEnabled, pollTime: POLL });

    if (newEnabled) {
      await setupAlarms(); // restart keep-alive
      const tab = await getTeviTab();
      if (tab) {
        await ensureCS(tab.id);
        await runScan(tab.id);
      }
    }
  });

  // Listen for interceptor-captured API pattern
  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'API_SEND_PATTERN') {
      log('INFO', '[API] Pattern captured: ' + msg.method + ' ' + msg.url);
      storageSet({ apiSendPattern: { url: msg.url, method: msg.method, headers: msg.headers, bodyFields: msg.bodyFields } });
      sendResp({ ok: true });
      return true;
    }
  });

  log('INFO', 'SW v0.9 ready. apiSendPattern: ' + !!(st?.apiSendPattern));
}

init().catch(e => log('ERROR', 'Init failed: ' + e.message));
