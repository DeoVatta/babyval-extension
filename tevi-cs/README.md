# Tevi CS Bot — Sukii Assistant

> **Status**: v0.9.16 — **SCAN + FETCH + SEND PIPELINE ACTIVE**
> Bot mendeteksi DM unread → fetch pesan → generate reply → send. Conversation state management dengan retry logic.

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

### Extension Structure (v0.9.16)

```
tevi-cs/
├── manifest.json        # v0.9.16 — Chrome MV3 Service Worker
├── background.js        # Service Worker — DIRECT API mode
│                          Pipeline: scan → getMessages → generateReply → sendMessage → markRead
├── content-script.js   # Token capture + persistent sniffer + WS interceptor
├── overlay.js          # Cat toggle panel + Reset State button (v0.9.16)
├── api-discovery.js    # Legacy (deprecated)
├── log-server.js       # Local HTTP log receiver (port 3131)
├── version.js          # Single source of truth version config
├── popup/
│   └── popup.html      # Extension popup UI (tabs: Rules/Behavior/Persona/Keys/API)
└── supabase/
    └── functions/
        └── cs-bot-logger/    # AI + logging edge function
```

### Processing Pipeline (v0.9.16)

```
1. SCAN (every 20s when ON)
   GET /messenger/v2/rpc/get_recent_conversations?filter=UNREAD
   → Filter: skip own conv, skip 'processing', retry failed/old-done
   → Pick first conv from filtered list

2. FETCH MESSAGES
   GET /messenger/v2/rpc/get_messages?conversation_id={uuid}&limit=50
   → Filter: skip messages from MY_UID (392388705)
   → Extract last 4 user messages

3. GENERATE REPLY (slot system)
   → Slot 1 = greeting, Slot 2-3 = AI context, Slot 4 = closing
   → AI via Olagon gateway (if key configured)
   → Fallback: keyword template matching

4. SEND
   POST /messenger/v2/rpc/send_message
   Body: { body: { conversation_id, input_text, msg_type: "TEXT", parser: "PLAIN" } }
   → On send fail: retry next scan cycle (convMeta status='failed')

5. MARK READ
   POST /messenger/v2/conversation/{uuid}/read/

6. UPDATE STATE
   setMeta(slug, { status: sent?'done':'failed', slot, lastReplyAt/failedAt })
```

### Conversation State (convMeta)

```javascript
// chrome.storage.local.convMeta: { [slug]: { status, slot, lastReplyAt, failedAt, convId } }
status: 'processing' | 'done' | 'failed'

// Retry logic (v0.9.15+):
// - Always retry 'failed'
// - Skip 'done' ONLY IF: recentSuccess (<5min) AND !wasFailed
// - wasFailed = failedAt > lastReplyAt (previous send actually broke)
```

---

## Auth System

### METHOD 1: Tevi localStorage Token Capture (v0.9.12+ — WORKING)

**Discovery**: Tevi menyimpan auth token di `localStorage['user_logged_list']`.

**Flow**:
1. CS (content script) injects ke Tevi tab yang sudah login
2. Baca `localStorage.getItem('user_logged_list')`
3. Decode JWT payload untuk check expiry
4. Kirim token ke BG via `chrome.runtime.sendMessage({ type: 'TEVI_TOKEN' })`
5. BG simpan ke `chrome.storage.local` + sync ke Supabase

**Token format**:
```javascript
// localStorage['user_logged_list']
{
  "392388705": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "user": { "id": 392388705, "display_name": "Cutieval", ... }
  }
}
```

**JWT payload decode**:
```javascript
const payload = JSON.parse(atob(token.split('.')[1]));
// payload.uid, payload.exp, payload.anonymous
```

### METHOD 2: Supabase Token Store (v0.9.12+ — FALLBACK)

**Table**: `tevi_auth_tokens`

**Columns**: `id`, `token`, `token_type`, `user_id`, `username`, `expires_at`, `acquired_at`, `last_used_at`, `is_active`, `notes`

### METHOD 3: Token Refresh (v0.9.12+ — FALLBACK)

**Endpoint**: `POST https://wapi.flowstreamx.com/auth/v1/token/` — **NO `?verify=` HMAC needed**

---

## Messenger API v2 (v0.9.14+ — WORKING)

**Base**: `https://wapi.flowstreamx.com`
**Auth**: `Authorization: Bearer <wapi_token>` + `?verify=<hmac>`
**HMAC**: `HMAC-SHA256(key=PRDKqnSNCKrMDF9hAt0PSJ6, data=pathname+timestamp)`

### Endpoints (CONFIRMED)

| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/messenger/v2/rpc/get_recent_conversations?filter=UNREAD` | List unread conversations | ✅ 200 |
| GET | `/messenger/v2/rpc/get_messages?conversation_id={uuid}&limit=50` | Get conversation messages | ✅ 200 |
| POST | `/messenger/v2/rpc/send_message` | Send message | ✅ 200 (body wrapper) |
| POST | `/messenger/v2/rpc/send_chat_action/{conv_id}/` | Typing/none action | ✅ 200 |
| POST | `/messenger/v2/conversation/{uuid}/read/` | Mark read | ✅ (legacy path) |

### Send Message Payload (v0.9.14+)

```
POST /messenger/v2/rpc/send_message
Body: { body: { conversation_id, input_text, msg_type: "TEXT", parser: "PLAIN" } }
```

⚠️ **IMPORTANT**: Payload MUST be wrapped in `body:` key. API returns 422 without it.

### Get Messages Response

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "uuid",
        "sender": { "id": "uuid", "alias": "3290169952", "name": "Bidinisreal" },
        "type": "TEXT",
        "text": "kapan live",
        "images": [],
        "created_at": 1782308067930
      }
    ]
  }
}
```

**Filter untuk extract user messages**:
```javascript
// Numeric sender alias (392388705 = cutieval = skip)
// Check both alias AND sender.id
const isMe = senderAlias === MY_UID || senderId.includes(MY_UID.replace(/-/g, ''));
```

### Get Conversations Response

```json
{
  "success": true,
  "data": {
    "count": 548,
    "results": [{
      "id": "uuid-conv-id",
      "channel_slug": "bidinisreal",
      "recipient": { "channel_slug": "bidinisreal", "is_my_subscriber": false },
      "latest_message": {
        "sender": { "alias": "3290169952" },  // NUMERIC USER ID
        "text": "kapan live",
        "created_at": 1782308067930
      },
      "stats": { "unread_messages": 2 }
    }]
  }
}
```

---

## HMAC Verify Signature

**Key**: `PRDKqnSNCKrMDF9hAt0PSJ6`
**Formula**: `HMAC-SHA256(key, pathname + timestamp)` → base64 → `timestamp-signature`
**Endpoint**: `?verify=1750867200-base64sig...`
**Note**: `/auth/v1/token/` does NOT need `?verify=`

---

## AI System

### Olagon Gateway

- **URL**: `https://gateway.olagon.site/anthropic`
- **Edge Function**: `https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger`
- **Model**: `claude-sonnet-4-6`

### AI Rules (Sukii)

#### BOLEH DIJAWAB
| Topik | Jawaban |
|---|---|
| Cara membership | Buka profile Baby Val → Join Membership |
| Cara VCS | babyval.com → Video Call → Durasi → Bayar |
| Cara bayar | babyval.com → VCS → Bayar (Dana/OVO/transfer) |
| Open masker | Boleh open masker. Tambah 350k. |
| Full open | Buka semua kecuali masker. Buka masker tambah 350k. |
| Benefit membership | Masuk live gratis, konten terbuka, chat kapanpun |

#### TIDAK BOLEH DIJAWAB
| Topik | Jawaban |
|---|---|
| Alamat/no HP/WA | "Informasi pribadi tidak diberikan." |
| Ketemu offline | "Cuma bisa VCS. Offline tidak tersedia." |
| Kirim konten langsung | "Konten untuk member." |

### Greeting Template
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
| 2-3 | Reply | Balasan konteks |
| 4 | Reply | Balasan akhir |
| 5+ | Greeting | Reset ke slot 1 |

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

### tevi_auth_tokens
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| token | text | wapi access_token |
| token_type | text | bearer/cookie/session |
| user_id | text | Associated user ID |
| username | text | cutieval |
| expires_at | timestamptz | Token expiry |
| acquired_at | timestamptz | When captured |
| last_used_at | timestamptz | Last used |
| is_active | bool | Active flag |

---

## Version History

| Version | Date | Status | Notes |
|---|---|---|---|
| v0.9.16 | 2026-06-27 | **ACTIVE** | Reset State button in overlay, retry filter logic |
| v0.9.15 | 2026-06-27 | Pushed | Retry filter: skip done only if recentSuccess && !wasFailed |
| v0.9.14 | 2026-06-26 | Pushed | Send payload: `{ body: { ... } }` wrapper confirmed |
| v0.9.13 | 2026-06-26 | Pushed | RPC endpoints confirmed: get_messages, send_message |
| v0.9.12 | 2026-06-26 | **WORKING** | DIRECT API mode: token capture + Messenger v2 RPC |
| v0.9.11 | 2026-06-26 | Deprecated | Unify sniffer into CS |
| v0.9 | 2026-06-26 | Deprecated | API send tabless |
| v0.8 | 2026-06-26 | Deprecated | DOM conv detection |

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

### 3. Token Capture
1. Buka Tevi tab dan login sebagai cutieval
2. CS otomatis capture token dari localStorage
3. Check log: `[AUTH] Tevi token received from CS: uid=392388705`

### 4. Set AI Key (Optional)
Popup → tab **Keys** → masukkan Olagon key → Save
(Hanya perlu jika pakai AI reply. Fallback template tetap jalan tanpa AI key.)

### 5. Toggle ON
Overlay cat → click → panel → toggle ON
Atau: Popup → toggle → ON

### 6. Reset State (If Needed)
Overlay cat → click → panel → 🗑 Reset State
(Perlu dilakukan saat bot skip semua convs karena convMeta state lama)

### 7. Watch Log
```bash
curl http://localhost:3131/logs
```
Atau browser console ke `http://localhost:3131/log`

---

## Known Issues

| Issue | Cause | Status |
|---|---|---|
| 422 on send_message | Payload missing `body:` wrapper | ✅ FIXED v0.9.14 |
| Bot skip all convs after failed send | convMeta status='done' but send failed | ✅ FIXED v0.9.15 (retry filter) |
| Popup tabs not clickable | Content script conflict | ⚠️ Use overlay instead |
| 404 on /conversation/{id}/ | Wrong URL pattern | ✅ FIXED: use `/rpc/get_messages?conversation_id=` |
| 401 on /tevi-chat/v1/ | Wrong auth scope | ✅ Avoided: use `/messenger/v2/rpc/` |

---

## Reference

- **babyval-autopilot/tevi-api/auto-dm-design.md**: Full API discovery + confirmed endpoints
- **babyval-autopilot/tevi-api/tevi-api-client.js**: Node.js client with auth flow
- **wapi.flowstreamx.com**: API base domain
- **PRDKqnSNCKrMDF9hAt0PSJ6**: HMAC sign key (from tevi.com JS bundle)
