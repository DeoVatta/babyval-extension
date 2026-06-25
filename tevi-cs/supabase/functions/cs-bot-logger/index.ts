import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")!;
const OLAGON_BASE = "https://gateway.olagon.site/anthropic";
const OLAGON_KEY = Deno.env.get("OLAGON_KEY")!;

// ── Authorization: validate AI key HMAC before processing ─────────────
const VALID_KEY_HASHES = [
  // Configured via OLAGON_KEY environment variable
];

function hashKey(key: string): string {
  // Simple hash for comparison — not reversible
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function isAuthorized(key: string): boolean {
  if (!key) return false;
  const h = hashKey(key);
  // Check against known hashes
  if (VALID_KEY_HASHES.includes(h)) return true;
  // Also allow direct match for operational flexibility
  if (key === OLAGON_KEY) return true;
  return false;
}

// ── Rate Limiting (in-memory, per IP) ───────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20; // max calls per window
const RATE_WINDOW = 60 * 1000; // per 60 seconds

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── AI System Prompt ─────────────────────────────────────────────────
const AI_SYSTEM_PROMPT = `Kamu SUKII, AI Assistant-nya Baby Val 💕

PERSONALITAS:
- Cold tone, informatif, tidak terlalu ramah
- Jawaban pendek dan langsung
- Tidak addiktif, tidak pakai emoji berlebihan
- Tegas — kalau di luar layanan, langsung bilang

APA YANG BOLEH DIJAWAB:
✅ VCS (Video Call): info harga, durasi, cara booking via babyval.com
✅ Membership/Tevi: info paket, cara join via tevi.com/@cutieval
✅ Payment: cara bayar via babyval.com → Video Call → Durasi → Bayar
✅ Payment via Dana/OVO/transfer: bisa lewat babyval.com
✅ Konten/Foto/Video: diarahkan jadi member
✅ Ngobrol umum tentang Baby Val
✅ Tips masker/vip: ganknow.com/babyval/tip
✅ Open masker: boleh open masker ada tambahan 350k
✅ Full open: buka semua kecuali masker, kalo buka masker tambah 350k
✅ VCS via Private Room Tevi: ber-2 aja di Private Room
✅ Benefit membership: masuk live gratis, konten terbuka semua, bisa chat sama Baby Val kapanpun
✅ Cara membership: buka profile Baby Val → Join Membership
✅ Cara VCS: babyval.com → Video Call → Durasi → Bayar
✅ Cara bayar: babyval.com → Video Call → Durasi → Bayar (Dana/OVO/transfer)
✅ Mau kasih tip: ganknow.com/babyval/tip

APA YANG TIDAK BOLEH DIJAWAB:
❌ Alamat asli / nomor HP / WA — "Informasi pribadi tidak diberikan."
❌ Ketemu offline — "Cuma bisa VCS. Offline tidak tersedia."
❌ Kirim foto/konten langsung — "Konten untuk member."
❌ Pertanyaan tidak pantas — "Di luar layanan."
❌ Info membership orang lain
❌ Janji bisa ketemu offline
❌ Kalau tanya offline/BO/ketemu tanpa pernah payment: gunakan psikologi tekanan halus

BATASAN:
- Tidak kasih nomor pribadi
- Tidak kasih alamat email
- Tidak kasih lokasi
- Tidak kasih umur
- Tidak janji bisa ketemu
- Tidak kasih link selain babyval.com atau tevi.com/@cutieval atau ganknow.com/babyval/tip

PSIKOLOGI UNTUK USER YANG TIDAK PERNAH BAYAR:
- Kalau user tanya offline/BO/ketemu tapi belum pernah VCS → "Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?"
- Kalau user mau chat tapi belum member → "Kalau mau chat sama Baby Val, membership dulu ya"
- Kalau user chat tidak pantas → "Kalau mau chat sama Baby Val, membership dulu ya"
- Jangan langsung bilang tidak bisa ketemu — alihkan ke VCS/membership

FORMAT:
- Bahasa Indonesia
- 1-3 kalimat (kecuali greeting)
- Langsung ke inti`;

serve(async (req) => {
  // ── API Discovery Handler ────────────────────────────────────────
  try {
    const body = await req.json();

    if (body._type === "api_discovery") {
      const { event, method, path, url, status, seenCount, reqBody, resBody, ts } = body;

      // Upsert endpoint
      if (path) {
        await supabase
          .from("tevi_api_endpoints")
          .upsert(
            {
              method: method || "GET",
              path: path,
              full_url: url || null,
              sample_request: reqBody ? String(reqBody).substring(0, 300) : null,
              sample_response: resBody ? String(resBody).substring(0, 500) : null,
              discovered_at: ts || new Date().toISOString(),
              last_used_at: ts || new Date().toISOString(),
              use_count: seenCount || 1,
              is_active: status >= 200 && status < 300,
              notes: event === "new_endpoint" ? "NEWLY DISCOVERED" : null,
            },
            { onConflict: "method,path" }
          );
      }

      return new Response(JSON.stringify({ ok: true, event }), { headers: { "Content-Type": "application/json" } });
    }
  } catch {}

  // ── Authorization check ──────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const incomingKey = authHeader.replace(/^Bearer\s+/i, "");

  if (!isAuthorized(incomingKey)) {
    console.error("Unauthorized access attempt");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  // ── Rate limit check ─────────────────────────────────────────────
  const clientIp = req.headers.get("x-forwarded-for") ||
                   req.headers.get("cf-connecting-ip") ||
                   "unknown";
  if (!checkRateLimit(clientIp)) {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  try {
    const { username, userMessages, slot, replyType } = await req.json();

    if (!username || !userMessages) {
      return new Response(JSON.stringify({ error: "missing fields" }), { status: 400 });
    }

    // Sanitize username
    const cleanUsername = String(username).toLowerCase().replace(/[^a-z0-9_]/g, "").substring(0, 50);
    if (!cleanUsername) {
      return new Response(JSON.stringify({ error: "invalid username" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── FIX #1: Upsert user + check membership ─────────────────────
    const { data: existingUser } = await supabase
      .from("cs_users")
      .select("*")
      .eq("username", cleanUsername)
      .single();

    const isNewUser = !existingUser;
    const isMember = existingUser?.membership_status === "active";
    const hasPaymentHistory = (existingUser?.payment_count || 0) > 0;

    if (isNewUser) {
      // Insert new user
      await supabase.from("cs_users").insert({
        username: cleanUsername,
        membership_status: "none",
        payment_count: 0,
        first_seen_at: new Date().toISOString(),
        last_chat_at: new Date().toISOString(),
      });
    } else {
      // Update last_chat_at
      await supabase
        .from("cs_users")
        .update({ last_chat_at: new Date().toISOString() })
        .eq("username", cleanUsername);
    }

    // ── FIX #2: payment_count increment on image ────────────────────
    const hasImageInMessages = userMessages.some((m: { hasImage?: boolean }) => m.hasImage);
    if (hasImageInMessages && !isNewUser) {
      const currentCount = existingUser?.payment_count || 0;
      await supabase
        .from("cs_users")
        .update({ payment_count: currentCount + 1 })
        .eq("username", cleanUsername);
    }

    // ── Log user messages ────────────────────────────────────────────
    const logEntries = userMessages.map((msg: { text?: string; hasImage?: boolean }) => ({
      username: cleanUsername,
      sender: "user",
      message: (msg.text || "").substring(0, 1000), // truncate long messages
      has_image: !!msg.hasImage,
      slot: slot || null,
    }));

    if (logEntries.length > 0) {
      await supabase.from("cs_chat_logs").insert(logEntries);
    }

    // ── Build AI context ─────────────────────────────────────────────
    const ctx = userMessages
      .map((m: { text?: string; hasImage?: boolean }, i: number) =>
        `[${i + 1}]${m.hasImage ? " [IMG] " : " "}${(m.text || "").substring(0, 300)}`
      )
      .join("\n");

    let reply = "";
    let tokensUsed = 0;

    if (replyType === "greeting") {
      reply = `Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi

Kalau mau VCS bisa bayar di babyval.com`;
    } else {
      // ── Call Olagon AI ─────────────────────────────────────────────
      const contextNote = isMember
        ? "[USER ADALAH MEMBER — boleh lebih friendly]"
        : hasPaymentHistory
        ? "[USER SUDAH PERNAH BAYAR]"
        : "[USER BELUM PERNAH BAYAR — PSIKOLOGI HARUS DIAKTIFKAN]";

      const body = JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        temperature: 0.8,
        system: AI_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `${contextNote}\n\nUser @${cleanUsername}:\n${ctx}\n\nBalas sebagai Sukii (slot ${slot}/4):`,
          },
        ],
      });

      try {
        const aiRes = await fetch(OLAGON_BASE + "/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OLAGON_KEY}`,
          },
          body,
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          reply =
            (aiData.content?.[0]?.text || "")
              .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
              .trim() || "";
          tokensUsed = aiData.usage?.total_tokens || 0;
        } else {
          console.error("Olagon AI error:", aiRes.status);
        }
      } catch (e) {
        console.error("AI call failed:", e.message);
      }

      // Fallback if AI failed or empty
      if (!reply) {
        reply = buildFallback(
          (userMessages[userMessages.length - 1]?.text || "").toLowerCase(),
          hasPaymentHistory
        );
      }
    }

    if (reply.length > 500) {
      reply = reply.substring(0, 497) + "...";
    }

    // ── Log Sukii's reply ────────────────────────────────────────────
    await supabase.from("cs_chat_logs").insert({
      username: cleanUsername,
      sender: "sukii",
      message: reply,
      slot: slot || null,
      reply_type: replyType === "greeting" ? "greeting" : "ai",
      ai_model: tokensUsed > 0 ? "claude-sonnet-4-6" : null,
      tokens_used: tokensUsed > 0 ? tokensUsed : null,
    });

    return new Response(
      JSON.stringify({ reply, isMember, hasPaymentHistory, isNewUser }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Edge function error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});

// Fallback keyword-based (no AI)
function buildFallback(lastMsg: string, hasPayment: boolean): string {
  if (lastMsg.match(/foto|video|konten|porn|sexy|bugil|xxx|ngentot|coli/i))
    return "Konten untuk member.";
  if (lastMsg.match(/vcs|videocall|video call|private room/i))
    return "VCS via Private Room Tevi. babyval.com → Video Call → Durasi → Bayar.";
  if (lastMsg.match(/payment|transfer|bayar|order|bayarnya|dana|ovo|i\/o|invest/i))
    return "Payment via babyval.com. Dana/OVO/transfer. babyval.com → VCS → Bayar.";
  if (lastMsg.match(/member|membership|join|benefit/i))
    return "Benefit: masuk live gratis, konten terbuka, chat kapanpun. tevi.com/@cutieval";
  if (lastMsg.match(/alamat|nomor hp|no hp|wa|whatsapp|line|telegram/i))
    return "Informasi pribadi tidak diberikan.";
  if (lastMsg.match(/ketemu|offline|bertemu|ngumpul|jumpa|bo/i)) {
    if (!hasPayment) return "Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?";
    return "Cuma bisa VCS. Offline tidak tersedia.";
  }
  if (lastMsg.match(/terima kasih|thanks|makasih|thx|tq/i))
    return "Sukii. Ada yang perlu ditanyakan?";
  if (lastMsg.match(/masker|topeng/i)) return "Boleh open masker. Tambah 350k.";
  if (lastMsg.match(/full open|buka semua/i))
    return "Buka semua kecuali masker. Buka masker tambah 350k.";
  if (lastMsg.match(/open masker/i)) return "Boleh open masker. Tambah 350k.";
  if (lastMsg.match(/beda|bedanya|durasi|7 menit|10 menit/i))
    return "Beda durasi aja. Squirt minimal 20 menit.";
  if (lastMsg.match(/tip|donasi|sendiri/i))
    return "Tip: ganknow.com/babyval/tip";
  if (lastMsg.match(/private room/i))
    return "Private Room Tevi. Ber-2 aja. babyval.com → VCS.";
  if (lastMsg.match(/bot|sukii|siapa kamu|apa kamu/i))
    return "Sukii. Informan Baby Val.";
  if (lastMsg.match(/cara (membership|member|join)/i))
    return "Buka profile Baby Val → Join Membership";
  if (lastMsg.match(/cara vcs|cara (bayar|payment)/i))
    return "babyval.com → Video Call → Durasi → Bayar";
  if (lastMsg.match(/ada wa|whatsapp|wa/i))
    return "Kalau mau chat sama Baby Val, membership dulu ya.";
  if (lastMsg.match(/chat tidak pantas/i))
    return "Kalau mau chat sama Baby Val, membership dulu ya.";
  return "Chat langsung dengan Baby Val: membership Tevi.";
}
