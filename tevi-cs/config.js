/**
 * CONFIG SYSTEM — Tevi CS Bot v0.5.1.0
 * All bot behavior is driven by a JSON config stored in chrome.storage.local
 * Key: tevi_cs_config
 */

const CONFIG_KEY = 'tevi_cs_config';

/**
 * DEFAULT CONFIG — editable via popup
 * Priority: first matching rule wins
 */
const DEFAULT_CONFIG = {
  version: 1,

  // ── PERSONA ──────────────────────────────────────────────────────────
  persona: {
    name: 'Sukii',
    owner: 'Baby Val',
    greeting: `Perkenalkan dulu 👋\nHalo aku Sukii, AI Assistant milik Baby Val\nKalau mau Chat dengan Baby Val Membership dulu yaa..\n\nKalau mau VCS bisa lakukan pembayaran ke babyval.com`,
    tone: 'friendly', // friendly | professional | playful
  },

  // ── RULES ─────────────────────────────────────────────────────────────
  // Each rule: { id, priority, type, match, reply, active }
  // type: 'keyword' | 'redirect' | 'block' | 'fallback'
  // match: string (comma-separated keywords)
  // reply: string (template, use {name} for sender name)
  rules: [
    {
      id: 'vcs',
      priority: 10,
      type: 'keyword',
      match: 'vcs,videocall,video call,vc ,telfon,telpon,call,meet,zoom',
      reply: `VCS available 💕\nBisa payment ke https://babyval.com/\n➡️ Pilih Video Call\nJangan lupa kirim bukti TF ke DM\n\nAKU BALAS KHUSUS MEMBER ATAU SUDAH PAYMENT VCS`,
      active: true,
    },
    {
      id: 'payment',
      priority: 10,
      type: 'keyword',
      match: 'payment,bayar,tf,transfer,donasi,donate,harga,price,berapa,cost',
      reply: `Untuk payment VCS:\n1. Buka https://babyval.com/\n2. Pilih Video Call\n3. Transfer ke rekening yang tertera\n4. Kirim bukti TF ke DM ini\n\nAku balas setelah payment terkonfirmasi ✅`,
      active: true,
    },
    {
      id: 'join_member',
      priority: 10,
      type: 'keyword',
      match: 'join,member,membership,subscribe,langganan,premium',
      reply: `Mau jadi member Baby Val?\nKunjungi: tevi.com/@cutieval\nPilih membership yang tersedia.\nSetelah join, kamu bisa chat langsung dengan Baby Val! 💕`,
      active: true,
    },
    {
      id: 'order',
      priority: 10,
      type: 'keyword',
      match: 'jual,beli,jasa,order,pembelian,buy',
      reply: `Untuk order:\n1. Buka https://babyval.com/\n2. Pilih layanan yang diinginkan\n3. Lakukan payment\n4. Kirim bukti ke DM\n\nAku bantu proses setelah payment masuk ✅`,
      active: true,
    },
    {
      id: 'konten',
      priority: 10,
      type: 'keyword',
      match: 'foto,video,konten,pic,image,send,kirim,eksklusif',
      reply: `Konten eksklusif tersedia untuk member!\nJoin membership di tevi.com/@cutieval\natau cek di https://babyval.com/ untuk pilihan konten 💕`,
      active: true,
    },
    {
      id: 'bot_sukii',
      priority: 10,
      type: 'keyword',
      match: 'bot,sukii,siapa kamu,siapa ini,ai,assistant',
      reply: `Aku Sukii, AI Assistant-nya Baby Val 💕\nAku bantu menjawab pertanyaan dan mengarahkan kamu ke layanan yang tepat.\nAda yang bisa aku bantu?`,
      active: true,
    },
    {
      id: 'terima_kasih',
      priority: 10,
      type: 'keyword',
      match: 'terima kasih,thanks,thx,makasih,ok,oke,sip,sipp,bagus,nice',
      reply: `Sama-sama! 💕 Kalau ada pertanyaan lagi, jangan ragu chat ya~`,
      active: true,
    },
    {
      id: 'redirect_ig',
      priority: 5,
      type: 'redirect',
      match: 'instagram,ig,freshlive,fresh',
      reply: `Untuk info lebih lanjut, cek:\n📱 Instagram: @babyval_official\n🌐 babyval.com\n\nAtau tanya di sini, aku bantu! 💕`,
      active: true,
    },
    {
      id: 'block',
      priority: 1,
      type: 'block',
      match: 'sexs,cari pacar,kelamin,nude,bugil,porno,sara,politik,judi,slot',
      reply: `Maaf ya, topik itu di luar layanan yang bisa aku bantu 💕\nCoba tanyakan soal VCS, membership, atau konten Baby Val ya~`,
      active: true,
    },
    {
      id: 'fallback',
      priority: 0,
      type: 'fallback',
      match: '',
      reply: `Maaf ya, aku Sukii AI Assistant-nya Baby Val 💕\nAku hanya bisa bantu untuk:\n• Info VCS / Video Call\n• Cara join membership\n• Payment & order\n• Info konten eksklusif\n\nCoba tanya yang berkaitan dengan layanan di atas ya~`,
      active: true,
    },
  ],

  // ── BEHAVIOR ──────────────────────────────────────────────────────────
  behavior: {
    introWaitMinutes: 180,    // minutes to wait after intro before CS mode (3h)
    csMaxTurns: 3,           // max AI replies per conversation before marking done
    idleMinutes: 30,         // minutes of no reply = conversation done
    readAfterReply: true,    // mark as read after sending
    aiEnabled: false,        // use AI (Olagon) or just keyword templates
    dryRun: false,           // don't actually send, just log
  },

  // ── LIMITS ────────────────────────────────────────────────────────────
  // What NOT to say
  forbidden: [
    'no hp',
    'nomor hp',
    'wa ',
    'whatsapp',
    'alamat rumah',
    'kluarkan pakaian',
    'telanjang',
  ],
};

// ── CONFIG CRUD ───────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const d = await chrome.storage.local.get(CONFIG_KEY);
    const cfg = d[CONFIG_KEY];
    if (!cfg) return { ...DEFAULT_CONFIG };
    // Merge with defaults (preserve user edits, add new fields)
    return deepMerge({ ...DEFAULT_CONFIG }, cfg);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(cfg) {
  try { await chrome.storage.local.set({ [CONFIG_KEY]: cfg }); } catch {}
}

// ── MATCHING ─────────────────────────────────────────────────────────────
function matchRule(text, rule) {
  if (!rule.active || !text) return false;
  if (rule.type === 'fallback') return true; // fallback always matches last
  const keywords = rule.match.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function findReply(text, rules) {
  // Sort by priority (higher first)
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (matchRule(text, rule)) {
      return rule;
    }
  }
  return null;
}

// ── HELPERS ─────────────────────────────────────────────────────────────
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function formatReply(template, senderName) {
  return template.replace(/{name}/g, senderName || 'kak');
}

// ── AI ENRICHMENT ────────────────────────────────────────────────────────
async function aiEnrich(baseReply, context) {
  // If AI is disabled, return base reply
  const cfg = context.cfg;
  if (!cfg.behavior?.aiEnabled) return baseReply;

  const sec = await getSecrets();
  const key = sec?.aiKey;
  if (!key) return baseReply;

  const SYSTEM = `Kamu Sukii, AI Assistant milik Baby Val. Ubah jawaban template ini jadi lebih natural dan conversational dalam Bahasa Indonesia. Pertahankan informasi pentingnya tapi buat lebih friendly dan sesuai konteks. Max 3 kalimat, pakai emoji 💕.`;

  try {
    const resp = await fetch('https://gateway.olagon.site/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Template: "${baseReply}"\nSender bertanya: "${context.message}"` }],
        temperature: 0.7,
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      return json.content?.[0]?.text?.trim() || baseReply;
    }
  } catch {}
  return baseReply;
}

// ── VALIDATE ─────────────────────────────────────────────────────────────
function validateConfig(cfg) {
  const errors = [];
  if (!cfg.persona?.name) errors.push('Persona name required');
  if (!Array.isArray(cfg.rules)) errors.push('Rules must be array');
  return errors;
}

export {
  DEFAULT_CONFIG,
  CONFIG_KEY,
  loadConfig,
  saveConfig,
  findReply,
  formatReply,
  matchRule,
  validateConfig,
  aiEnrich,
};
