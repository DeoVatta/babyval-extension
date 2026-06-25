/**
 * BACKGROUND.JS — Tevi CS Bot v0.9.11
 *
 * GOALS:
 * - Balas pesan looping setiap 4 pesan
 * - Awal wajib greeting, 3 pesan lainnya tergantung jawaban user
 * - Jangan balas membership dan yang sudah kirim foto (cooldown 6h)
 * - Semua chat logged ke Supabase via edge function
 *
 * Architecture:
 * - Tab: scan conv list via content script (DOM)
 * - Supabase Edge Function: handles AI calls + all logging
 * - chrome.alarms: 20s idle polling
 */

const EXT = 'Tevi CS v0.9.11';
const LOG = 'http://localhost:3131';
const MY_SLUG = 'cutieval';
const SUPABASE_URL = 'https://qjemyvydivekolywleji.supabase.co';
const EDGE_FUNC = SUPABASE_URL + '/functions/v1/cs-bot-logger';
const AUTO_PROBE_FUNC = SUPABASE_URL + '/functions/v1/api-auto-probe';

// ── Storage helpers ───────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function log(level, msg, data) {
  const payload = { source: 'BG', level, message: '[BG] ' + msg, ts: new Date().toISOString(), ...(data || {}) };
  try { await fetch(LOG + '/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); } catch {}
  if (level === 'ERROR') console.error('[BG]', msg, data || '');
}

async function sg(keys) {
  try { const r = await new Promise(resolve => chrome.storage.local.get(keys, resolve)); return r || {}; }
  catch { return {}; }
}
async function ss(obj) { return new Promise(r => chrome.storage.local.set(obj, r)); }

// ── Conv Meta ─────────────────────────────────────────────────────────

async function getMeta(slug) {
  const data = await sg(['convMeta']);
  const convMeta = data.convMeta || {};
  return convMeta[slug.toLowerCase()] || null;
}

async function setMeta(slug, meta) {
  const data = await sg(['convMeta']);
  const convMeta = data.convMeta || {};
  const key = slug.toLowerCase();
  convMeta[key] = { ...(convMeta[key] || {}), ...meta, updatedAt: Date.now() };
  await ss({ convMeta });
}

// ── Slot Decision ──────────────────────────────────────────────────────
// Slot: 1=greeting, 2/3/4=reply. After slot 4 → reset to greeting.

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

async function getTeviTab() {
  const tabs = await new Promise(r => chrome.tabs.query({}, r));
  let tab = tabs.find(t => t.url && t.url.match(/tevi\.com\//));
  if (!tab) {
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

// ── Generate Reply via Supabase Edge Function ──────────────────────────
// Edge function handles: AI call (Olagon) + Supabase logging + user lookup

async function generateReply(slug, userMessages, slot, replyType) {
  const stored = await sg(['tevi_cs_secrets']);
  const secrets = stored.tevi_cs_secrets || {};
  const aiKey = secrets.aiKey;
  if (!aiKey) {
    log('ERROR', '[EDGE] No AI key — set AI key in popup Keys tab');
    return buildFallback(userMessages, slot, replyType);
  }

  try {
    const res = await fetch(EDGE_FUNC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`,
      },
      body: JSON.stringify({
        username: slug,
        userMessages,
        slot,
        replyType,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      log('ERROR', '[EDGE] Status=' + res.status + ' body=' + txt.substring(0, 100));
      return buildFallback(userMessages, slot, replyType);
    }

    const data = await res.json();
    log('INFO', '[EDGE] Reply for @' + slug + ': ' + (data.reply || '').substring(0, 40) + '...');
    return data.reply || buildFallback(userMessages, slot, replyType);
  } catch (e) {
    log('ERROR', '[EDGE] Failed: ' + e.message);
    return buildFallback(userMessages, slot, replyType);
  }
}

// Fallback — keyword-based, no AI (when edge function fails or has no key)
function buildFallback(messages, slot, replyType) {
  // Greeting: use exact template (no AI generation)
  if (replyType === 'greeting') {
    return `Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi

Kalau mau VCS bisa bayar di babyval.com`;
  }
  const last = (messages[messages.length - 1]?.text || '').toLowerCase();
  if (last.match(/foto|video|konten|porn|sexy|bugil|xxx|ngentot|coli/i)) return 'Konten untuk member.';
  if (last.match(/vcs|videocall|video call|private room/i)) return 'VCS via Private Room Tevi. babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/payment|transfer|bayar|order|bayarnya|dana|ovo|i\/o|invest/i)) return 'Payment via babyval.com. Dana/OVO/transfer. babyval.com → VCS → Bayar.';
  if (last.match(/member|membership|join|benefit/i)) return 'Benefit: masuk live gratis, konten terbuka, chat kapanpun. tevi.com/@cutieval';
  if (last.match(/alamat|nomor hp|no hp|wa|whatsapp|line|telegram/i)) return 'Informasi pribadi tidak diberikan.';
  if (last.match(/ketemu|offline|bertemu|ngumpul|jumpa|bo/i)) return 'Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?';
  if (last.match(/terima kasih|thanks|makasih|thx|tq/i)) return 'Sukii. Ada yang perlu ditanyakan?';
  if (last.match(/masker|topeng/i)) return 'Boleh open masker. Tambah 350k.';
  if (last.match(/full open|buka semua/i)) return 'Buka semua kecuali masker. Buka masker tambah 350k.';
  if (last.match(/open masker/i)) return 'Boleh open masker. Tambah 350k.';
  if (last.match(/beda|bedanya|durasi|7 menit|10 menit/i)) return 'Beda durasi aja. Squirt minimal 20 menit.';
  if (last.match(/tip|donasi|sendiri/i)) return 'Tip: ganknow.com/babyval/tip';
  if (last.match(/private room/i)) return 'Private Room Tevi. Ber-2 aja. babyval.com → VCS.';
  if (last.match(/bot|sukii|siapa kamu|apa kamu/i)) return 'Sukii. Informan Baby Val.';
  if (last.match(/cara (membership|member|join)/i)) return 'Buka profile Baby Val → Join Membership';
  if (last.match(/cara vcs|cara (bayar|payment)/i)) return 'babyval.com → Video Call → Durasi → Bayar';
  if (last.match(/ada wa|whatsapp|wa/i)) return 'Kalau mau chat sama Baby Val, membership dulu ya.';
  if (last.match(/chat tidak pantas/i)) return 'Kalau mau chat sama Baby Val, membership dulu ya.';
  return 'Chat langsung dengan Baby Val: membership Tevi.';
}

// ── API Send (tabless via intercepted Tevi API pattern) ───────────────

async function apiSend(recipientSlug, text) {
  const stored = await sg(['apiSendPattern']);
  const apiSendPattern = stored.apiSendPattern;
  if (!apiSendPattern) {
    log('ERROR', '[API] No pattern — send DM manually first to capture');
    return false;
  }

  log('INFO', '[API] Sending to @' + recipientSlug + ': ' + text.substring(0, 40) + '...');

  try {
    const bf = apiSendPattern.bodyFields || {};
    const body = {};

    const msgFieldNames = ['message', 'content', 'text', 'body', 'messageText', 'msg'];
    for (const fn of msgFieldNames) {
      if (bf[fn] !== undefined) { body[fn] = text; break; }
    }
    if (Object.keys(body).length === 0) body['message'] = text;

    const idFieldNames = ['recipient', 'recipientId', 'userId', 'conversationId', 'channelId', 'to', 'slug'];
    for (const fn of idFieldNames) {
      if (bf[fn] !== undefined) body[fn] = bf[fn];
    }
    if (!body.recipient && !body.recipientId) body.recipient = recipientSlug;

    for (const [k, v] of Object.entries(bf)) {
      if (!Object.keys(body).includes(k)) body[k] = v;
    }

    const headers = { ...(apiSendPattern.headers || {}) };
    headers['Content-Type'] = 'application/json';
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

// ── Tevi Auth & API Host Discovery ───────────────────────────────────

async function getStoredTeviAuth() {
  const stored = await sg(['tevi_api_catalog', 'apiSendPattern', 'tevi_cs_secrets']);
  // Try auth from intercepted send pattern
  const pattern = stored.apiSendPattern || {};
  const authHeader = pattern.headers?.Authorization || '';
  // Try token from tevi_api_catalog
  const catalog = stored.tevi_api_catalog || {};
  const tokens = Object.values(catalog).flat?.() || [];
  // Try AI key as fallback token
  const secrets = stored.tevi_cs_secrets || {};
  return {
    authToken: authHeader.replace('Bearer ', '') || secrets.aiKey || null,
    apiHost: pattern.url ? new URL(pattern.url).origin : null,
  };
}

async function autoProbe() {
  log('INFO', '[PROBE] Starting API auto-probe...');
  try {
    const { authToken, apiHost } = await getStoredTeviAuth();
    log('INFO', '[PROBE] auth=' + (authToken ? authToken.substring(0,10)+'...' : 'NONE') + ' host=' + (apiHost || 'none'));

    // Get AI key for auth
    const stored = await sg(['tevi_cs_secrets']);
    const secrets = stored.tevi_cs_secrets || {};
    const aiKey = secrets.aiKey || authToken || '';

    const res = await fetch(AUTO_PROBE_FUNC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiKey}`,
      },
      body: JSON.stringify({ api_host: apiHost, access_token: authToken }),
    });

    const text = await res.text().catch(() => '');
    log('INFO', '[PROBE] Status=' + res.status + ' body=' + text.substring(0, 300));
    if (res.ok) {
      try { const d = JSON.parse(text); log('INFO', '[PROBE] Found ' + (d.found_count||0) + ' endpoints'); } catch {}
    }
  } catch (e) {
    log('ERROR', '[PROBE] Error: ' + e.message);
  }
}

// ── Navigate to DM page ────────────────────────────────────────────────

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

// ── Process One Conversation ───────────────────────────────────────────

async function processConv(tabId, slug) {
  log('INFO', '[PROC] Processing @' + slug);
  await setMeta(slug, { status: 'processing' });

  const navOk = await navigateToDM(tabId, slug);
  if (!navOk) {
    const prev = await getMeta(slug) || {};
    await setMeta(slug, { status: 'failed', navigateFailCount: (prev.navigateFailCount || 0) + 1 });
    return false;
  }

  await sleep(1500);
  const msgsResp = await chrome.tabs.sendMessage(tabId, { type: 'GET_MSGS', count: 4 }).catch(() => null);
  const userMessages = msgsResp?.messages || [];
  log('INFO', '[PROC] Got ' + userMessages.length + ' user msgs for @' + slug);

  const checkResp = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_DM' }).catch(() => ({}));
  if (checkResp?.hasImage) {
    await addImageCooldown(slug);
    log('INFO', '[PROC] Image from @' + slug + ' — cooldown 6h');
  }

  const { type, slot } = await decideSlot(slug);
  log('INFO', '[PROC] @' + slug + ' → slot=' + slot + ' type=' + type);

  // Generate reply via Supabase Edge Function (handles AI + logging)
  const reply = await generateReply(slug, userMessages, slot, type);
  log('INFO', '[PROC] @' + slug + ' reply: ' + reply.substring(0, 60));

  const sent = await apiSend(slug, reply);
  log('INFO', '[PROC] @' + slug + ' sent=' + sent + ' slot=' + slot);

  await setMeta(slug, {
    status: sent ? 'done' : 'failed',
    slot: sent ? slot : null,
    lastReplyAt: sent ? Date.now() : null,
    failedAt: sent ? null : Date.now(),
    lastSlot: slot, // always record slot attempt
  });

  return sent;
}

// ── Scan ───────────────────────────────────────────────────────────────

let _scanInProgress = false;

async function runScan(tabId) {
  if (_scanInProgress) { log('INFO', '[SCAN] Skipped — scan in progress'); return; }
  _scanInProgress = true;
  try {
    const { botEnabled } = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
    if (!botEnabled) { _scanInProgress = false; return; }

    try { await chrome.tabs.update(tabId, { url: 'https://tevi.com/messages', active: true }); } catch {}
    await sleep(3000);
    await ensureCS(tabId);
    await sleep(2000);

    try { await chrome.tabs.sendMessage(tabId, { type: 'INTERCEPT_SEND' }); } catch {}

    const scanResp = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_CONVS' }).catch(() => null);
    if (!scanResp?.ok) {
      log('ERROR', '[SCAN] Scan failed');
      _scanInProgress = false;
      return;
    }

    const raw = scanResp.convs || [];
    log('INFO', '[SCAN] ' + raw.length + ' unreplied convs');

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
      _scanInProgress = false;
      await syncOverlay({ botEnabled: true, pollTime: 20 });
      return;
    }

    const sent = await processConv(tabId, filtered[0].slug);

    const st = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
    st.lastResult = { conv: filtered[0].slug, ok: sent, ts: Date.now() };
    st.lastScanAt = Date.now();
    await ss({ tevi_cs_state: st });

    await syncOverlay({ botEnabled: true, pollTime: 20 });
    log('INFO', '[SCAN] Done: @' + filtered[0].slug + ' sent=' + sent);
  } catch (e) {
    log('ERROR', '[SCAN] Error: ' + e.message);
  } finally {
    _scanInProgress = false;
  }
}

// ── Overlay Sync ──────────────────────────────────────────────────────

async function syncOverlay(state) {
  await ss({ tevi_cs_overlay_state: { ...state, updatedAt: Date.now() } });
}

// ── Alarms ─────────────────────────────────────────────────────────────

const POLL = 20;

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
  if (alarm.name === 'tevi_cs_keepalive') return;
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

// ── Tab Events ─────────────────────────────────────────────────────────

let _tabLastId = null;

chrome.tabs.onActivated.addListener(async activeInfo => {
  const { botEnabled } = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (!botEnabled) return;

  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.url || !tab.url.match(/tevi\.com\//)) return;
  } catch { return; }

  if (activeInfo.tabId === _tabLastId) return;
  _tabLastId = activeInfo.tabId;

  await ensureCS(activeInfo.tabId);
  await runScan(activeInfo.tabId);
});

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  log('INFO', 'SW v0.9.11 starting...');

  const st = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  st.queueBusy = false;
  await ss({ tevi_cs_state: st });

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
  // Auto-probe Tevi API endpoints at startup (non-blocking)
  autoProbe().catch(() => {});
  await syncOverlay({ botEnabled: false, pollTime: POLL });

  chrome.storage.onChanged.addListener(async (changes) => {
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
          try { await chrome.tabs.sendMessage(tab.id, { type: 'INTERCEPT_SEND' }); } catch {}
          await runScan(tab.id);
        }
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'API_SEND_PATTERN') {
      log('INFO', '[API] Pattern captured: ' + msg.method + ' ' + msg.url);
      ss({ apiSendPattern: { url: msg.url, method: msg.method, headers: msg.headers, bodyFields: msg.bodyFields, capturedAt: msg.capturedAt } });
      sendResp({ ok: true });
      return true;
    }
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
      Promise.all([sg(['tevi_cs_state', 'tevi_cs_overlay_state', 'tevi_cs_secrets'])]).then(([data]) => {
        const s = (data.tevi_cs_state || {});
        const secrets = (data.tevi_cs_secrets || {});
        sendResp({
          enabled: s.botEnabled || false,
          lastResult: s.lastResult || null,
          lastPoll: s.lastScanAt || null,
          hasToken: !!secrets.aiKey,
        });
      });
      return true;
    }
    if (msg.type === 'RESET_STATE') {
      ss({ convMeta: {}, imageCooldownUsers: {}, tevi_cs_state: { queueBusy: false } });
      sendResp({ ok: true });
      return true;
    }
    if (msg.type === 'GET_API_CATALOG') {
      sg(['tevi_api_catalog']).then(data => {
        sendResp({ catalog: data.tevi_api_catalog || null });
      });
      return true;
    }
  });

  const wasSt = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (wasSt.botEnabled) {
    const tab = await getTeviTab();
    if (tab) await runScan(tab.id);
  }

  log('INFO', 'SW v0.9.11 ready - API auto-probe + Edge Function active');
}

init().catch(e => log('ERROR', 'Init failed: ' + e.message));
