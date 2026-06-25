# babyval-extension

Edge/Chrome extension untuk otomatisasi Tevi CS (Customer Service) bot.

> Port dari `babyval-autopilot/tevi-cs` (Node.js/Playwright) ke browser extension (MV3). Tidak perlu login flow, token capture lebih reliable, tidak ada Cloudflare issue.

## Fitur

- **Auto-reply DM** — Balas pesan masuk otomatis dengan template VCS/Casual
- **5 Classifier** — Member ignore, VCS keyword, casual chat, long idle, first chat
- **2-Tier Reply Rule** — Reply sekali, subsequent messages hanya mark read
- **Active Hours** — Aktif jam 17:00 - 05:00, closed jam 05:00-17:00
- **Poll Interval** — 3 menit via `chrome.alarms`
- **Status Popup** — Toggle on/off, info last poll, conversation count

## Arsitektur

```
babyval-extension/
├── CLAUDE.md              # Development rules
├── README.md              # Dokumen ini
├── tevi-cs/               # Extension Tevi CS Bot
│   ├── manifest.json       # MV3 manifest
│   ├── background.js      # Service Worker: polling, HMAC, API calls, logging
│   ├── content-script.js  # Inject ke tevi.com: token capture + logging
│   ├── overlay.js         # Floating overlay (right-bottom) — auto-appears on tevi.com
│   ├── log-server.js      # Local HTTP server: receives logs → writes file
│   ├── package.json       # Node dependencies (untuk log-server)
│   ├── popup/
│   │   ├── popup.html    # Status UI + diagnostic
│   │   └── popup.js      # Popup logic + diagnose + view logs
│   └── icons/            # Extension icons (16, 48, 128)
└── [future extensions as sibling folders]
```

## Remote Debugging System

Extension POST semua log ke `localhost:3131` (log-server.js) → saya (Claude) baca log untuk debug & fix.

### Flow Debug:
```
background.js (Service Worker)
  → POST /log → log-server.js
    → Write ke tevi-cs-logs.txt
      → Saya Read file → Fix issues
```

### Log Server Endpoints:
```
POST /log    — Send single log entry
POST /batch  — Send multiple entries
GET  /logs   — Read recent logs (count=N param)
GET  /logs?count=50 — Read last 50 lines
GET  /health — Server health check
GET  /clear  — Clear log file
```

### Popup Diagnostic:
Popup punya button **🔍 Diagnose** yang menampilkan:
1. Log server status
2. Extension storage state
3. Tevi tab status
4. Token capture result
5. Recent 10 log entries

Semua dalam popup — kamu tidak perlu buka DevTools manual.

## Perbedaan dengan tevi-cs (Node.js)

| Aspek | tevi-cs | babyval-extension |
|---|---|---|
| Login | Playwright automation | Tidak perlu (browser session) |
| Token capture | page.on('response') race | localStorage inject sync |
| Cloudflare | Browser wait 20s | Tidak ada |
| Poll mechanism | setInterval | chrome.alarms |
| State | JSON file | chrome.storage.local |
| Browser | Separate Chromium | Edge session sendiri |

## Auth Strategy

Extension membaca `localStorage['user_logged_list']` dari tab Tevi yang sudah logged in:

1. `chrome.scripting.executeScript` ke tab Tevi
2. Baca dan parse localStorage → extract `access_token`
3. Return token ke background
4. Background: HMAC sign + fetch `wapi.flowstreamx.com`

HMAC secret: `PRDKqnSNCKrMDF9hAt0PSJ6`
HMAC algorithm: SHA-256 + Base64, signed string = `pathname + timestamp`

## Classifier Logic

| Condition | Action | Template |
|---|---|---|
| `is_member` (is_my_subscriber: true) | IGNORE | — |
| `is_vcs_ask` (keyword VCS/private/call) | REPLY | VCS |
| `is_first_chat` (new conv) | REPLY | VCS |
| `is_long_idle` (>6hr) | REPLY | CASUAL |
| `is_casual` (short/emoji/keyword) | REPLY | CASUAL |
| `repliedOnce[convId]` exists | MARK READ ONLY | — |

## Reply Templates

**VCS:**
```
vcs available💕
bisa payment ke web https://babyval.com/
➡️ Pilih videocall
Jangan lupa kirim bukti tf ke dm

AKU BALAS CHAT KHUSUS MEMBER ATAU SUDAH PAYMENT VCS
```

**CASUAL:**
```
Hai! 💕 Untuk request konten eksklusif atau VCS, bisa via:
1. Join membership: tevi.com/@cutieval
2. Payment VCS: babyval.com → pilih videocall
Terima kasih! 🙏
```

## Setup & Installation

### 1. Start Log Server (WAJIB — untuk debugging)
```bash
cd C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
npm install  # atau: node log-server.js langsung
node log-server.js
# Server running on http://localhost:3131
```

### 2. Load Extension di Edge
```
edge://extensions/
→ Aktifkan "Developer mode"
→ Klik "Load unpacked"
→ Pilih folder: C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
```

### 3. Setup
- Buka tab Tevi (`tevi.com`) dan login manual
- Klik extension icon → popup
- Klik **Aktifkan** toggle
- Klik **🔍 Diagnose** untuk verify semuanya working

### 4. Debug
- Popup → **🔍 Diagnose** button: Full diagnostic report
- Popup → **📋 View Logs** button: Last 50 log entries
- Log file: `tevi-cs/tevi-cs-logs.txt`

## Permissions

| Permission | Alasan |
|---|---|
| `alarms` | Polling interval 3 menit (MV3 compliant) |
| `storage` | State persistence (repliedOnce, config) |
| `scripting` | Programmatic injection ke tab Tevi |
| `activeTab` | Inject content script ke tab Tevi |
| `host_permissions: wapi.flowstreamx.com` | API calls |
| `host_permissions: tevi.com` | Tab access, inject script |

## Bot Identity

```js
MY_UID=392388705
MY_SLUG=cutieval
MY_CHANNEL_ID=a605781b-dc88-441d-a3d0-654b075ec...
```

## Known Limitations

- Browser harus terbuka (extension hanya jalan saat Edge aktif)
- User harus logged in di tab Tevi
- MV3 Service Worker max 30s execution — dipantau via alarms
- Tidak support multiple account simultaneous

## Changelog

### v0.1.0.2 — 2026-06-25
- **Floating Overlay**: Right-bottom FAB button muncul otomatis di tevi.com, collapsible panel dengan toggle, stats, Poll button, Logs viewer
- **Token Persistent**: Token disimpan ke `chrome.storage.local` — persist setelah SW restart, popup tidak lagi "No Token"
- **Probe API**: Button di popup untuk test multiple endpoint alternatives

### v0.1.1 — 2026-06-25
- **Remote debugging system**: Extension POST logs ke localhost:3131 (log-server.js)
- Popup: Diagnostic button, View Logs button, Log server status indicator
- Content script: Full DIAGNOSE message handler
- Background: Enhanced logging dengan ERROR/DEBUG levels
- Log server: Node.js HTTP server → writes ke tevi-cs-logs.txt
