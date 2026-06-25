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
├── manifest.json        # v0.9.12 — version + permissions
├── background.js        # Service Worker — DIRECT API mode, no DOM/tabs
├── content-script.js   # Token capture from Tevi localStorage + sniffer
├── overlay.js          # Cat toggle panel
├── api-discovery.js    # Legacy (deprecated)
├── interceptor.js      # Legacy (deprecated)
├── log-server.js      # Local HTTP log receiver (port 3131)
├── popup/
│   └── popup.html    # Extension popup UI
└── supabase/
    └── functions/
        ├── cs-bot-logger/    # AI + logging edge function
        └── api-auto-probe/    # Auto-probe endpoints
```

---

## Auth System

### METHOD 1: Tevi localStorage Token Capture (v0.9.12 — WORKING)

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

**CS capture code** (content-script.js):
```javascript
function captureTeviToken() {
  try {
    const raw = localStorage.getItem('user_logged_list');
    if (!raw) return null;
    const entries = JSON.parse(raw);
    for (const [uid, entry] of Object.entries(entries)) {
      if (!entry?.access_token) continue;
      const payload = JSON.parse(atob(entry.access_token.split('.')[1]));
      const isExpired = payload.exp * 1000 < Date.now();
      if (!isExpired && !payload.anonymous) {
        return { uid, access_token: entry.access_token,
                 refresh_token: entry.refresh_token,
                 expires_at: new Date(payload.exp * 1000).toISOString() };
      }
    }
  } catch {}
  return null;
}
```

### METHOD 2: Supabase Token Store (v0.9.12 — FALLBACK)

**Table**: `tevi_auth_tokens`

**Columns**: `id`, `token`, `token_type`, `user_id`, `username`, `expires_at`, `acquired_at`, `last_used_at`, `is_active`, `notes`

**BG syncs token ke Supabase setiap dapat fresh token**:
```javascript
// On fresh token capture
await fetch(SUPABASE_URL + '/rest/v1/tevi_auth_tokens', {
  method: 'POST',
  headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify([{
    token: access_token,
    token_type: 'Bearer',
    user_id: uid,
    username: 'cutieval',
    expires_at: expires_at,
    acquired_at: new Date().toISOString(),
    is_active: true,
  }])
});
```

### METHOD 3: Token Refresh (v0.9.12 — FALLBACK)

**Endpoint**: `POST https://wapi.flowstreamx.com/auth/v1/token/`

**NO `?verify=` HMAC needed** untuk endpoint ini.

**Request**:
```json
{
  "access_token": "",
  "refresh_token": "<stored_refresh_token>",
  "device_id": "tevi-cs-bot-...",
  "device_type": "browser",
  "os": "Windows",
  "device_name": "Chrome"
}
```

**Response**:
```json
{
  "data": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in": 86400
  }
}
```

---

## Messenger API v2 (v0.9.12 — WORKING)

**Discovered from**: babyval-autopilot/tevi-api/tevi-dm-sniff.json

**Base**: `https://wapi.flowstreamx.com`

**Auth**: `Authorization: Bearer <wapi_token>` + `?verify=<hmac>`

**HMAC Verify**: `HMAC-SHA256(key=PRDKqnSNCKrMDF9hAt0PSJ6, data=pathname+timestamp)`

### Get Unread Conversations

```
GET /messenger/v2/rpc/get_recent_conversations?limit=20&filter=UNREAD&verify=<hmac>
Authorization: Bearer <wapi_token>
```

**Response**:
```json
{
  "success": true,
  "data": {
    "count": 548,
    "results": [{
      "id": "uuid-conv-id",
      "type": "DIRECT",
      "channel_slug": "bidinisreal",
      "recipient": {
        "id": "uuid",
        "tevi_user_alias": 3290169952,
        "channel_slug": "bidinisreal",
        "name": "Bidinisreal",
        "is_my_subscriber": false
      },
      "latest_message": {
        "id": "uuid",
        "type": "TEXT",
        "text": "kapan live",
        "created_at": 1782308067930
      },
      "stats": { "unread_messages": 2 }
    }]
  }
}
```

### Get Conversation + Messages

```
GET /messenger/v2/conversation/{uuid}/?verify=<hmac>
Authorization: Bearer <wapi_token>
```

**Response**:
```json
{
  "data": {
    "id": "uuid",
    "messages": [{
      "id": "uuid",
      "sender": { "alias": "3290169952", "name": "Bidinisreal" },
      "type": "TEXT",
      "text": "kapan live",
      "images": [],
      "created_at": 1782308067930
    }]
  }
}
```

### Send Message

```
POST /messenger/v2/message/?verify=<hmac>
Authorization: Bearer <wapi_token>
Content-Type: application/json

{
  "conversation_id": "uuid",
  "type": "TEXT",
  "parser": "PLAIN",
  "text": "Halo aku Sukii..."
}
```

**Response**: `200 OK` atau `{"success": true}`

### Mark Read

```
POST /messenger/v2/conversation/{uuid}/read/?verify=<hmac>
Authorization: Bearer <wapi_token>
Content-Type: application/json
{}
```

---

## HMAC Verify Signature

**Key**: `PRDKqnSNCKrMDF9hAt0PSJ6` (from tevi.com JS bundle)

**Formula**: `HMAC-SHA256(key, pathname + timestamp)` → base64 → `timestamp-signature`

**JS Implementation** (Web Crypto API — works in Service Worker):
```javascript
async function computeVerifyAsync(url) {
  const pathname = new URL(url).pathname;
  const timestamp = Math.floor(Date.now() / 1000);
  const data = pathname + timestamp;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode('PRDKqnSNCKrMDF9hAt0PSJ6'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timestamp + '-' + b64;
}
```

**Important**: `/auth/v1/token/` endpoint does NOT need `?verify=`. Only Messenger API calls need it.

---

## AI System

### Olagon Gateway

- **URL**: `https://gateway.olagon.site/anthropic`
- **Edge Function**: `https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger`
- **Model**: `claude-sonnet-4-6`
- **Rate Limit**: 20 calls/min per IP

### AI Rules (Sukii v0.9.7)

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

#### Psikologi — User Belum Pernah Bayar
```
Kalau user tanya offline/BO/ketemu tapi belum pernah VCS
→ "Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?"
```

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

### tevi_api_endpoints
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| method | text | GET/POST/PUT/DELETE |
| path | text | API path |
| full_url | text | Full URL |
| host | text | Domain |
| discovered_at | timestamptz | When discovered |

---

## Version History

| Version | Date | Status | Notes |
|---|---|---|---|
| v0.9.12 | 2026-06-26 | **WORKING** | DIRECT API mode: token capture + Messenger v2 API |
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
2. Reload extension (di edge://extensions/)
3. Buka tab Tevi.com/messages
4. CS otomatis capture token dari localStorage
5. Check log: `[AUTH] Tevi token received from CS: uid=392388705`

### 4. Set AI Key
Buka popup → tab **Keys** → masukkan Olagon key → Save

### 5. Toggle ON
Popup → toggle → ON

### 6. Watch Log
```bash
pwsh -Command "Get-Content 'tevi-cs-logs.txt' -Tail 30 -Wait"
```

---

## Known Issues

| Issue | Cause | Status |
|---|---|---|
| Firebase anonymous → wapi token fails | HMAC verify mismatch | WORKAROUND: skip HMAC for /auth/v1/token/ |
| Token captured from localStorage | CS runs in Tevi tab context | **SOLUTION**: CS captures, sends to BG |
| Supabase tevi_auth_tokens wrong columns | Old migration | FIXED: use correct columns (no uid/refresh_token/updated_at) |

---

## Reference

### Auth Flow Diagram
```
Tevi Tab (already logged in)
    │
    │ CS reads localStorage['user_logged_list']
    │ Extracts access_token + refresh_token
    │
    ▼
BG receives TEVI_TOKEN message
    │
    ├─► Save to chrome.storage.local
    ├─► Sync to Supabase tevi_auth_tokens
    ├─► Use token for Messenger API calls
    │
    ▼
Messenger API v2
    │
    ├─► GET /messenger/v2/rpc/get_recent_conversations?filter=UNREAD
    ├─► GET /messenger/v2/conversation/{id}/
    ├─► POST /messenger/v2/message/ (send DM)
    └─► POST /messenger/v2/conversation/{id}/read/
```

### Cross-Reference
- **babyval-autopilot/tevi-api/tevi-dm-sniff.json**: Full network capture with Messenger v2 endpoints
- **babyval-autopilot/tevi-api/tevi-api-client.js**: Node.js client with auth flow
- **wapi.flowstreamx.com**: API base domain
- **PRDKqnSNCKrMDF9hAt0PSJ6**: HMAC sign key (from tevi.com JS bundle)
- **WAPI_SIGN_KEY**: `PRDKqnSNCKrMDF9hAt0PSJ6`
