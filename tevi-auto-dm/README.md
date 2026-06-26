# tevi-auto-dm — Tevi CS Bot (Playwright)

Permanent Playwright browser + Direct API send. Bot CS otomatis untuk @cutieval di Tevi.com.

## Setup

```bash
cd tevi-auto-dm
npm install
```

## Konfigurasi

Edit `config.js`:
- `CHROMIUM_PATH` — path ke Chrome executable
- `EMAIL` / `PASSWORD` — credentials Tevi
- `AI_KEY` — Olagon API key (optional, fallback template jika kosong)

## Jalankan

```bash
node bot.js           # Live — bot akan mengirim pesan
node bot.js --dry    # Dry run — tidak mengirim pesan
```

## Log

```bash
type bot.log
```

## Architecture

```
tevi-auto-dm/
├── bot.js       # Main loop — scan, filter, reply
├── api.js       # Playwright browser + API calls
├── config.js    # Credentials, timing, active hours
├── state.json   # Idempotency state (auto-created)
└── bot.log      # Log output
```

## Flow

```
1. Launch Chromium (permanent — stays open)
2. Login ke tevi.com (once)
3. Capture wapi token dari browser context
4. Every 3 min:
   a. GET /get_recent_conversations?filter=ALL
   b. Filter: skip own-conv, i-sent-last, no-unread, >24h, subscribers
   c. GET /get_messages per conv → extract user messages
   d. Slot decision (1=greeting, 2-4=reply)
   e. AI reply (Supabase Edge Function) → fallback template
   f. POST /send_message via browser (has cf_clearance cookie)
   g. POST /mark_read
5. Sleep 3 min → repeat
```

## Active Hours

Bot hanya reply jam **17:00–05:00 WIB** (UTC 10:00–22:00). Scan tetap jalan tiap 3 menit tapi skip reply di luar jam aktif.

## AI Reply System

- AI key di set di `config.js` sebagai `AI_KEY`
- Jika AI_KEY kosong → pakai keyword matching template
- Supabase Edge Function: `https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger`

## AI Training Rules (Sukii)

### BOLEH DIJAWAB
| Topic | Jawaban |
|---|---|
| Cara membership | Buka profile Baby Val → Join Membership |
| Cara VCS | babyval.com → Video Call → Durasi → Bayar |
| Payment | babyval.com → VCS → Bayar (Dana/OVO/transfer) |
| Open masker | Boleh open masker. Tambah 350k. |
| Full open | Buka semua kecuali masker. Buka masker tambah 350k. |
| Benefit membership | Masuk live gratis, konten terbuka, chat kapanpun |
| Ketemu offline | "Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?" |

### TIDAK BOLEH DIJAWAB
| Topic | Jawaban |
|---|---|
| Alamat/no HP/WA | "Informasi pribadi tidak diberikan." |
| Kirim konten langsung | "Konten untuk member." |
| Chat tidak pantas | "Kalau mau chat sama Baby Val, membership dulu ya." |

## Bot Identity

- **UID:** 392388705 (cutieval)
- **HMAC Key:** `PRDKqnSNCKrMDF9hAt0PSJ6`
- **API Base:** `https://wapi.flowstreamx.com`

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/messenger/v2/rpc/get_recent_conversations?filter=ALL` | List convs |
| GET | `/messenger/v2/rpc/get_messages?conversation_id={uuid}` | Get messages |
| **POST** | **`/messenger/v2/rpc/send_message`** | **Send message** |
| POST | `/messenger/v2/conversation/{id}/read` | Mark read |

## Send Payload

```json
{
  "conversation_id": "uuid",
  "input_text": "reply text",
  "msg_type": "TEXT",
  "parser": "PLAIN"
}
```
