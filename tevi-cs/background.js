/**
 * BACKGROUND.JS — Tevi CS Bot v0.9.12
 *
 * Architecture: DIRECT API (no DOM, no tab navigation)
 * - Uses wapi.flowstreamx.com Messenger v2 API (discovered via babyval-autopilot)
 * - Auth: Firebase anonymous → wapi token exchange
 * - Conv detection: GET /messenger/v2/rpc/get_recent_conversations?filter=UNREAD
 * - Send: POST /messenger/v2/message/
 * - HMAC verify signature: HMAC-SHA256(key=PRDKqnSNCKrMDF9hAt0PSJ6, data=pathname+ts)
 *
 * Supabase Edge Function: handles AI (Olagon) + all logging
 */

const EXT = 'Tevi CS v0.9.12';
const LOG = 'http://localhost:3131';
const MY_SLUG = 'cutieval';
const MY_UID = '392388705'; // cutieval Tevi UID
const SUPABASE_URL = 'https://qjemyvydivekolywleji.supabase.co';
const EDGE_FUNC = SUPABASE_URL + '/functions/v1/cs-bot-logger';
const WAPI = 'https://wapi.flowstreamx.com';
const FIREBASE_AUTH = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';
const FIREBASE_KEY = 'AIzaSyAtd4p5rj5Q8GRbpwW_KAc6oD-XrPj53uI';
const DEVICE_ID = 'tevi-cs-bot-' + Date.now();
const WAPI_SIGN_KEY = 'PRDKqnSNCKrMDF9hAt0PSJ6';

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

// ── HMAC Verify Signature ─────────────────────────────────────────────

// ── HMAC Verify Signature (Web Crypto API — works in Service Worker) ────────

async function computeVerifyAsync(url) {
  try {
    const pathname = new URL(url).pathname;
    const timestamp = Math.floor(Date.now() / 1000);
    const data = pathname + timestamp;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(WAPI_SIGN_KEY);
    const msgData = encoder.encode(data);
    const key = await crypto.subtle.importKey(
      'raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, msgData);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return { timestamp, verify: timestamp + '-' + b64 };
  } catch (e) { return null; }
}

// ── HTTP Helpers ──────────────────────────────────────────────────────

// ── HTTP Helper (standard fetch — works in Service Worker) ───────────────────

async function wapiFetch(method, path, body, token) {
  const baseUrl = path.startsWith('http') ? path : WAPI + path;
  const url = new URL(baseUrl);
  const verifyData = await computeVerifyAsync(baseUrl);
  if (verifyData && !url.searchParams.has('verify')) url.searchParams.set('verify', verifyData.verify);

  const opts = {
    method,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Origin': 'https://tevi.com',
      'Referer': 'https://tevi.com/',
    }
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(url.toString(), opts);
  let data;
  const text = await res.text().catch(() => '');
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function firebaseFetch(method, path, body) {
  const url = FIREBASE_AUTH + path;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  const res = await fetch(url, opts);
  let data;
  const text = await res.text().catch(() => '');
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// ── Auth State ────────────────────────────────────────────────────────

let _wapiToken = null;
let _wapiTokenExpiry = 0;
let _refreshToken = null;
let _firebaseIdToken = null;

async function getWapiToken() {
  if (_wapiToken && Date.now() < _wapiTokenExpiry - 60000) return _wapiToken;

  // Try restore from storage
  const stored = await sg(['tevi_cs_auth']);
  const auth = stored.tevi_cs_auth || {};
  if (auth.wapiToken && auth.expiry > Date.now() + 60000) {
    _wapiToken = auth.wapiToken;
    _wapiTokenExpiry = auth.expiry;
    _refreshToken = auth.refreshToken;
    _firebaseIdToken = auth.firebaseIdToken;
    log('INFO', '[AUTH] Restored token from storage (expires in ' + Math.round((_wapiTokenExpiry - Date.now())/60000) + 'm)');
    return _wapiToken;
  }

  // Try refresh first
  if (_refreshToken && _firebaseIdToken) {
    try {
      log('INFO', '[AUTH] Refreshing tokens...');
      const refreshRes = await firebaseFetch('POST',
        `/token?key=${FIREBASE_KEY}`,
        { grant_type: 'refresh_token', refresh_token: _refreshToken }
      );
      if (refreshRes.status === 200 && refreshRes.data.id_token) {
        _firebaseIdToken = refreshRes.data.id_token;
        const wapiRes = await wapiFetch('POST', '/auth/v1/token/', {
          access_token: _firebaseIdToken,
          id_token: _firebaseIdToken,
          refresh_token: _refreshToken,
          device_id: DEVICE_ID,
          device_type: 'browser',
          os: 'Windows',
          device_name: 'Chrome',
        });
        if (wapiRes.data?.data?.access_token) {
          _wapiToken = wapiRes.data.data.access_token;
          const exp = wapiRes.data.data.expires_in || 86400;
          _wapiTokenExpiry = Date.now() + exp * 1000;
          _refreshToken = wapiRes.data.data.refresh_token || _refreshToken;
          await ss({ tevi_cs_auth: { wapiToken: _wapiToken, expiry: _wapiTokenExpiry, refreshToken: _refreshToken, firebaseIdToken: _firebaseIdToken } });
          log('INFO', '[AUTH] Token refreshed OK');
          return _wapiToken;
        }
      }
    } catch (e) { log('WARN', '[AUTH] Refresh failed: ' + e.message); }
  }

  // Fresh anonymous login
  log('INFO', '[AUTH] Starting fresh anonymous login...');
  try {
    const anonRes = await firebaseFetch('POST',
      `/signupNewUser?key=${FIREBASE_KEY}`,
      { returnSecureToken: true }
    );
    if (anonRes.status !== 200) throw new Error('Firebase signup failed: ' + JSON.stringify(anonRes.data));

    _firebaseIdToken = anonRes.data.idToken;
    const localId = anonRes.data.localId;
    log('INFO', '[AUTH] Firebase anonymous OK, uid=' + localId);

    const wapiRes = await wapiFetch('POST', '/auth/v1/token/', {
      access_token: _firebaseIdToken,
      device_id: DEVICE_ID,
      device_type: 'browser',
      os: 'Windows',
      device_name: 'Chrome',
    });

    if (!wapiRes.data?.data?.access_token) throw new Error('wapi token exchange failed');
    _wapiToken = wapiRes.data.data.access_token;
    const exp = wapiRes.data.data.expires_in || 86400;
    _wapiTokenExpiry = Date.now() + exp * 1000;
    _refreshToken = wapiRes.data.data.refresh_token;
    await ss({ tevi_cs_auth: { wapiToken: _wapiToken, expiry: _wapiTokenExpiry, refreshToken: _refreshToken, firebaseIdToken: _firebaseIdToken } });
    log('INFO', '[AUTH] Got wapi token OK (expires in ' + Math.round(exp/60) + 'm)');
    return _wapiToken;
  } catch (e) {
    log('ERROR', '[AUTH] Fresh login failed: ' + e.message);
    return null;
  }
}

// ── Messenger API ─────────────────────────────────────────────────────

/**
 * Get conversations — returns array from /messenger/v2/rpc/get_recent_conversations
 */
async function apiGetConversations(filter = 'UNREAD', limit = 20) {
  const token = await getWapiToken();
  if (!token) return null;
  try {
    const res = await wapiFetch('GET',
      `/messenger/v2/rpc/get_recent_conversations?limit=${limit}&filter=${filter}`,
      null, token
    );
    if (res.status === 200 && res.data?.data?.results) {
      return res.data.data.results;
    }
    log('ERROR', '[MSG] getConvs status=' + res.status);
    return null;
  } catch (e) {
    log('ERROR', '[MSG] getConvs error: ' + e.message);
    return null;
  }
}

/**
 * Get conversation detail + messages
 */
async function apiGetConversation(convId) {
  const token = await getWapiToken();
  if (!token) return null;
  try {
    const res = await wapiFetch('GET',
      `/messenger/v2/conversation/${convId}/`,
      null, token
    );
    return res.status === 200 ? res.data : null;
  } catch (e) {
    log('ERROR', '[MSG] getConv error: ' + e.message);
    return null;
  }
}

/**
 * Mark conversation as read
 */
async function apiMarkRead(convId) {
  const token = await getWapiToken();
  if (!token) return false;
  try {
    const res = await wapiFetch('POST',
      `/messenger/v2/conversation/${convId}/read/`,
      {}, token
    );
    return res.status === 200 || res.status === 204;
  } catch (e) {
    return false;
  }
}

/**
 * Send message via Messenger API v2
 */
async function apiSendMessage(convId, text) {
  const token = await getWapiToken();
  if (!token) return false;
  try {
    const res = await wapiFetch('POST', '/messenger/v2/message/', {
      conversation_id: convId,
      type: 'TEXT',
      parser: 'PLAIN',
      text: text,
    }, token);
    if (res.status === 200 || res.status === 201) {
      log('INFO', '[MSG] Sent OK conv=' + convId.substring(0, 8) + '...');
      return true;
    }
    log('ERROR', '[MSG] Send failed status=' + res.status + ' body=' + JSON.stringify(res.data).substring(0, 100));
    return false;
  } catch (e) {
    log('ERROR', '[MSG] Send error: ' + e.message);
    return false;
  }
}

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

async function decideSlot(slug) {
  const meta = await getMeta(slug);
  if (!meta) return { type: 'greeting', slot: 1 };
  if (meta.slot >= 4) return { type: 'greeting', slot: 1 };
  return { type: 'reply', slot: (meta.slot || 0) + 1 };
}

// ── Image Cooldown ─────────────────────────────────────────────────────

const IMG_COOLDOWN = 6 * 60 * 60 * 1000;

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

// ── Generate Reply via Supabase Edge Function ──────────────────────────

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
      body: JSON.stringify({ username: slug, userMessages, slot, replyType }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      log('ERROR', '[EDGE] Status=' + res.status + ' body=' + txt.substring(0, 100));
      return buildFallback(userMessages, slot, replyType);
    }

    const data = await res.json();
    log('INFO', '[EDGE] Reply @' + slug + ': ' + (data.reply || '').substring(0, 40) + '...');
    return data.reply || buildFallback(userMessages, slot, replyType);
  } catch (e) {
    log('ERROR', '[EDGE] Failed: ' + e.message);
    return buildFallback(userMessages, slot, replyType);
  }
}

function buildFallback(messages, slot, replyType) {
  if (replyType === 'greeting') {
    return `Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi

Kalau mau VCS bisa bayar di babyval.com`;
  }
  const last = (messages[messages.length - 1]?.text || '').toLowerCase();
  if (last.match(/foto|video|konten|porn|sexy|bugil|xxx|ngentot|coli/i)) return 'Konten untuk member.';
  if (last.match(/vcs|videocall|video call|private room/i)) return 'VCS via Private Room Tevi. babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/payment|transfer|bayar|order|bayarnya|dana|ovo/i)) return 'Payment via babyval.com. Dana/OVO/transfer. babyval.com → VCS → Bayar.';
  if (last.match(/member|membership|join|benefit/i)) return 'Benefit: masuk live gratis, konten terbuka, chat kapanpun. tevi.com/@cutieval';
  if (last.match(/alamat|nomor hp|no hp|wa|whatsapp|line|telegram/i)) return 'Informasi pribadi tidak diberikan.';
  if (last.match(/ketemu|offline|bertemu|ngumpul|jumpa|bo/i)) return 'Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?';
  if (last.match(/terima kasih|thanks|makasih|thx|tq/i)) return 'Sukii. Ada yang perlu ditanyakan?';
  if (last.match(/masker|topeng/i)) return 'Boleh open masker. Tambah 350k.';
  if (last.match(/full open|buka semua/i)) return 'Buka semua kecuali masker. Buka masker tambah 350k.';
  if (last.match(/tip|donasi|ganknow/i)) return 'Tip: ganknow.com/babyval/tip';
  if (last.match(/bot|sukii|siapa kamu|apa kamu/i)) return 'Sukii. Informan Baby Val.';
  if (last.match(/cara (membership|member|join)/i)) return 'Buka profile Baby Val → Join Membership';
  if (last.match(/cara vcs|cara (bayar|payment)/i)) return 'babyval.com → Video Call → Durasi → Bayar';
  return 'Chat langsung dengan Baby Val: membership Tevi.';
}

// ── Process One Conversation ───────────────────────────────────────────

async function processConv(conv) {
  const convId = conv.id;
  const slug = conv.channel_slug || conv.recipient?.channel_slug || 'unknown';
  const isSubscriber = conv.recipient?.is_my_subscriber || false;

  if (slug.toLowerCase() === MY_SLUG) return false;
  if (isSubscriber) {
    log('INFO', '[PROC] Skip @' + slug + ' (is my subscriber)');
    return false;
  }

  log('INFO', '[PROC] Processing conv=' + convId.substring(0, 8) + ' @' + slug + ' (unread=' + (conv.stats?.unread_messages || 0) + ')');

  const meta = await getMeta(slug);
  if (meta?.status === 'processing') return false;
  if ((meta?.navigateFailCount || 0) >= 3) return false;
  if (await isImageCooldown(slug)) {
    log('INFO', '[PROC] Skip @' + slug + ' (image cooldown)');
    return false;
  }

  await setMeta(slug, { status: 'processing', convId });

  // Get full conversation with messages
  const fullConv = await apiGetConversation(convId);
  if (!fullConv || !fullConv.data) {
    log('ERROR', '[PROC] Could not fetch conv @' + slug);
    await setMeta(slug, { status: 'failed' });
    return false;
  }

  // Extract user messages (not from me/cutieval)
  const messages = (fullConv.data.messages || [])
    .filter(m => {
      if (!m.text) return false;
      const senderAlias = m.sender?.alias || '';
      const senderId = m.sender?.id || '';
      return senderAlias !== MY_UID && !senderId.includes(MY_UID.replace(/-/g, ''));
    })
    .slice(-4)
    .map(m => ({
      text: m.text || '',
      hasImage: !!(m.images && m.images.length > 0),
    }));

  if (messages.length === 0) {
    log('INFO', '[PROC] No user messages in conv @' + slug);
    await setMeta(slug, { status: 'done', slot: null });
    await apiMarkRead(convId);
    return true;
  }

  const hasImage = messages.some(m => m.hasImage);
  if (hasImage) await addImageCooldown(slug);

  const { type, slot } = await decideSlot(slug);
  log('INFO', '[PROC] @' + slug + ' → slot=' + slot + ' type=' + type + ' msgs=' + messages.length + ' img=' + hasImage);

  const reply = await generateReply(slug, messages, slot, type);
  log('INFO', '[PROC] @' + slug + ' reply: ' + reply.substring(0, 60));

  const sent = await apiSendMessage(convId, reply);
  log('INFO', '[PROC] @' + slug + ' sent=' + sent);

  if (sent) await apiMarkRead(convId);

  await setMeta(slug, {
    status: sent ? 'done' : 'failed',
    slot: sent ? slot : null,
    lastReplyAt: sent ? Date.now() : null,
    failedAt: sent ? null : Date.now(),
  });

  return sent;
}

// ── Main Scan ──────────────────────────────────────────────────────────

let _scanInProgress = false;

async function runScan() {
  if (_scanInProgress) return;
  _scanInProgress = true;
  try {
    const { botEnabled } = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
    if (!botEnabled) { _scanInProgress = false; return; }

    // Auth check
    const token = await getWapiToken();
    if (!token) {
      log('ERROR', '[SCAN] No auth token — cannot scan');
      _scanInProgress = false;
      return;
    }

    // Get UNREAD conversations
    const convs = await apiGetConversations('UNREAD', 20);
    if (!convs) {
      log('ERROR', '[SCAN] Failed to get conversations');
      _scanInProgress = false;
      return;
    }

    log('INFO', '[SCAN] ' + convs.length + ' unread conversations total');

    // Filter: skip own conv, skip already processed recently
    const filtered = [];
    for (const conv of convs) {
      const slug = conv.channel_slug || conv.recipient?.channel_slug || '';
      if (!slug || slug.toLowerCase() === MY_SLUG) continue;
      if (conv.stats?.unread_messages === 0) continue;
      const meta = await getMeta(slug);
      if (meta?.status === 'processing') continue;
      if (meta?.status === 'done' && (Date.now() - (meta.lastReplyAt || 0)) < 5 * 60 * 1000) continue;
      filtered.push(conv);
    }

    log('INFO', '[SCAN] ' + filtered.length + ' to process after filter');

    if (!filtered.length) {
      _scanInProgress = false;
      await syncOverlay({ botEnabled: true, pollTime: 20, lastScan: Date.now() });
      return;
    }

    const result = await processConv(filtered[0]);
    const st = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
    st.lastResult = { conv: filtered[0].channel_slug, ok: result, ts: Date.now() };
    st.lastScanAt = Date.now();
    await ss({ tevi_cs_state: st });

    await syncOverlay({ botEnabled: true, pollTime: 20, lastScan: Date.now() });
    log('INFO', '[SCAN] Done: @' + filtered[0].channel_slug + ' sent=' + result);
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

  await runScan();
});

// ── Init ──────────────────────────────────────────────────────────────

async function init() {
  log('INFO', 'SW v0.9.12 starting (DIRECT API mode)...');

  const st = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  st.queueBusy = false;
  await ss({ tevi_cs_state: st });

  // Clean old convMeta
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

  // Pre-auth (non-blocking)
  getWapiToken().then(token => {
    if (token) log('INFO', '[INIT] Auth OK');
    else log('ERROR', '[INIT] Auth FAILED');
  });

  await syncOverlay({ botEnabled: false, pollTime: POLL });

  // ── Message Listeners ────────────────────────────────────────────────

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
        await runScan();
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg, _, sendResp) => {
    if (msg.type === 'API_SEND_PATTERN') {
      // Legacy — no longer needed in direct API mode
      sendResp({ ok: true, note: 'direct API mode — pattern not needed' });
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
      Promise.all([sg(['tevi_cs_state', 'tevi_cs_overlay_state', 'tevi_cs_secrets', 'tevi_cs_auth'])]).then(([data]) => {
        const s = data.tevi_cs_state || {};
        const auth = data.tevi_cs_auth || {};
        const secrets = data.tevi_cs_secrets || {};
        sendResp({
          enabled: s.botEnabled || false,
          lastResult: s.lastResult || null,
          lastPoll: s.lastScanAt || null,
          hasToken: !!secrets.aiKey,
          authValid: !!(auth.wapiToken && auth.expiry > Date.now()),
        });
      });
      return true;
    }
    if (msg.type === 'RESET_STATE') {
      ss({ convMeta: {}, imageCooldownUsers: {}, tevi_cs_state: { queueBusy: false } });
      sendResp({ ok: true });
      return true;
    }
    if (msg.type === 'TEST_AUTH') {
      getWapiToken().then(token => {
        sendResp({ ok: !!token, token: token ? token.substring(0, 20) + '...' : null });
      });
      return true;
    }
    if (msg.type === 'TEST_CONVS') {
      apiGetConversations('UNREAD', 5).then(convs => {
        sendResp({ ok: !!convs, count: convs ? convs.length : 0, convs: (convs || []).slice(0, 3).map(c => ({ slug: c.channel_slug, unread: c.stats?.unread_messages, id: c.id })) });
      });
      return true;
    }
  });

  const wasSt = (await sg(['tevi_cs_state']) || {}).tevi_cs_state || {};
  if (wasSt.botEnabled) {
    await setupAlarms();
    await runScan();
  }

  log('INFO', 'SW v0.9.12 ready — DIRECT API mode (no DOM, no tabs)');
}

init().catch(e => log('ERROR', 'Init failed: ' + e.message));
