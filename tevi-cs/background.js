/**
 * BACKGROUND.JS — Tevi CS Bot v0.9.1
 *
 * GOALS:
 * - Balas pesan looping setiap 4 pesan
 * - Awal wajib greeting, 3 pesan lainnya tergantung jawaban user
 * - Jangan balas membership dan yang sudah kirim foto (cooldown 6h)
 *
 * Architecture:
 * - Tab: scan conv list via content script (DOM)
 * - API: send messages via intercepted Tevi API (no tab needed)
 * - chrome.alarms: 20s idle polling
 */

const EXT = 'Tevi CS v0.9.1';
const LOG = 'http://localhost:3131';
const MY_SLUG = 'cutieval';

// ── Storage helpers ───────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function log(level, msg, data) {
  const payload = { source: 'BG', level, message: '[BG] ' + msg, ts: new Date().toISOString(), ...(data || {}) };
  try { await fetch(LOG + '/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); } catch {}
  if (level === 'ERROR') console.error('[BG]', msg, data || '');
}

async function sg(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
async function ss(obj) { return new Promise(r => chrome.storage.local.set(obj, r)); }

// ── Conv Meta ─────────────────────────────────────────────────────────

async function getMeta(slug) {
  const { convMeta } = await sg(['convMeta']) || {};
  return (convMeta || {})[slug.toLowerCase()] || null;
}

async function setMeta(slug, meta) {
  const { convMeta } = await sg(['convMeta']) || {};
  const key = slug.toLowerCase();
  convMeta[key] = { ...(convMeta[key] || {}), ...meta, updatedAt: Date.now() };
  await ss({ convMeta });
}

// ── Slot Decision ──────────────────────────────────────────────────────
// Slot: 1=greeting, 2/3/4=reply. After slot 4 → reset to greeting.
// "Awal wajib greeting" = slot 1 on first contact or after 4 replies.

async function decideSlot(slug) {
  const meta = await getMeta(slug);
  if (!meta) return { type: 'greeting', slot: 1 };
  if (meta.slot >= 4) return { type: 'greeting', slot: 1 };
  return { type: 'reply', slot: (meta.slot || 0) + 1 };
}

// ── Image Cooldown ─────────────────────────────────────────────────────

const IMG_COOLDOWN = 6 * 60 * 60 * 1000; // 6 hours

async function isImageCooldown(slug) {
  const { imageCooldownUsers } = await sg(['imageCooldownUsers']) || {};
  const ts = (imageCooldownUsers || {})[slug.toLowerCase()];
  if (!ts) return false;
  if (Date.now() - ts > IMG_COOLDOWN) return false;
  return true;
}

async function addImageCooldown(slug) {
  const { imageCooldownUsers } = await sg(['imageCooldownUsers']) || {};
  imageCooldownUsers[slug.toLowerCase()] = Date.now();
  await ss({ imageCooldownUsers });
}

// ── Tab helpers ────────────────────────────────────────────────────────

let _currentTabId = null;

async function getTeviTab() {
  const tabs = await new Promise(r => chrome.tabs.query({}, r));
  let tab = tabs.find(t => t.url && t.url.match(/tevi\.com\//));
  if (!tab) {
    tab = await new Promise(r => chrome.tabs.create({ url: 'https://tevi.com/messages', active: false }, r));
    await sleep(3000);
  }
  _currentTabId = tab.id;
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

// ── AI Reply ──────────────────────────────────────────────────────────

async function generateReply(slug, messages, slot) {
  const { aiKey } = (await sg(['tevi_cs_secrets']) || {}).tevi_cs_secrets || {};
  if (!aiKey) return buildFallback(messages, slot);

  const { persona } = (await sg(['tevi_cs_config']) || {}).tevi_cs_config || {};
  const ctx = messages.map((m, i) => `[${i + 1}]${m.hasImage ? ' [IMG] ' : ' '}${m.text}`).join('\n');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    temperature: 0.8,
    system: persona || 'Kamu Sukii, AI Assistant-nya Baby Val. Jawaban pendek, dingin, informatif. Jangan terlalu ramah.',
    messages: [{ role: 'user', content: `User @${slug}:\n${ctx}\n\nBalas sebagai Sukii (slot ${slot}/4):` }]
  });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
      body,
    });
    if (!res.ok) return buildFallback(messages, slot);
    const data = await res.json();
    let reply = (data.content?.[0]?.text || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    if (reply.length > 500) reply = reply.substring(0, 497) + '...';
    return reply || buildFallback(messages, slot);
  } catch (e) {
    log('ERROR', 'AI failed: ' + e.message);
    return buildFallback(messages, slot);
  }
}

function buildFallback(messages, slot) {
  const last = (messages[messages.length - 1]?.text || '').toLowerCase();
  if (last.match(/foto|video|konten|porn|sexy|bugil|xxx/)) return 'Konten untuk member.';
  if (last.match(/vcs|videocall|video call/i)) return 'VCS tersedia. babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/payment|transfer|bayar|order/i)) return 'babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/member|membership|join/i)) return 'tevi.com/@cutieval. Pilih membership.';
  if (last.match(/alamat|nomor hp|no hp|wa|whatsapp/i)) return 'Informasi pribadi tidak diberikan.';
  if (last.match(/ketemu|offline|bertemu/i)) return 'Cuma bisa VCS. Offline tidak tersedia.';
  if (last.match(/terima kasih|thanks|makasih/i)) return 'Sukii. Ada yang perlu ditanyakan?';
  if (last.match(/masker|topeng/i)) return 'Buka masker: tip 250rb ke ganknow.com/babyval/tip.';
  if (last.match(/beda|bedanya|durasi/i)) return 'Beda durasi aja. Squirt minimal 20 menit.';
  return 'Chat langsung dengan Baby Val: membership Tevi.';
}

// Greeting — dibaca dari config atau fallback default
async function getGreeting() {
  const { tevi_cs_config } = await sg(['tevi_cs_config']) || {};
  const tpl = tevi_cs_config?.persona?.greeting;
  return tpl || GREETING;
}

const GREETING = `Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi
Kalau mau VCS bisa bayar di babyval.com`;

// ── API Send (tabless) ────────────────────────────────────────────────

async function apiSend(recipientSlug, text) {
  const { apiSendPattern } = await sg(['apiSendPattern']) || {};
  if (!apiSendPattern) {
    log('ERROR', '[API] No pattern — send DM manually first to capture');
    return false;
  }

  log('INFO', '[API] Sending to @' + recipientSlug + ': ' + text.substring(0, 40) + '...');

  try {
    const bf = apiSendPattern.bodyFields || {};

    // Build body — preserve all original fields, replace message content
    const body = {};

    // Priority: use the field names that exist in the captured request
    const msgFieldNames = ['message', 'content', 'text', 'body', 'messageText', 'msg'];
    for (const fn of msgFieldNames) {
      if (bf[fn] !== undefined) { body[fn] = text; break; }
    }
    if (Object.keys(body).length === 0) body['message'] = text;

    // Add identifier fields
    const idFieldNames = ['recipient', 'recipientId', 'userId', 'conversationId', 'channelId', 'to', 'slug'];
    for (const fn of idFieldNames) {
      if (bf[fn] !== undefined) body[fn] = bf[fn];
    }
    // Ensure we have recipient
    if (!body.recipient && !body.recipientId) body.recipient = recipientSlug;

    // Add all other original fields
    for (const [k, v] of Object.entries(bf)) {
      if (!Object.keys(body).includes(k)) body[k] = v;
    }

    // Build headers
    const headers = { ...(apiSendPattern.headers || {}) };
    headers['Content-Type'] = 'application/json';
    // Restore Authorization if it was in captured headers
    if (apiSendPattern.headers?.Authorization) {
      headers['Authorization'] = apiSendPattern.headers.Authorization;
    }

    const res = await fetch(apiSendPattern.url, {
      method: apiSendPattern.method || 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
    });

    if (res.ok) {
      log('INFO', '[API] Sent OK to @' + recipientSlug);
      return true;
    } else {
      const txt = await res.text().catch(() => '');
      log('ERROR', '[API] Failed @' + recipientSlug + ' status=' + res.status + ' body=' + txt.substring(0, 100));
      return false;
    }
  } catch (e) {
    log('ERROR', '[API] Error @' + recipientSlug + ': ' + e.message);
    return false;
  }
}

// ── Navigate to DM page ───────────────────────────────────────────────

async function navigateToDM(tabId, slug) {
  const url = `https://tevi.com/@${slug}/messages`;
  try {
    await chrome.tabs.update(tabId, { url, active: true });
    await sleep(4000);
    await ensureCS(tabId);
    return true;
  } catch (e) {
    log('ERROR', '[NAV] DM navigate failed @' + slug + ': ' + e.message);
    return false;
  }
}

// ── Process One Conversation ─────────────────────────────────────────

async function processConv(tabId, slug) {
  log('INFO', '[PROC] Processing @' + slug);
  await setMeta(slug, { status: 'processing' });

  // Navigate to DM to read messages + check for images
  const navOk = await navigateToDM(tabId, slug);
  if (!navOk) {
    const prev = await getMeta(slug) || {};
    await setMeta(slug, { status: 'failed', navigateFailCount: (prev.navigateFailCount || 0) + 1 });
    return false;
  }

  // Read last 4 USER messages for context
  await sleep(1500);
  const msgsResp = await chrome.tabs.sendMessage(tabId, { type: 'GET_MSGS', count: 4 }).catch(() => null);
  const userMessages = msgsResp?.messages || [];
  log('INFO', '[PROC] Got ' + userMessages.length + ' user msgs for @' + slug);

  // Check last message for image
  const checkResp = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_DM' }).catch(() => ({}));
  if (checkResp?.hasImage) {
    await addImageCooldown(slug);
    log('INFO', '[PROC] Image from @' + slug + ' — cooldown 6h');
  }

  // Decide slot: greeting (1) or reply (2/3/4)
  const { type, slot } = await decideSlot(slug);
  log('INFO', '[PROC] @' + slug + ' → slot=' + slot + ' type=' + type);

  // Build reply
  let reply;
  if (type === 'greeting') {
    reply = await getGreeting();
  } else {
    reply = await generateReply(slug, userMessages, slot);
  }

  // Send via API (tabless)
  const sent = await apiSend(slug, reply);
  log('INFO', '[PROC] @' + slug + ' sent=' + sent + ' slot=' + slot);

  // Update meta
  await setMeta(slug, {
    status: sent ? 'done' : 'failed',
    slot: sent ? slot : null,
    lastReplyAt: sent ? Date.now() : null,
    failedAt: sent ? null : Date.now(),
  });

  return sent;
}

// ── Scan ─────────────────────────────────────────────────────────────

async function runScan(tabId) {
  const { botEnabled } = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (!botEnabled) return;

  // Navigate to messages page
  try { await chrome.tabs.update(tabId, { url: 'https://tevi.com/messages', active: true }); } catch {}
  await sleep(3000);
  await ensureCS(tabId);
  await sleep(2000);

  // Activate intercept (capture API calls if user sends manually)
  try { await chrome.tabs.sendMessage(tabId, { type: 'INTERCEPT_SEND' }); } catch {}

  // Scan convs
  const scanResp = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_CONVS' }).catch(() => null);
  if (!scanResp?.ok) {
    log('ERROR', '[SCAN] Scan failed');
    return;
  }

  const raw = scanResp.convs || [];
  log('INFO', '[SCAN] ' + raw.length + ' unreplied convs');

  // Filter: skip self, skip processing, skip too many fails, skip image cooldown
  const filtered = [];
  for (const conv of raw) {
    const slug = conv.slug;
    if (!slug || slug.toLowerCase() === MY_SLUG) continue;
    const meta = await getMeta(slug);
    if (meta?.status === 'processing') continue;
    if ((meta?.navigateFailCount || 0) >= 3) continue;
    if (await isImageCooldown(slug)) {
      log('INFO', '[SCAN] Skip @' + slug + ' (image cooldown)');
      continue;
    }
    filtered.push(conv);
  }

  log('INFO', '[SCAN] ' + filtered.length + ' after filter');

  if (!filtered.length) {
    await syncOverlay({ botEnabled: true, pollTime: 20 });
    return;
  }

  // Process first conv
  const sent = await processConv(tabId, filtered[0].slug);

  // Save last result
  const st = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  st.lastResult = { conv: filtered[0].slug, ok: sent, ts: Date.now() };
  st.lastScanAt = Date.now();
  await ss({ tevi_cs_state: st });

  await syncOverlay({ botEnabled: true, pollTime: 20 });
  log('INFO', '[SCAN] Done: @' + filtered[0].slug + ' sent=' + sent);
}

// ── Overlay Sync ──────────────────────────────────────────────────────

async function syncOverlay(state) {
  await ss({ tevi_cs_overlay_state: { ...state, updatedAt: Date.now() } });
}

// ── Alarms ───────────────────────────────────────────────────────────

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
  if (alarm.name === 'tevi_cs_keepalive') return; // Just keep SW alive
  if (alarm.name !== 'tevi_cs_poll') return;

  const { botEnabled } = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (!botEnabled) return;

  let tab = await getTeviTab();
  if (!tab) return;

  const ok = await ensureCS(tab.id);
  if (!ok) {
    tab = await getTeviTab();
    if (tab) await ensureCS(tab.id);
  }

  await runScan(tab?.id);
});

// ── Tab Events — scan when user switches to Tevi tab ──────────────────

let _lastTabId = null;

chrome.tabs.onActivated.addListener(async activeInfo => {
  const { botEnabled } = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (!botEnabled) return;

  // Check if it's a tevi tab
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || !tab.url.match(/tevi\.com\//)) return;
  } catch { return; }

  // Only scan if tab changed
  if (activeInfo.tabId === _lastTabId) return;
  _lastTabId = activeInfo.tabId;
  _currentTabId = activeInfo.tabId;

  // Quick scan on tab switch (less aggressive than alarm)
  await ensureCS(activeInfo.tabId);
  await runScan(activeInfo.tabId);
});

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  log('INFO', 'SW v0.9.1 starting...');

  // Reset stale state
  const st = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  st.queueBusy = false;
  await ss({ tevi_cs_state: st });

  // Clear old conv meta (48h+)
  const { convMeta } = await sg(['convMeta']) || {};
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const filtered = {};
  let changed = false;
  for (const [k, v] of Object.entries(convMeta || {})) {
    if (v.updatedAt > cutoff) filtered[k] = v;
    else changed = true;
  }
  if (changed) await ss({ convMeta: filtered });

  await setupAlarms();
  await syncOverlay({ botEnabled: false, pollTime: POLL });

  // ── Message listeners ──────────────────────────────────────────────

  chrome.storage.onChanged.addListener(async (changes) => {
    // Toggle from popup/overlay
    if (changes.tevi_cs_toggle_req) {
      const req = changes.tevi_cs_toggle_req.newValue;
      if (!req) return;

      const currentSt = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
      const newEnabled = req.enabled;

      log('INFO', '[TOGGLE] ' + (currentSt.botEnabled ? 'ON→' : 'OFF→') + (newEnabled ? 'ON' : 'OFF'));

      await ss({
        tevi_cs_toggle_req: null,
        tevi_cs_toggle_ack: { enabled: newEnabled, ts: Date.now() },
        tevi_cs_state: { ...currentSt, botEnabled: newEnabled },
      });

      await syncOverlay({ botEnabled: newEnabled, pollTime: POLL });

      if (newEnabled) {
        await setupAlarms();
        const tab = await getTeviTab();
        if (tab) {
          await ensureCS(tab.id);
          // Activate intercept so user can capture API pattern by sending manually
          try { await chrome.tabs.sendMessage(tab.id, { type: 'INTERCEPT_SEND' }); } catch {}
          await runScan(tab.id);
        }
      }
    }
  });

  // Receive captured API pattern from content script
  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'API_SEND_PATTERN') {
      log('INFO', '[API] Pattern captured: ' + msg.method + ' ' + msg.url);
      ss({ apiSendPattern: { url: msg.url, method: msg.method, headers: msg.headers, bodyFields: msg.bodyFields, capturedAt: msg.capturedAt } });
      sendResp({ ok: true });
      return true;
    }
    // Popup bridge
    if (msg.type === 'GET_CONFIG') {
      sg(['tevi_cs_config', 'tevi_cs_secrets']).then(data => {
        sendResp({ config: data.tevi_cs_config, hasAI: !!(data.tevi_cs_secrets?.aiKey) });
      });
      return true;
    }
    if (msg.type === 'SAVE_CONFIG') {
      ss({ tevi_cs_config: msg.config });
      sendResp({ ok: true });
      return true;
    }
    if (msg.type === 'SET_SECRETS') {
      ss({ tevi_cs_secrets: msg.secrets });
      sendResp({ ok: true });
      return true;
    }
    if (msg.type === 'GET_STATUS') {
      const st = (sg(['tevi_cs_state', 'tevi_cs_overlay_state']).then(data => {
        const s = (data.tevi_cs_state || {});
        const o = (data.tevi_cs_overlay_state || {});
        sendResp({
          enabled: s.botEnabled || false,
          lastResult: s.lastResult || null,
          lastPoll: s.lastScanAt || null,
        });
      }));
      return true;
    }
    if (msg.type === 'RESET_STATE') {
      ss({ convMeta: {}, imageCooldownUsers: {}, tevi_cs_state: { queueBusy: false } });
      sendResp({ ok: true });
      return true;
    }
  });

  // Resume if was enabled
  const wasSt = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (wasSt.botEnabled) {
    const tab = await getTeviTab();
    if (tab) await runScan(tab.id);
  }

  log('INFO', 'SW v0.9.1 ready');
}

init().catch(e => log('ERROR', 'Init failed: ' + e.message));
