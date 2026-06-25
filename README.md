# babyval-extension — Tevi CS Bot

Edge/Chrome MV3 extension untuk otomatisasi Tevi CS (Customer Service) bot @cutieval (UID=392388705).

## Arsitektur

```
tevi-cs/
├── manifest.json      # MV3 manifest v0.6.2
├── background.js      # Service Worker: polling, HMAC, API, state machine
├── content-script.js  # DOM automation: idle/reply state machine
├── overlay.js         # Cute cat overlay (sleep/alert/typing animation)
├── popup/popup.html   # Rules editor UI
├── log-server.js      # Local HTTP log receiver
└── icons/
```

## State Machine

```
IDLE (tevi.com/messages)
  ↓ poll detects unread
REPLY (tevi.com/@slug/messages)
  ↓ send message
60s delay → return to IDLE
```

- **Idle**: di `tevi.com/messages` → deteksi pesan masuk via API polling (3 menit)
- **Reply**: navigasi otomatis ke DM → ketik → kirim → 60 detik → auto-kembali
- **Idle Check**: pastikan tidak ada pesan yang belum Sukii balas (dalam 24 jam terakhir)

## Flow Bot

```
Pesan masuk → Greeting (intro_sent)
  ↓ user balas (dalam 180 menit)
CS mode → reply sesuai keyword rules
  ↓ max turns (3) → loop greeting
  ↓ idle 30 menit → done
  ↓ payment proof detected → silent end
```

**Sukii Must Be Last Replier** — semua pesan harus Sukii terakhir balas, KECUALI:
1. Membership — never touch
2. Payment confirmed — 6 jam delay
3. User diam >24 jam — boleh balas

## Keyword Rules (Cold/Informant Tone)

| Priority | Trigger | Reply |
|---|---|---|
| 50 | Alamat, no HP, WA, umur | `Informasi pribadi tidak diberikan.` |
| 45 | ketemu, offline | `Cuma bisa VCS. Offline tidak tersedia.` |
| 40 | cara vcs, payment | `1. Buka babyval.com\n2. Pilih Video Call\n3. Pilih Durasi\n4. Bayar` |
| 35 | beda 7 dan 10 menit | `Beda durasi aja. Squirt minimal 20 menit.` |
| 35 | masker | `Buka masker: tip 250rb ke ganknow.com/babyval/tip.` |
| 30 | vcs, videocall | `VCS tersedia. babyval.com → Video Call → Durasi → Bayar.` |
| 25 | ngobrol aja | `Chat langsung: membership Tevi.` |
| 20 | payment, transfer | `babyval.com → Video Call → Durasi → Bayar.` |
| 20 | join member | `tevi.com/@cutieval. Pilih membership.` |
| 15 | order, beli | `babyval.com. Pilih layanan, bayar, kirim bukti.` |
| 15 | foto, video, konten | `Konten untuk member.` |
| 10 | bot, sukii | `Sukii. Informan Baby Val.` |
| 5 | terima kasih | `Sukii. Ada yang perlu ditanyakan.` |
| 1 | inappropriate | `Di luar layanan.` |
| 0 | fallback | `Chat langsung dengan Baby Val: membership Tevi.` |

## Greeting

```
Sukii. Informan Baby Val.
Chat langsung: membership Tevi.
VCS: babyval.com
```

## Auto-Recovery (DOM Send)

1. Direct send
2. CS injection + retry (3s wait)
3. CS injection + retry (2s wait)
4. Hard refresh + navigate + retry

## Auto-Reload (Development)

File changes trigger automatic extension reload via CDP:

```bash
cd tevi-cs
npm install        # install ws + chokidar
node auto-reloader.js
```

`auto-reloader.js` watches all extension files. On change → CDP → `__TEVI_RELOAD__` → `chrome.runtime.reload()` → new code active. No manual reload needed.

> Auto-reloader auto-launches Edge with `--remote-debugging-port=9222` if not already running.

## Setup

### 1. Start Log Server
```bash
cd C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
node log-server.js
```

### 2. Load Extension
```
edge://extensions/ → Developer mode → Load unpacked
Pilih: C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
```

### 3. Setup
1. Buka tab Tevi → login
2. Extension icon → Keys tab → masukkan AI key + HMAC secret → Save
3. Toggle ON

## Active Hours

Aktif: **17:00 - 05:00 WIB**

## Changelog

### v0.6.2 — 2026-06-26
- Fix: track intro_sent/cs convs via getMessages even after greeting drops them from UNREAD filter
- Idle refresh every 10s on messages page for new chat detection
- Poll loop checks tracked conversations for user replies
- Auto-reloader: CDP-based extension reload on file changes — no manual reload needed

### v0.6.1 — 2026-06-25
- Idle/Reply state machine: auto-return to messages after 60s
- Cold tone: semua reply dingin, informatif
- Sukii-last-replier: skip reply jika Sukii sudah terakhir balas
- Payment proof silent end
- Overlay kucing: CSS animated cat
