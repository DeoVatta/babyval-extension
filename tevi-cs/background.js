/**
 * BACKGROUND.JS — Tevi CS Bot v0.8
 *
 * Flow:
 * - Toggle ON → find/reuse tevi tab, navigate to messages page
 * - Every 20s idle → scan convs (no ✓/✓✓ icon = unreplied)
 * - Filter: membership, image-sender cooldown
 * - Process ONE at a time: navigate → get 4 msgs → slot decision → send
 * - Slot: greeting (slot=1) → 3 replies (slot 2-4) → greeting loop
 */

const EXT = 'Tevi CS v0.8';
const LOG = 'http://localhost:3131';
const MY_SLUG = 'cutieval';
const MY_UID = '392388705';

// ── Utilities ───────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function log(level, msg, data) {
  const payload = { source: 'BG', level, message: '[BG] ' + msg, ts: new Date().toISOString(), ...(data || {}) };
  try { await fetch(LOG + '/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); } catch {}
  if (level === 'ERROR') console.error('[BG]', msg, data || '');
  else console.log('[BG]', msg, data || '');
}

async function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

async function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj));
}

async function getTab(urlPattern) {
  const tabs = await new Promise(r => chrome.tabs.query({}, r));
  return tabs.find(t => t.url && t.url.match(urlPattern)) || null;
}

async function getTeviTab() {
  let tab = await getTab(/tevi\.com\//);
  if (!tab) {
    tab = await new Promise(r => chrome.tabs.create({ url: 'https://tevi.com/messages', active: false }, r));
    await sleep(3000);
  }
  return tab;
}

async function execScriptWithResult(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    return null;
  }
}

// ── AI Reply Generation ─────────────────────────────────────────────────

async function generateReply(userSlug, messages, slot, persona, rules) {
  const { aiKey, hmacSecret } = await storageGet(['tevi_cs_secrets']) || {};
  if (!aiKey) {
    return buildFallbackReply(messages, slot);
  }

  const context = messages.map((m, i) => `[${i + 1}]${m.hasImage ? ' [GAMBAR] ' : ' '}${m.text}`).join('\n');
  const slotLabel = slot === 1 ? 'GREETING' : `REPLY SLOT ${slot} of 4`;

  let systemPrompt = persona || `Kamu Sukii, AI Assistant-nya Baby Val. Jawaban pendek, dingin, informatif. Jangan terlalu ramah.`;

  if (rules) {
    systemPrompt += '\n\nKeyword rules:\n' + rules.split('\n').map(l => {
      const [trigger, ...replyParts] = l.split('|');
      return `- ${trigger?.trim()} → ${replyParts.join('|').trim()}`;
    }).join('\n');
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    temperature: 0.8,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `User @${userSlug} mengirim pesan:\n${context}\n\nTentukan apakah user meminta konten gratis. Jika iya, jawab pendek saja: "Konten untuk member."\n\nBalas sebagai Sukii (${slotLabel}):`
    }]
  });

  try {
    let headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` };
    if (hmacSecret) {
      const enc = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hmacSecret + body));
      const sig = Array.from(new Uint8Array(enc)).map(b => b.toString(16).padStart(2, '0')).join('');
      headers['X-HMAC-Sig'] = sig;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      log('ERROR', 'AI API error: ' + res.status);
      return buildFallbackReply(messages, slot);
    }

    const data = await res.json();
    let reply = (data.content?.[0]?.text || '').trim();
    if (!reply) return buildFallbackReply(messages, slot);

    // Clean up claude thinking tags
    reply = reply.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    if (reply.length > 500) reply = reply.substring(0, 497) + '...';
    return reply;
  } catch (e) {
    log('ERROR', 'generateReply failed: ' + e.message);
    return buildFallbackReply(messages, slot);
  }
}

function buildFallbackReply(messages, slot) {
  if (slot === 1) return null;
  const last = messages[messages.length - 1]?.text || '';
  const lower = last.toLowerCase();

  if (lower.match(/foto|video|konten|porn|sexy|model|cewek|bugil/)) return 'Konten untuk member.';
  if (lower.match(/vcs|videocall|video call/)) return 'VCS tersedia. babyval.com → Video Call → Durasi → Bayar.';
  if (lower.match(/payment|transfer|bayar|order/)) return 'babyval.com → Video Call → Durasi → Bayar.';
  if (lower.match(/member|membership|join/)) return 'tevi.com/@cutieval. Pilih membership.';
  if (lower.match(/umur|alamat|no hp|wa|chat/)) return 'Chat langsung dengan Baby Val: membership Tevi.';
  if (lower.match(/terima kasih|thanks/)) return 'Sukii. Ada yang perlu ditanyakan?';
  if (lower.match(/bot|sukii/)) return 'Sukii. Informan Baby Val.';
  if (lower.match(/cara|durasi|beda|bedanya/)) return 'Buka babyval.com. Pilih Video Call, Durasi, Bayar.';
  return 'Chat langsung dengan Baby Val: membership Tevi.';
}

const GREETING = `Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi
Kalau mau VCS bisa bayar di babyval.com`;

// ── Image Cooldown Tracking ─────────────────────────────────────────────

const IMAGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

async function getImageCooldownUsers() {
  const { imageCooldownUsers } = await storageGet(['imageCooldownUsers']) || {};
  return imageCooldownUsers || {};
}

async function addImageCooldownUser(username) {
  const users = await getImageCooldownUsers();
  users[username.toLowerCase()] = Date.now();
  await storageSet({ imageCooldownUsers: users });
}

async function isImageCooldownUser(username) {
  const users = await getImageCooldownUsers();
  const ts = users[username.toLowerCase()];
  if (!ts) return false;
  if (Date.now() - ts > IMAGE_COOLDOWN_MS) {
    delete users[username.toLowerCase()];
    await storageSet({ imageCooldownUsers: users });
    return false;
  }
  return true;
}

// ── Conv Meta Tracking ──────────────────────────────────────────────────

async function getConvMeta(slug) {
  const { convMeta } = await storageGet(['convMeta']) || {};
  return convMeta[slug.toLowerCase()] || null;
}

async function setConvMeta(slug, meta) {
  const { convMeta } = await storageGet(['convMeta']) || {};
  convMeta[slug.toLowerCase()] = { ...(convMeta[slug.toLowerCase()] || {}), ...meta, updatedAt: Date.now() };
  await storageSet({ convMeta });
}

async function clearOldConvMeta() {
  const { convMeta } = await storageGet(['convMeta']) || {};
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const filtered = {};
  for (const [k, v] of Object.entries(convMeta || {})) {
    if (v.updatedAt > cutoff) filtered[k] = v;
  }
  if (Object.keys(filtered).length !== Object.keys(convMeta || {}).length) {
    await storageSet({ convMeta: filtered });
  }
}

// ── Slot Decision ───────────────────────────────────────────────────────

const GREETING_COOLDOWN_MS = 3 * 60 * 60 * 1000;

async function decideSlot(slug, lastMsgTs) {
  const meta = await getConvMeta(slug);
  const now = Date.now();

  if (!meta) {
    return { type: 'greeting', slot: 1, greetingCooldownTs: now + GREETING_COOLDOWN_MS };
  }

  if (meta.slot >= 4) {
    return { type: 'greeting', slot: 1, greetingCooldownTs: now + GREETING_COOLDOWN_MS };
  }

  if (lastMsgTs && (now - lastMsgTs) > GREETING_COOLDOWN_MS) {
    return { type: 'greeting', slot: 1, greetingCooldownTs: now + GREETING_COOLDOWN_MS };
  }

  return { type: 'reply', slot: (meta.slot || 0) + 1 };
}

// ── Navigate ────────────────────────────────────────────────────────────

async function navigateToConv(tabId, slug) {
  const slugLower = slug.toLowerCase();
  const failCount = (await getConvMeta(slugLower))?.navigateFailCount || 0;
  if (failCount >= 3) {
    log('WARN', '[NAV] Too many fails for ' + slug + ', skipping');
    return false;
  }

  const url = `https://tevi.com/@${slugLower}/messages`;
  try {
    await chrome.tabs.update(tabId, { url, active: true });
  } catch {
    log('ERROR', '[NAV] tab.update failed, recreating tab');
    const newTab = await new Promise(r => chrome.tabs.create({ url, active: false }, r));
    await sleep(2000);
    await chrome.scripting.executeScript({ target: { tabId: newTab.id }, files: ['content-script.js'] });
    await sleep(2000);
    const ping = await execScriptWithResult(newTab.id, { type: 'PING' });
    if (ping?.ok) {
      const st = await storageGet(['tevi_cs_state']) || {};
      st.teviTabId = newTab.id;
      await storageSet({ tevi_cs_state: st });
      return true;
    }
    return false;
  }

  await sleep(4000);

  const ping = await execScriptWithResult(tabId, { type: 'PING' });
  if (!ping?.ok) {
    log('WARN', '[NAV] CS not responding, injecting...');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
    await sleep(3000);
    const ping2 = await execScriptWithResult(tabId, { type: 'PING' });
    if (!ping2?.ok) {
      await setConvMeta(slugLower, { navigateFailCount: failCount + 1 });
      return false;
    }
  }

  return true;
}

async function navigateToMessages(tabId) {
  try {
    await chrome.tabs.update(tabId, { url: 'https://tevi.com/messages', active: true });
    await sleep(3000);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
    await sleep(1500);
  } catch (e) {
    log('ERROR', '[NAV] navigateToMessages failed: ' + e.message);
  }
}

// ── Process One Conversation ───────────────────────────────────────────

async function processConv(tabId, slug) {
  log('INFO', '[PROC] Starting conv: ' + slug);
  await setConvMeta(slug, { status: 'processing', slot: null });

  const navOk = await navigateToConv(tabId, slug);
  if (!navOk) {
    log('ERROR', '[PROC] Navigate failed for: ' + slug);
    const prev = await getConvMeta(slug) || {};
    await setConvMeta(slug, { status: 'failed', navigateFailCount: (prev.navigateFailCount || 0) + 1 });
    return false;
  }

  await sleep(2000);

  const msgsResp = await execScriptWithResult(tabId, { type: 'GET_MSGS', count: 4 });
  const userMessages = msgsResp?.messages || [];
  log('INFO', '[PROC] Got ' + userMessages.length + ' user msgs for ' + slug);

  const checkResp = await execScriptWithResult(tabId, { type: 'CHECK_DM' });
  const lastMsgTs = checkResp?.lastMsgTs || null;

  const { type, slot, greetingCooldownTs } = await decideSlot(slug, lastMsgTs);
  log('INFO', '[PROC] Slot: type=' + type + ' slot=' + slot + ' for ' + slug);

  let reply;
  if (type === 'greeting') {
    reply = GREETING;
  } else {
    const { persona, rules } = await storageGet(['tevi_cs_config']) || {};
    reply = await generateReply(slug, userMessages, slot, persona, rules);
    if (!reply) reply = GREETING;
  }

  if (checkResp?.hasImage) {
    await addImageCooldownUser(slug);
    log('INFO', '[PROC] Image from ' + slug + ' — cooldown started');
  }

  const sendResp = await execScriptWithResult(tabId, { type: 'DOM_SEND', text: reply });
  const sent = sendResp?.ok || false;
  log('INFO', '[PROC] Send result: ' + sent + ' for ' + slug);

  const prevMeta = await getConvMeta(slug) || {};
  await setConvMeta(slug, {
    status: sent ? 'done' : 'failed',
    slot: sent ? slot : null,
    greetingCooldownTs: type === 'greeting' ? greetingCooldownTs : prevMeta.greetingCooldownTs,
    lastReplyAt: sent ? Date.now() : null,
    lastMsgTs: lastMsgTs || Date.now(),
  });

  if (sent) {
    await navigateToMessages(tabId);
    await sleep(3000);
  }

  return sent;
}

// ── Main Scan Loop ──────────────────────────────────────────────────────

async function runScan(tabId) {
  const { botEnabled } = await storageGet(['tevi_cs_state']) || {};
  if (!botEnabled) return;

  await navigateToMessages(tabId);
  await sleep(4000);

  let scanResp = await execScriptWithResult(tabId, { type: 'SCAN_CONVS' });
  if (!scanResp?.ok) {
    log('WARN', '[SCAN] CS may need injection');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
    await sleep(2000);
    const retry = await execScriptWithResult(tabId, { type: 'SCAN_CONVS' });
    if (!retry?.ok) {
      log('ERROR', '[SCAN] Retry failed');
      return;
    }
    scanResp = retry;
  }

  const rawConvs = scanResp.convs || [];
  log('INFO', '[SCAN] Found ' + rawConvs.length + ' unreplied convs');

  if (rawConvs.length === 0) return;

  const filteredConvs = [];
  for (const conv of rawConvs) {
    const slug = conv.slug;
    if (!slug || slug.toLowerCase() === MY_SLUG) continue;

    const meta = await getConvMeta(slug);
    if (meta?.status === 'processing') continue;
    if ((meta?.navigateFailCount || 0) >= 3) continue;
    if (await isImageCooldownUser(slug)) {
      log('INFO', '[SCAN] Skipping ' + slug + ' (image cooldown)');
      continue;
    }
    filteredConvs.push(conv);
  }

  log('INFO', '[SCAN] ' + filteredConvs.length + ' convs after filter');
  if (filteredConvs.length === 0) return;

  const conv = filteredConvs[0];
  const ok = await processConv(tabId, conv.slug);

  const st = await storageGet(['tevi_cs_state']) || {};
  st.lastResult = { conv: conv.slug, ok, ts: Date.now() };
  st.lastScanAt = Date.now();
  await storageSet({ tevi_cs_state: st });

  await syncOverlay({ botEnabled: true, newMessage: false, typing: false, pollTime: 20 });

  log('INFO', '[SCAN] Done: ' + conv.slug + ' result=' + ok);
}

// ── Overlay Sync ────────────────────────────────────────────────────────

async function syncOverlay(state) {
  await storageSet({ tevi_cs_overlay_state: { ...state, updatedAt: Date.now() } });
}

// ── Alarm Handler ────────────────────────────────────────────────────────

const POLL_INTERVAL_MIN = 20;

async function setupAlarm() {
  const existing = await chrome.alarms.get('tevi_cs_poll');
  if (existing) chrome.alarms.clear('tevi_cs_poll');
  chrome.alarms.create('tevi_cs_poll', {
    delayInMinutes: POLL_INTERVAL_MIN / 60,
    periodInMinutes: POLL_INTERVAL_MIN / 60,
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'tevi_cs_poll') return;
  const { botEnabled } = await storageGet(['tevi_cs_state']) || {};
  if (!botEnabled) return;

  let tab = await getTeviTab();
  if (!tab) return;

  try { await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); } catch {
    log('WARN', '[ALARM] Tab not responding, recreating...');
    const newTab = await new Promise(r => chrome.tabs.create({ url: 'https://tevi.com/messages', active: false }, r));
    await sleep(3000);
    await chrome.scripting.executeScript({ target: { tabId: newTab.id }, files: ['content-script.js'] });
    await sleep(2000);
    const st = await storageGet(['tevi_cs_state']) || {};
    st.teviTabId = newTab.id;
    await storageSet({ tevi_cs_state: st });
    await runScan(newTab.id);
    return;
  }

  await runScan(tab.id);
});

// ── SW Startup & Toggle ────────────────────────────────────────────────

async function init() {
  log('INFO', 'SW v0.8 starting...');

  // Reset queueBusy on startup (prevents frozen state after SW suspend)
  const st = await storageGet(['tevi_cs_state']) || {};
  st.queueBusy = false;
  st.queue = st.queue || [];
  await storageSet({ tevi_cs_state: st });

  await clearOldConvMeta();
  await setupAlarm();
  await syncOverlay({ botEnabled: false, newMessage: false, typing: false, pollTime: POLL_INTERVAL_MIN });

  chrome.storage.onChanged.addListener(async (changes) => {
    if (!changes.tevi_cs_toggle_req) return;
    const req = changes.tevi_cs_toggle_req.newValue;
    if (!req) return;

    const current = await storageGet(['tevi_cs_state']) || {};
    const newEnabled = req.enabled;

    log('INFO', '[TOGGLE] ' + (current.botEnabled ? 'ON' : 'OFF') + ' → ' + (newEnabled ? 'ON' : 'OFF'));

    await storageSet({
      tevi_cs_toggle_req: null,
      tevi_cs_toggle_ack: { enabled: newEnabled, ts: Date.now() },
      tevi_cs_state: { ...current, botEnabled: newEnabled }
    });

    await syncOverlay({ botEnabled: newEnabled, newMessage: false, typing: false, pollTime: POLL_INTERVAL_MIN });

    if (newEnabled) {
      const tab = await getTeviTab();
      if (tab) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); } catch {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-script.js'] });
          await sleep(2000);
        }
        await runScan(tab.id);
      }
    }
  });

  if (st.botEnabled) {
    const tab = await getTeviTab();
    if (tab) await runScan(tab.id);
  }

  log('INFO', 'SW v0.8 ready');
}

init().catch(e => log('ERROR', 'Init failed: ' + e.message));
