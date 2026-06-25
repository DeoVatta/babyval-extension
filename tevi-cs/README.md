# Tevi CS Bot — Sukii Assistant

## Apa Ini

Bot CS (Customer Service) otomatis untuk akun **@cutieval** di Tevi.com (UID=392388705).

Bot scan semua DM masuk yang belum dibalas, terus balas pakai AI (persona: "Sukii") dengan topik yang sesuai — membership, VCS, payment, masker, dll. Semua chat logged ke Supabase.

---

## Goals

1. **Automasi balas chat** — 24/7 tanpa perlu manual
2. **AI-powered** — Jawaban dari Olagon AI, persona Sukii (cold, informatif, langsung)
3. **Log semua chat** — Supabase (users, chat_logs, payment_proofs)
4. **Slot system** — Tidak spam. Maksimal 4x balas per user, lalu reset.
5. **Image cooldown** — User kirim gambar → skip 6 jam (asumsi: bukti payment)

---

## Architecture

### Extension Structure (MV3)

```
tevi-cs/
├── manifest.json        # v0.9.11 — version + permissions
├── background.js        # Service Worker — scan, slot, edge function call
├── content-script.js    # Unified: DOM scanner, message reader, intercept capture, SNIFER
├── overlay.js           # Cat toggle panel
├── api-discovery.js     # Legacy discovery (superseded by CS sniffer)
├── interceptor.js       # (legacy) API interceptor
├── log-server.js        # Local HTTP log receiver (port 3131)
├── popup/
│   └── popup.html       # Extension popup UI (Rules/Behavior/Persona/Keys/API tabs)
├── icons/
└── supabase/
    ├── config.toml
    ├── functions/
    │   ├── cs-bot-logger/    # AI + logging + API discovery handler
    │   └── api-auto-probe/    # Auto-probe Tevi API endpoints
    └── migrations/
        ├── 20260606000101_cs_bot_schema.sql
        └── 20260625205315_tevi_api_discovery.sql
```

### How It Works

1. **Service Worker** (background.js) polling via `chrome.alarms` setiap 20 detik
2. **Content Script** injects ke Tevi page — scan DOM untuk conv list + messages
3. **INTERCEPT_SEND** — monkey-patch fetch/XHR untuk capture Tevi API send pattern
4. **Supabase Edge Function** — handle AI call ke Olagon + log everything
5. **apiSend()** — replay captured API request (tabless send)

### Tech Stack

| Component | Tech |
|---|---|
| Extension | Chrome MV3 (Service Worker) |
| AI Gateway | Olagon (`gateway.olagon.site`) |
| Database | Supabase (PostgreSQL) |
| Edge Functions | Deno (Supabase) |
| Auth | Cookie-based (Tevi login session) |

---

## CONV DETECTION — METODE YANG BEKERJA

### Metode 1: DOM Anchor Link (PROVEN WORK v0.8)

Tevi render conv list sebagai anchor links ke `/@username/messages`. Selector yang work:

```javascript
// Semua anchor href yang mengandung /@
const allLinks = document.querySelectorAll('a[href*="/@"]');
const convLinks = allLinks.filter(a => {
  return a.href && a.href.match(/tevi\.com\/@[^/]+\/messages/);
});
// Support juga relative URL: /@username/messages
const m = link.href.match(/(?:tevi\.com)?\/@([^/?#]+)/);
```

**Key insight:** Tevi pakai MUI (`MuiStack-root css-xxxx`) untuk conv items. Anchor ada di dalam MuiStack DIV.

**Priority selector (v0.8 yang work):**
1. `a[href*="/@"]` dengan href match `tevi.com/@username/messages` — **PRIORITY 1**
2. `[data-conv-id]` — Tevi's internal ID
3. `[class*="conversation-item"]`
4. `ul[class*="list"] > li` (list item filter by @username in text)
5. Fallback: `a[href*="/@"]` anywhere

**Slug extraction dari anchor href:**
```javascript
// Support full URL dan relative URL
const m = link.href.match(/(?:tevi\.com)?\/@([^/?#]+)/);
if (m && m[1]) return m[1];
```

### Metode 2: API-Based (Tabless — PROVEN WORK v0.9)

Tevi kirim pesan via HTTP API. Extension capture request pattern lalu replay.

**Capture flow:**
1. User kirim DM manual di Tevi
2. `INTERCEPT_SEND` aktif (via content script message)
3. Monkey-patch `window.fetch` + `XMLHttpRequest`
4. Tangkap POST request ke API send endpoint
5. Simpan pattern: `{ url, method, headers, bodyFields }`
6. Service Worker replay dengan message baru

**Kode capture (content-script.js):**
```javascript
function tryCapture(url, method, headers, body) {
  // Universal — capture semua domain Tevi
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch {}
  const isTeviApi = hostname.includes('tevi.com') ||
                    hostname.includes('flowstreamx') ||
                    hostname.includes('wapi');
  if (!isTeviApi) return;
  if (!url.match(/send|message|chat|conversation/i)) return;

  captured = true;
  // Parse body
  let parsedBody = {};
  try { parsedBody = JSON.parse(body); } catch {}

  // Simpan pattern
  chrome.runtime.sendMessage({
    type: 'API_SEND_PATTERN',
    url, method,
    headers: { Authorization: headers.Authorization || '' },
    bodyFields: parsedBody,
    capturedAt: Date.now(),
  });
}
```

**Kode replay (background.js):**
```javascript
async function apiSend(recipientSlug, text) {
  const { apiSendPattern } = await sg(['apiSendPattern']);
  if (!apiSendPattern) return false;

  const bf = apiSendPattern.bodyFields || {};
  const body = { message: text, recipient: recipientSlug };

  const res = await fetch(apiSendPattern.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ... },
    body: JSON.stringify(body),
    credentials: 'include', // PENTING: include cookies untuk auth
  });

  return res.ok;
}
```

**KNOWN ISSUE:** Domain API Tevi tidak diketahui. v0.9 capture `wapi.flowstreamx.com`. v0.9.10 universal capture semua domain.

### Metode 3: DOM Typing + Send (Fallback)

Kalau API send tidak tersedia, fallback ke DOM manipulation:

```javascript
// 1. Find input
const input = document.querySelector('textarea#_r_17_') ||
              document.querySelector('div[contenteditable="true"]');

// 2. Type with realistic delay
for (const ch of text) {
  input.textContent += ch;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await sleep(30 + Math.random() * 40);
}

// 3. Click send button
const btn = findSendBtn();
btn.click();

// 4. Verify sent
await sleep(2000);
return messages.some(m => m.includes('Halo aku Sukii'));
```

### Metode 4: API Auto-Discovery (Sniffer)

`sniffer.js` — universal fetch/XHR interceptor yang capture SEMUA API calls:

- Monkey-patch `window.fetch` + `XMLHttpRequest`
- Skip calls ke Supabase sendiri (avoid loop)
- Report ke Supabase tables: `tevi_api_endpoints`, `tevi_auth_tokens`
- Auto-detect domain Tevi yang sebenarnya

---

## MESSAGE READING — METODE

### Dari DM Page (tevi.com/@username/messages)

```javascript
// 1. Find all message elements
const msgEls = document.querySelectorAll('[class*="message"], [role="listitem"], div[class*="bubble"]');

// 2. Filter USER messages only (not Sukii)
function isFromUser(msgEl) {
  const cls = msgEl.className.toLowerCase();
  // Right-aligned = Sukii, Left-aligned = user
  if (cls.includes('right') || cls.includes('outgoing')) return false;
  if (cls.includes('left') || cls.includes('incoming')) return true;
  // Check avatar
  const avatar = msgEl.querySelector('[class*="avatar"]');
  if (avatar && !avatar.textContent.includes('cutieval')) return true;
  return false;
}

// 3. Get last N messages
const userMsgs = msgEls
  .filter(isFromUser)
  .map(el => ({ text: el.textContent.trim(), hasImage: !!el.querySelector('img') }))
  .slice(-4);
```

### Dari Conv List (tevi.com/messages)

```javascript
// Check last message icon: ✓ = Sukii replied, no icon = user last
function hasRepliedIcon(convEl) {
  const svgs = convEl.querySelectorAll('svg');
  for (const svg of svgs) {
    if (svg.outerHTML.includes('check-double')) return true;
    if (svg.outerHTML.includes('icon-check')) return true;
  }
  return false;
}

// Unread = no check icon AND has unread badge
const unread = !hasRepliedIcon(convEl) && hasUnreadBadge(convEl);
```

---

## AI SYSTEM

### Olagon Gateway

- **URL:** `https://gateway.olagon.site/anthropic`
- **Edge Function:** `https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger`
- **Model:** `claude-sonnet-4-6`
- **Rate Limit:** 20 calls/min per IP

### AI Rules (Sukii v0.9.7)

#### ✅ BOLEH DIJAWAB
| Topik | Jawaban |
|---|---|
| Cara membership | Buka profile Baby Val → Join Membership |
| Cara VCS | babyval.com → Video Call → Durasi → Bayar |
| Cara bayar | babyval.com → VCS → Durasi → Bayar (Dana/OVO/transfer) |
| Payment Dana/OVO | babyval.com → VCS → Bayar. Dana/OVO/transfer tersedia. |
| Open masker | Boleh open masker. Tambah 350k. |
| Full open | Buka semua kecuali masker. Buka masker tambah 350k. |
| VCS via apa? | Private Room Tevi. Ber-2 aja. |
| Benefit membership | Masuk live gratis, konten terbuka, chat kapanpun |
| Mau kasih tip | ganknow.com/babyval/tip |

#### ❌ TIDAK BOLEH DIJAWAB
| Topik | Jawaban |
|---|---|
| Alamat/no HP/WA | "Informasi pribadi tidak diberikan." |
| Ketemu offline | "Cuma bisa VCS. Offline tidak tersedia." |
| Kirim konten langsung | "Konten untuk member." |
| Chat tidak pantas | "Kalau mau chat sama Baby Val, membership dulu ya." |

#### 🧠 Psikologi — User Belum Pernah Bayar
Kalau user tanya offline/BO/ketemu tapi belum pernah payment:
→ **"Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?"**

---

## Greeting Template (Static — Tidak AI-generated)

```
Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi

Kalau mau VCS bisa bayar di babyval.com
```

---

## Slot System

| Slot | Type | Keterangan |
|---|---|---|
| 1 | Greeting | Perkenalan Sukii |
| 2 | Reply | Balasan konteks #1 |
| 3 | Reply | Balasan konteks #2 |
| 4 | Reply | Balasan konteks #3 |
| 5+ | Greeting | Reset ke slot 1 |

---

## Status v0.9.11 (2026-06-26)

### Current State

**Conv Detection:** ✅ DOM scan menemukan 20 items. **Slug extraction** masih dalam testing.

**Sniffer:** ✅ Unified ke content-script.js — auto-runs di startup, capture semua API call.

**API Send:** ✅ Fungsi ada. Butuh manual DM send untuk capture pattern.

### v0.9.11 Fixes
- **Sniffer merged into content-script.js** — unified system, tidak ada file terpisah
- All versions synced: manifest, BG, CS
- Sniffer reports to log-server (`[SNIFFER]`) + Supabase

### Changelog

#### v0.9.11 — 2026-06-26
- Unify sniffer into content-script.js (single system)
- Remove standalone `sniffer.js` from manifest
- Sync all file versions to v0.9.11

#### v0.9.10 — 2026-06-26
- Fix `findConvItems()` priority (anchor href first)
- Universal API domain capture
- Relative URL regex for slug extraction

#### v0.9 — 2026-06-26 (PROVEN WORK)
- API-based send (tabless) via intercepted pattern
- `INTERCEPT_SEND` capture flow
- `apiSend()` replay function

#### v0.8 — 2026-06-26 (PROVEN WORK)
- DOM conv detection via anchor href
- `scanConvs()` dengan check icon + unread badge

---

## Setup

### 1. Start Log Server
```bash
cd C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
node log-server.js
```

### 2. Load Extension
```
edge://extensions/
→ Developer mode → Load unpacked
→ Pilih: C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
```

### 3. Capture API Pattern (Wajib!)
1. Buka Tevi.com/message
2. Kirim 1 DM manual ke siapapun
3. Lihat log `[INTERCEPT] Captured: POST domain.com/path`
4. Pattern tersimpan di `chrome.storage.local.apiSendPattern`

### 4. Set AI Key
Buka popup → tab **Keys** → masukkan Olagon key → Save

### 5. Toggle ON
Popup → toggle → ON

### 6. Watch Log
```bash
pwsh -Command "Get-Content 'tevi-cs-logs.txt' -Tail 30 -Wait"
```

---

## Supabase Schema

### cs_users
| Column | Type | Description |
|---|---|---|
| username | text PK | Username Tevi |
| membership_status | text | none / active / expired |
| payment_count | int | Jumlah bukti payment |
| first_seen_at | timestamptz | First chat |
| last_chat_at | timestamptz | Last chat |

### cs_chat_logs
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| username | text FK | Referensi cs_users |
| sender | text | user / sukii |
| message | text | Isi pesan |
| has_image | bool | Ada gambar |
| slot | int | Slot 1-4 |
| reply_type | text | greeting / ai / fallback |
| ai_model | text | Model AI |
| tokens_used | int | Token usage |
| created_at | timestamptz | Timestamp |

### cs_payment_proofs
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| username | text FK | Referensi cs_users |
| image_url | text | URL bukti transfer |
| amount | int | Nominal |
| verified | bool | Sudah diverifikasi |

### tevi_api_endpoints
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| method | text | GET/POST/PUT/DELETE |
| path | text | API path |
| full_url | text | Full URL |
| host | text | Domain |
| sample_request | jsonb | Request body |
| sample_response | jsonb | Response body |
| status_code | int | HTTP status |
| discovered_at | timestamptz | When discovered |

### tevi_auth_tokens
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| token | text | Auth token |
| token_type | text | bearer/cookie/session |
| user_id | text | Associated user ID |
| username | text | Username |
| expires_at | timestamptz | Expiry |

---

## Debugging

### Check Conv Detection
Buka DevTools di Tevi.com/message → Console:
```javascript
document.querySelectorAll('a[href*="/messages"]').length
document.querySelectorAll('[data-conv-id]').length
document.querySelectorAll('[class*="conversation"]').length
```

### Check API Pattern
```javascript
chrome.storage.local.get('apiSendPattern', r => console.log(r));
```

### Check Sniffer Catalog
```javascript
chrome.storage.local.get('tevi_api_catalog', r => console.log(r));
```

### Common Issues

| Issue | Cause | Fix |
|---|---|---|
| `findConvItems returned 0` | Wrong selector priority | Prioritas anchor href dulu |
| `SCAN 0 unreplied` | Slug extraction fails | Check relative URL regex |
| `No send pattern` | Belum kirim DM manual | Kirim 1 DM manual |
| `[API] Failed` status=0 | CORS from SW | Use content script for API calls |
| Edge crash | Extension memory | Kill edge: `Get-Process msedge | Stop-Process` |

---

## Version History

| Version | Date | Status | Notes |
|---|---|---|---|
| v0.9.10 | 2026-06-26 | Dev | Universal capture, relative URL fix |
| v0.9.9 | 2026-06-26 | Dev | Universal sniffer |
| v0.9.8 | 2026-06-26 | Dev | Scan debounce, debug logs |
| v0.9 | 2026-06-26 | **PROVEN** | API send tabless, INTERCEPT_SEND |
| v0.8 | 2026-06-26 | **PROVEN** | DOM conv detection anchor href |
