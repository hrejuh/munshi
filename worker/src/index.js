// Munshi on Cloudflare Workers: a port of bot.py (Telegram webhook + KV) with two-way voice.
// Secrets: TELEGRAM_TOKEN, ELEVENLABS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, TELEGRAPH_TOKEN, WEBHOOK_SECRET.
// KV binding: DB. Keys: shop:<sid>, order:<oid>, sess:<chat>, owner:<chat> -> sid, index:shops, index:orders, upd:<update_id>.

import { TEMPLATES } from "./templates.js";
import { qrSvg } from "./qr.js";

const ADMIN = 1238521561;
const IST_MS = 5.5 * 3600 * 1000;
const VOICE_ID = "cgSgspJ2msm6clMCkdW9";
const COMMANDS = [
  { command: "shop", description: "My shop" }, { command: "orders", description: "Orders" },
  { command: "sales", description: "Sales" }, { command: "web", description: "Manage on the web" },
  { command: "new", description: "New shop" },
];
let BOT_NAME = null;

// ---------- worker entry ----------

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.startsWith("/tg/")) {
      if (!env.WEBHOOK_SECRET || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
        return new Response("forbidden", { status: 403 });
      let u;
      try { u = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
      ctx.waitUntil(handleUpdate(u, env));
      return new Response("ok");
    }
    if (req.method === "GET" && url.pathname === "/setup") {
      if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET)
        return new Response("forbidden", { status: 403 });
      const c = { env };
      const hook = await tgRaw(c, "setWebhook", {
        url: `${url.origin}/tg/${env.WEBHOOK_SECRET}`, secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      const cmds = await tgRaw(c, "setMyCommands", { commands: COMMANDS });
      // refresh every shop's Telegraph page so its links follow PUBLIC_URL
      const pc = { env, st: new Store(env.DB), bg: [] };
      ctx.waitUntil((async () => { pc.bot = await botName(pc); for (const [sid] of await allShops(pc)) await publishPage(pc, sid); })());
      // never echo the webhook url back: it contains the secret
      return Response.json({ setWebhook: { ok: hook.ok, description: hook.description }, setMyCommands: { ok: cmds.ok, description: cmds.description } });
    }
    if (req.method === "GET" && url.pathname === "/login") return loginPage(env);
    if (req.method === "POST" && url.pathname === "/api/login") return loginApi(req, env);
    if (url.pathname === "/wa-templates") {
      if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      if (!env.MSG91_AUTH_KEY || !env.MSG91_WHATSAPP_NUMBER) return Response.json({ error: "MSG91_AUTH_KEY / MSG91_WHATSAPP_NUMBER not set" });
      const r = await fetch(`https://control.msg91.com/api/v5/whatsapp/get-template-client/${env.MSG91_WHATSAPP_NUMBER}`, { headers: { authkey: env.MSG91_AUTH_KEY } });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.startsWith("/m/") || url.pathname.startsWith("/api/m/")) return manageRoute(req, env, url, ctx);
    if (req.method === "POST" && url.pathname.startsWith("/api/order/")) return orderApi(req, env, dec(url.pathname.slice(11)));
    if (req.method === "POST" && url.pathname.startsWith("/api/talk/")) return talkApi(req, env, dec(url.pathname.slice(10)));
    if (req.method === "GET" && (url.pathname.startsWith("/o/") || url.pathname.startsWith("/api/o/"))) return statusRoute(env, url);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/s/")))
      return webPage(env, url.pathname === "/" ? null : decodeURIComponent(url.pathname.slice(3)));
    return new Response("not found", { status: 404 });
  },
};

export async function handleUpdate(u, env) {
  const st = new Store(env.DB);
  if (u.update_id != null) {
    const k = `upd:${u.update_id}`;
    if (await env.DB.get(k)) return;
    await env.DB.put(k, "1", { expirationTtl: 3600 });
  }
  const c = { env, st, voice: false, bg: [], speech: [] };
  try {
    c.bot = await botName(c);
    const m = u.message;
    console.log(`update ${m ? Object.keys(m).filter(k => ["text", "voice", "audio", "contact", "location"].includes(k)).join(",") : "callback"} ${((m && m.text) || (u.callback_query && u.callback_query.data) || "").slice(0, 40)}`);
    if (m) {
      c.voice = !!(m.voice || m.audio);
      await onMessage(c, m);
    } else if (u.callback_query) {
      await onCallback(c, u.callback_query);
    }
  } catch (e) {
    console.log("ERR", e && e.stack || e);
  }
  try { await Promise.all(c.bg); } catch (e) { console.log("bg ERR", e && e.stack || e); }
  try { await st.save(); } catch (e) { console.log("save ERR", e && e.stack || e); }
  await flushSpeech(c);
}

// ---------- storage: KV with a per-update cache; save() writes whatever changed ----------

class Store {
  constructor(kv) { this.kv = kv; this.cache = new Map(); this.orig = new Map(); }
  async get(key, dflt = null) {
    if (!this.cache.has(key)) {
      const raw = await this.kv.get(key);
      this.cache.set(key, raw == null ? dflt : JSON.parse(raw));
      this.orig.set(key, raw);
    }
    return this.cache.get(key);
  }
  set(key, v) { this.cache.set(key, v); }
  async save() {
    const ps = [];
    for (const [k, v] of this.cache) {
      if (v == null) continue;
      const j = JSON.stringify(v);
      if (j === this.orig.get(k) || (this.orig.get(k) == null && j === "{}")) continue;
      this.orig.set(k, j);
      ps.push(this.kv.put(k, j));
    }
    await Promise.all(ps);
  }
}

const save = c => c.st.save();
const sess = (c, chat) => c.st.get(`sess:${chat}`, {});
const getShop = (c, sid) => (sid ? c.st.get(`shop:${sid}`) : null);
const getOrder = (c, oid) => c.st.get(`order:${oid}`);

async function myShop(c, chat) {
  const sid = await c.st.get(`owner:${chat}`);
  const shop = sid ? await getShop(c, sid) : null;
  return shop ? [sid, shop] : [null, null];
}

async function addToIndex(c, key, id) {
  const ids = (await c.st.get(key, [])).slice();
  if (!ids.includes(id)) ids.push(id);
  c.st.set(key, ids);
}

async function allShops(c) {
  const ids = await c.st.get("index:shops", []);
  const shops = await Promise.all(ids.map(id => getShop(c, id)));
  return ids.map((id, i) => [id, shops[i]]).filter(x => x[1]);
}

async function allOrders(c) {
  const ids = await c.st.get("index:orders", []);
  const os = await Promise.all(ids.map(id => getOrder(c, id)));
  return ids.map((id, i) => [id, os[i]]).filter(x => x[1]);
}

function clearObj(o) { for (const k of Object.keys(o)) delete o[k]; }

// ---------- telegram ----------

async function tgRaw(c, method, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params || {}),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

async function tg(c, method, params) {
  const out = await tgRaw(c, method, params);
  if (!out.ok) console.log("TG ERR", method, JSON.stringify(out).slice(0, 300));
  return out.ok ? out.result : null;
}

// opts.speak: true speaks the message text, a string speaks that instead (only when the user sent a voice note)
async function send(c, chat, text, buttons = null, opts = {}) {
  const p = { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (buttons !== null) p.reply_markup = { inline_keyboard: buttons };
  const r = await tg(c, "sendMessage", p);
  if (opts.speak) speak(c, chat, opts.speak === true ? text : opts.speak);
  return r;
}

async function botName(c) {
  if (!BOT_NAME) {
    const me = await tg(c, "getMe", {});
    if (me) BOT_NAME = me.username;
  }
  return BOT_NAME || "Munshi_jiii_bot";
}

function rs(n) {
  n = Number(n);
  const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (Number.isInteger(n)) return "₹" + group(String(n));
  const [a, b] = n.toFixed(2).split(".");
  return "₹" + group(a) + "." + b;
}

function h(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

const shopLink = (c, sid) => `https://t.me/${c.bot}?start=s_${sid}`;
const PUBLIC_URL = "https://munshi.hrejuh.com";
const webLink = (shop, sid) => (shop && sid) ? `${PUBLIC_URL}/s/${sid}` : "";
const iname = it => it.local || it.name;
const shareText = (shop, sid) => `🏪 ${shop.shopName}${shop.area ? " · " + shop.area : ""}\nOrder online, pay cash on delivery:\n${webLink(shop, sid)}`;
const waShare = (shop, sid) => "https://wa.me/?text=" + encodeURIComponent(shareText(shop, sid));
const now = () => Date.now() / 1000;
const pad = n => String(n).padStart(2, "0");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const istDate = sec => new Date(sec * 1000 + IST_MS);
const hm = sec => { const d = istDate(sec); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
function istDayStart() {
  const d = istDate(now());
  d.setUTCHours(0, 0, 0, 0);
  return (d.getTime() - IST_MS) / 1000;
}
function randChars(chars, k) { let s = ""; for (let i = 0; i < k; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s; }
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const wordChars = s => s.replace(/[^\p{L}\p{N}_]/gu, "");
const dec = s => { try { return decodeURIComponent(s); } catch { return ""; } };
function randCode(k = 8) { // unguessable: the status link is the only thing protecting a web order
  const A = "abcdefghjkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(k));
  return [...b].map(x => A[x % A.length]).join("");
}

// ---------- understanding speech and text ----------

function b64(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function transcribe(c, fileId) {
  const t0 = Date.now();
  const f = await tg(c, "getFile", { file_id: fileId });
  if (!f) throw new Error("getFile failed");
  const audio = await (await fetch(`https://api.telegram.org/file/bot${c.env.TELEGRAM_TOKEN}/${f.file_path}`)).arrayBuffer();
  const fd = new FormData();
  fd.append("model_id", "scribe_v1");
  fd.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": c.env.ELEVENLABS_API_KEY }, body: fd, signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`stt ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const GEM = c.env.GEMINI_API_KEY;
  if (!(j.text || "").replace(/\[[^\]]*\]|[^\p{L}\p{N}_]/gu, "") && GEM) {
    try {
      const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEM}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "audio/ogg", data: b64(audio) } },
          { text: "Transcribe this voice note exactly, in its original language and script. Return only the words. If there is no speech, return nothing." }] }] }),
      });
      if (!g.ok) throw new Error(`gemini ${g.status}`);
      j.text = (await g.json()).candidates[0].content.parts[0].text.trim();
      console.log("  stt fallback: gemini");
    } catch (e) {
      console.log(`  stt fallback failed: ${String(e).slice(0, 100)}`);
    }
  }
  console.log(`  stt ${((Date.now() - t0) / 1000).toFixed(1)}s lang=${j.language_code} bytes=${audio.byteLength} text=${JSON.stringify((j.text || "").slice(0, 120))}`);
  return (j.text || "").trim();
}

async function openrouter(c, prompt) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`openrouter ${r.status}`);
  const txt = (await r.json()).choices[0].message.content.trim();
  return JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim());
}

async function gemini(c, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${c.env.GEMINI_API_KEY}`, {
    method: "POST", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  return JSON.parse((await r.json()).candidates[0].content.parts[0].text);
}

const hasLLM = c => !!(c.env.OPENROUTER_API_KEY || c.env.GEMINI_API_KEY);

// JSON from an LLM: OpenRouter first (fast, reliable), Google AI Studio as fallback.
async function geminiJson(c, prompt) {
  let last = null;
  for (const [name, fn, on] of [["openrouter", openrouter, c.env.OPENROUTER_API_KEY], ["gemini", gemini, c.env.GEMINI_API_KEY]]) {
    if (!on) continue;
    const t0 = Date.now();
    try {
      const out = await fn(c, prompt);
      console.log(`  ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return out;
    } catch (e) {
      console.log(`  ${name} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(e).slice(0, 120)}`);
      last = e;
    }
  }
  throw last || new Error("no LLM configured");
}

const ITEMS_PROMPT = `You help an Indian neighbourhood shop list its products. The shopkeeper said the text below, possibly in Kannada, Hindi, Tamil, English or a mix, possibly transliterated.
Return only a JSON array: [{"name": English product name, "local": product name in the shopkeeper's own language and script, or "" if they spoke English, "price": number in rupees, "unit": short unit like "1 kg", "500 ml", "each"}]. Skip anything without a price.

{history}Shopkeeper said:
`;

const CLEAN_PROMPT = `A shopkeeper answered "{q}" by voice or text. Return only JSON {"value": the answer cleaned up, in its original script, without filler words}.

Answer: `;

function num(x) {
  const n = typeof x === "number" ? x : parseFloat(String(x));
  if (Number.isNaN(n)) throw new Error(`not a number: ${x}`);
  return n;
}

function cleanItem(i) {
  return { name: String(i.name ?? ""), local: String(i.local ?? ""), price: num(i.price), unit: String(i.unit ?? "") };
}

async function parseItems(c, text) {
  if (hasLLM(c)) {
    try {
      let out = await geminiJson(c, ITEMS_PROMPT + text);
      out = Array.isArray(out) ? out : (out && out.items) || [];
      return out.filter(i => i && ![null, undefined, "", 0].includes(i.price)).map(cleanItem);
    } catch (e) {
      console.log("parse_items", e && e.stack || e);
    }
  }
  const items = [];
  for (const part of text.split(/[,\n;।.]+(?!\d)/)) {
    const m = part.match(/^\s*(.+?)\s*(?:-|:|₹|rs\.?|rupaye|rupees)?\s*(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees|₹)?\s*$/i);
    if (m && m[1].trim()) items.push({ name: m[1].trim(), local: "", price: parseFloat(m[2]), unit: "" });
  }
  return items;
}

async function clean(c, q, text) {
  if (hasLLM(c)) {
    try {
      const out = await geminiJson(c, fill(CLEAN_PROMPT, { q }) + text);
      return String((out && out.value) || text).trim().slice(0, 60);
    } catch (e) {
      console.log("clean", e && e.stack || e);
    }
  }
  return text.trim().slice(0, 60);
}

// Text of a message, transcribing voice notes. Returns null if nothing usable.
async function heard(c, m, chat) {
  if (m.text) return m.text.trim();
  const v = m.voice || m.audio;
  if (!v) return null;
  if (!c.env.ELEVENLABS_API_KEY) {
    await send(c, chat, "Voice is off right now. Please type it.");
    return null;
  }
  await tg(c, "sendChatAction", { chat_id: chat, action: "typing" });
  let t;
  try {
    t = await transcribe(c, v.file_id);
  } catch (e) {
    console.log("transcribe", e && e.stack || e);
    await send(c, chat, "Couldn't hear that. Try again, or type it.", null, { speak: true });
    return null;
  }
  t = t.replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/^[ .।]+|[ .।]+$/g, "");
  if (wordChars(t).length < 2) {
    await send(c, chat, "🎧 Couldn't catch that. Please say it again, closer to the phone, or type it.", null, { speak: true });
    return null;
  }
  await send(c, chat, `🎧 <i>${h(t)}</i>`);
  return t;
}

// ---------- two-way voice: reply with a voice note when the user spoke ----------

function speak(c, chat, text) {
  if (!c.voice || !c.env.ELEVENLABS_API_KEY || !text) return;
  c.speech.push({ chat, text });
}

function ttsText(s) {
  let t = String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/₹\s?([\d,]+(?:\.\d+)?)/g, "$1 rupees")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}︎️‍⃣✓•→←↺☝]/gu, " ")
    .replace(/×/g, " ")
    .replace(/\s+/g, " ").trim();
  if (t.length > 300) {
    const cut = t.slice(0, 300);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("। "));
    t = end > 120 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : 300);
  }
  return t;
}

async function flushSpeech(c) {
  // merge everything said to the same chat in this update into one voice note, sent after the text
  const byChat = new Map();
  for (const { chat, text } of c.speech) byChat.set(chat, [...(byChat.get(chat) || []), text]);
  for (const [chat, texts] of byChat) {
    try {
      const t = ttsText(texts.join(" "));
      if (!wordChars(t)) continue;
      await tg(c, "sendChatAction", { chat_id: chat, action: "record_voice" });
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
        method: "POST", signal: AbortSignal.timeout(20000),
        headers: { "xi-api-key": c.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: t, model_id: "eleven_multilingual_v2" }),
      });
      if (!r.ok) throw new Error(`tts ${r.status} ${(await r.text()).slice(0, 200)}`);
      const mp3 = await r.arrayBuffer();
      const fd = new FormData();
      fd.append("chat_id", String(chat));
      fd.append("voice", new Blob([mp3], { type: "audio/mpeg" }), "munshi.mp3");
      const out = await (await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_TOKEN}/sendVoice`, { method: "POST", body: fd })).json();
      if (!out.ok) console.log("sendVoice ERR", JSON.stringify(out).slice(0, 300));
    } catch (e) {
      console.log("tts failed", String(e).slice(0, 200));
    }
  }
}

// ---------- delivery (Qrave model: Rs 52 up to 3 km, Rs 11/km after; shop passes it on or absorbs it) ----------

function km(a, b) {
  const r = x => (x * Math.PI) / 180;
  const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map(r);
  const x = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x)) * 1.3; // road distance is roughly 1.3x straight line
}

function deliveryFee(shop, loc) {
  if (!shop.loc || !loc) return [52.0, null];
  const d = km(shop.loc, loc);
  return [52 + Math.max(0, Math.round(d - 3 + 0.49)) * 11, d];
}

// ---------- shopkeeper ----------

async function startOnboarding(c, chat) {
  const s = await sess(c, chat);
  clearObj(s);
  Object.assign(s, { step: "ob_name", draft: {} });
  await save(c);
  await send(c, chat, "🏪 <b>What's your shop called?</b>\n🎙 speak or type", null,
    { speak: "Welcome to Munshi. What's your shop called?" });
}

function itemsSummary(items, limit = 30) {
  return items.slice(0, limit).map(i => `• ${h(iname(i))}${i.unit ? " · " + h(i.unit) : ""} — ${rs(i.price)}`).join("\n");
}

const DONE_BTN = [[{ text: "✅ Open my shop", callback_data: "ob_done" }]];
const ITEMS_BTNS = [[{ text: "📋 Template", callback_data: "tpl" }], ...DONE_BTN];
const MAX_ITEMS = 60; // a Telegram keyboard holds 100 buttons; the catalogue keeps one per item
const LANGS = [["kn", "ಕನ್ನಡ"], ["hi", "हिन्दी"], ["ta", "தமிழ்"], ["en", "English"]];

// Up to `room` items from a starter catalogue, spread evenly across it so every group shows up.
function templateItems(cat, lang, room = MAX_ITEMS) {
  const t = TEMPLATES[cat];
  if (!t || !(room > 0)) return [];
  const all = t.items, n = Math.min(room, all.length), out = [];
  for (let k = 0; k < n; k++) {
    const it = all[Math.floor((k * all.length) / n)];
    out.push({ name: it.name, local: (lang && it.local[lang]) || "", price: it.price, unit: it.unit });
  }
  return out;
}

async function onboardingStep(c, chat, s, m) {
  const step = s.step;
  const d = (s.draft = s.draft || {});
  if (step === "ob_phone") {
    const phone = (m.contact || {}).phone_number || m.text || "";
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length < 10) return send(c, chat, "10-digit number, please.", null, { speak: true });
    d.phone = digits;
    s.step = "ob_loc";
    await save(c);
    return tg(c, "sendMessage", { chat_id: chat, text: "📍 Shop location?",
      reply_markup: { keyboard: [[{ text: "📍 Send shop location", request_location: true }], [{ text: "Skip" }]],
        resize_keyboard: true, one_time_keyboard: true } });
  }
  if (step === "ob_loc") {
    if (m.location) d.loc = [m.location.latitude, m.location.longitude];
    s.step = "ob_items";
    await save(c);
    await tg(c, "sendMessage", { chat_id: chat, text: "✓", reply_markup: { remove_keyboard: true } });
    return send(c, chat, "🎙 <b>What do you sell?</b>\n<i>chai 15, samosa 20</i>",
      ITEMS_BTNS, { speak: "What do you sell? Say items with prices." });
  }
  const t = await heard(c, m, chat);
  if (!t) return;
  if (step === "ob_name") {
    d.shopName = await clean(c, "What's your shop called?", t);
    s.step = "ob_area";
    await save(c);
    return send(c, chat, `<b>${h(d.shopName)}</b> ✓\n📍 <b>Area?</b>`, null, { speak: true });
  }
  if (step === "ob_area") {
    d.area = await clean(c, "Which area is your shop in?", t);
    s.step = "ob_phone";
    await save(c);
    const text = `📞 WhatsApp number?`;
    speak(c, chat, text);
    return tg(c, "sendMessage", { chat_id: chat, text,
      reply_markup: { keyboard: [[{ text: "📱 Share my number", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  if (step === "ob_items") {
    await tg(c, "sendChatAction", { chat_id: chat, action: "typing" });
    const fresh = await parseItems(c, t);
    if (!fresh.length) return send(c, chat, "No prices heard. Try <i>rice 60</i>", null, { speak: true });
    d.items = (d.items || []).concat(fresh);
    await save(c);
    return send(c, chat, `Added ${fresh.length} · <b>${d.items.length}</b> total\n${itemsSummary(fresh, 10)}`, ITEMS_BTNS,
      { speak: `Added ${fresh.length}. Say more, or tap done.` });
  }
}

// Onboarding, items step: pick a starter catalogue, then the language for local names.
async function applyTemplate(c, chat, s, cat, lang) {
  if (s.step !== "ob_items") return;
  const t = TEMPLATES[cat];
  if (!t) return send(c, chat, "📋 <b>Pick a template</b>",
    Object.entries(TEMPLATES).map(([k, v]) => [{ text: `${v.label.en} · ${v.items.length}`, callback_data: `tpl:${k}` }]));
  if (!lang) return send(c, chat, `📋 ${h(t.label.en)}: local names in?`,
    [LANGS.map(([code, label]) => ({ text: label, callback_data: `tpl:${cat}:${code}` }))]);
  const d = (s.draft = s.draft || {});
  const fresh = templateItems(cat, lang, MAX_ITEMS - (d.items || []).length);
  if (!fresh.length) return send(c, chat, `You have ${MAX_ITEMS} items already.`, DONE_BTN);
  d.items = (d.items || []).concat(fresh);
  await save(c);
  return send(c, chat, `📋 Added ${fresh.length} from ${h(t.label.en)} · <b>${d.items.length}</b> total\n${itemsSummary(fresh, 6)}${fresh.length > 6 ? "\n…" : ""}`, ITEMS_BTNS);
}

async function finishOnboarding(c, chat) {
  const s = await sess(c, chat);
  const d = s.draft || {};
  if (!(d.items && d.items.length)) return send(c, chat, "Add an item first.");
  let sid = (d.shopName || "shop").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "shop";
  sid += randChars("abcdefghijklmnopqrstuvwxyz", 3);
  const shop = { shopName: d.shopName || "My shop", area: d.area || "", phone: d.phone || "", items: d.items.slice(0, 60),
    owner: chat, createdAt: now(), loc: d.loc || null, feeBy: "customer" };
  c.st.set(`shop:${sid}`, shop);
  c.st.set(`owner:${chat}`, sid);
  await addToIndex(c, "index:shops", sid);
  clearObj(s);
  await save(c);
  await publishPage(c, sid);
  console.log(`SHOP ${sid} ${d.shopName} items=${d.items.length}`);
  await send(c, chat, `🎉 <b>${h(d.shopName)}</b> is live`, await homeButtons(c, sid, shop), { speak: `${d.shopName} is open.` });
  return;
}

async function dashboard(c, chat) {
  (await sess(c, chat)).shop = null;
  const [sid, shop] = await myShop(c, chat);
  if (!shop) return startOnboarding(c, chat);
  const today = await sales(c, sid, true);
  return send(c, chat, `🏪 <b>${h(shop.shopName)}</b> · today ${today.n} · ${rs(today.total)}\n🎙 <i>say "chai 12 kar do"</i>`,
    await homeButtons(c, sid, shop));
}

// Everything works in chat; the web dashboard opens inside Telegram as a mini app.
async function homeButtons(c, sid, shop) {
  return [[{ text: "🌐 Manage on web", web_app: { url: await manageLink(c.env, sid) } }],
    [{ text: "➕ Add", callback_data: "add" }, { text: "✏️ Edit", callback_data: "edit" }, { text: "📦 Orders", callback_data: "orders" }],
    [{ text: "📊 Sales", callback_data: "sales" }, { text: "🛵 Delivery", callback_data: "dlv" }, { text: "📤 Share", callback_data: "share" }]];
}

async function shareCatalogue(c, chat) {
  const [sid, shop] = await myShop(c, chat);
  if (!shop) return;
  const q = encodeURIComponent;
  await tg(c, "sendMessage", { chat_id: chat, text: `🏪 ${shop.shopName}${shop.area ? " · " + shop.area : ""}\n${webLink(shop, sid)}`,
    reply_markup: { inline_keyboard: [[{ text: "🛒 Order", url: webLink(shop, sid) }]] } });
  return send(c, chat, "☝️ Forward it, or:",
    [[{ text: "🟢 WhatsApp", url: "https://wa.me/?text=" + q(`${shop.shopName}\n${webLink(shop, sid)}`) }],
     [{ text: "✈️ Telegram", url: "https://t.me/share/url?url=" + q(webLink(shop, sid)) + "&text=" + q(shop.shopName) }],
     [{ text: "← Back", callback_data: "home" }]]);
}

async function deliverySettings(c, chat) {
  const [, shop] = await myShop(c, chat);
  if (!shop) return;
  const who = (shop.feeBy || "customer") === "customer" ? "customer pays" : "you absorb it";
  return send(c, chat, `🛵 <b>Delivery</b>\n₹52 up to 3 km, then ₹11 per km.\nFee: <b>${who}</b>\nShop location: <b>${shop.loc ? "set" : "not set (flat ₹52)"}</b>`,
    [[{ text: "🔁 Customer pays / I absorb", callback_data: "feeby" }],
     [{ text: "📍 Set shop location", callback_data: "setloc" }],
     [{ text: "← Back", callback_data: "home" }]]);
}

async function sales(c, sid, todayOnly = false) {
  const start = istDayStart();
  const os = (await allOrders(c)).map(x => x[1]).filter(o => o.shop === sid && o.status !== "declined" && (!todayOnly || o.at >= start));
  const tally = {};
  for (const o of os) for (const [name, q] of o.lines) tally[name] = (tally[name] || 0) + q;
  return { n: os.length, total: os.reduce((a, o) => a + o.total, 0), top: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5) };
}

async function showSales(c, chat) {
  const [sid, shop] = await myShop(c, chat);
  if (!shop) return;
  const t = await sales(c, sid, true), a = await sales(c, sid);
  const top = a.top.map(([n, q]) => `• ${h(n)} × ${q}`).join("\n") || "—";
  return send(c, chat, `📊 <b>Sales</b>\n\nToday: <b>${t.n}</b> orders · <b>${rs(t.total)}</b>\nAll time: ${a.n} orders · ${rs(a.total)}\n\n<b>Best sellers</b>\n${top}`,
    [[{ text: "← Back", callback_data: "home" }]]);
}

async function showAdmin(c, chat) {
  const shops = await allShops(c);
  const allo = (await allOrders(c)).map(x => x[1]).filter(o => o.status !== "declined");
  const out = [`<b>Munshi</b> · ${shops.length} shops · ${allo.length} orders · ${rs(allo.reduce((a, o) => a + o.total, 0))}`];
  for (const [sid, sh] of shops) {
    const st = await sales(c, sid);
    const who = sh.ownerName || "";
    out.push(`\n<b>${h(sh.shopName)}</b> ${h(who)} · ${h(sh.area || "")}\n` +
      `${sh.items.length} items · ${st.n} orders · ${rs(st.total)}` + (sh.page ? `\n${sh.page}` : ""));
  }
  return send(c, chat, out.join("\n").slice(0, 4000));
}

async function showOrders(c, chat) {
  const [sid, shop] = await myShop(c, chat);
  if (!shop) return;
  const mine = (await allOrders(c)).filter(([, o]) => o.shop === sid).sort((a, b) => b[1].at - a[1].at).slice(0, 10);
  const icon = { new: "🟡", accepted: "✅", out: "🛵", completed: "✔", declined: "✖" };
  const body = mine.map(([k, o]) => `${icon[o.status] || ""} #${k} · ${rs(o.total)} · ${hm(o.at)}`).join("\n") || "No orders yet.";
  return send(c, chat, `📦 <b>Orders</b>\n\n${body}`, [[{ text: "← Back", callback_data: "home" }]]);
}

async function showEdit(c, chat) {
  const [, shop] = await myShop(c, chat);
  if (!shop) return;
  const rows = shop.items.map((it, i) => [{ text: `${iname(it)} · ${rs(it.price)}`, callback_data: `it:${i}` }]);
  return send(c, chat, "✏️ Tap an item", rows.concat([[{ text: "← Back", callback_data: "home" }]]));
}

// Messages from a shopkeeper outside onboarding: add items or set a price.
async function ownerText(c, chat, s, m) {
  const [sid, shop] = await myShop(c, chat);
  const step = s.step || "";
  if (step.startsWith("price:")) {
    const t = await heard(c, m, chat);
    if (!t) return;
    const nums = t.match(/\d+(?:\.\d+)?/g);
    if (!nums) return send(c, chat, "Send just the new price, like 65.", null, { speak: true });
    const i = parseInt(step.split(":")[1], 10);
    const it = shop.items[i];
    s.step = null;
    if (!it) return dashboard(c, chat);
    it.price = parseFloat(nums[0]);
    await save(c);
    c.bg.push(publishPage(c, sid));
    await send(c, chat, `✓ ${h(iname(it))} is now ${rs(nums[0])}`, null, { speak: true });
    return dashboard(c, chat);
  }
  const t = await heard(c, m, chat);
  if (!t) return;
  await tg(c, "sendChatAction", { chat_id: chat, action: "typing" });
  let plan;
  try {
    plan = await geminiJson(c, fill(OWNER_PROMPT, {
      shop: shop.shopName, items: catalogueText(shop),
      today: JSON.stringify(await sales(c, sid, true)), alltime: JSON.stringify(await sales(c, sid)) }) + t);
  } catch (e) {
    console.log("owner llm", e && e.stack || e);
    plan = { actions: [{ type: "add", items: await parseItems(c, t) }], reply: "" };
  }
  plan = plan && typeof plan === "object" ? plan : {};
  console.log(`  owner plan ${JSON.stringify(plan).slice(0, 300)}`);
  const { notes, show } = applyOwnerPlan(shop, plan);
  if (notes.length) {
    await save(c);
    c.bg.push(publishPage(c, sid));
  }
  const reply = h(plan.reply || "");
  const body = [reply, notes.join("\n")].filter(Boolean).join("\n") || "👍";
  await send(c, chat, body, [[{ text: "🏪 My shop", callback_data: "home" }]], { speak: plan.reply || false });
  const fn = { sales: showSales, orders: showOrders, edit: showEdit, items: showEdit, dashboard }[show];
  if (fn) await fn(c, chat);
}

function applyOwnerPlan(shop, plan) {
  const notes = [], removals = [];
  let show = null;
  for (const a of plan.actions || []) {
    const kind = a && a.type;
    try {
      if (kind === "add") {
        const fresh = (a.items || []).filter(i => i && i.price).map(cleanItem);
        shop.items.push(...fresh);
        if (fresh.length) notes.push(`➕ ${fresh.map(i => h(iname(i))).join(", ")}`);
      } else if (kind === "price") {
        const it = shop.items[parseInt(a.index, 10)];
        if (!it) throw new Error("bad index");
        it.price = num(a.price);
        notes.push(`💰 ${h(iname(it))} → ${rs(it.price)}`);
      } else if (kind === "remove") {
        const i = parseInt(a.index, 10);
        if (Number.isNaN(i)) throw new Error("bad index");
        removals.push(i);
      } else if (kind === "show") {
        show = a.what;
      }
    } catch (e) {
      console.log("owner action", String(e));
    }
  }
  for (const i of [...new Set(removals)].sort((a, b) => b - a)) {
    if (i >= 0 && i < shop.items.length) notes.push(`🗑 ${h(iname(shop.items.splice(i, 1)[0]))}`);
  }
  return { notes, show };
}

function catalogueText(shop) {
  return shop.items.map((it, i) => `${i}. ${it.name} / ${it.local || "-"} / ${it.unit || "-"} / Rs ${it.price}`).join("\n") || "(no items yet)";
}

const OWNER_PROMPT = `You are Munshi, the assistant inside a Telegram bot that runs a small Indian shop's online orders. You are talking to the shopkeeper of "{shop}". They speak Kannada, Hindi, Tamil, English or a mix, by voice or text.

Their catalogue (index. English / local name / unit / price):
{items}

Sales today ("n" is number of orders, "total" is rupees, "top" is items sold): {today}
Sales all time: {alltime}

Work out what they want and return only JSON:
{"actions": [ ... ], "reply": "a short, warm reply in the same language and script they used, 1-2 sentences, stating what you did or answering their question"}
Possible actions:
 {"type":"add","items":[{"name":English,"local":name in their language/script or "","price":number,"unit":short unit}]}  - new products with prices
 {"type":"price","index":catalogue index,"price":number}  - change a price
 {"type":"remove","index":catalogue index}  - remove a product (sold out, not selling)
 {"type":"show","what":"sales"|"orders"|"items"|"dashboard"}  - when they ask to see something
Use no actions for greetings, questions you can answer from the data above, or small talk. Never invent products or prices they did not say. If something is ambiguous, ask in the reply and take no action.

Shopkeeper said:
`;

const BUYER_PROMPT = `You are Munshi, the shop assistant for "{shop}" ({area}), taking orders online. A customer is chatting with you in Kannada, Hindi, Tamil, English or a mix. Delivery is cash on delivery.

Catalogue (index. English / local name / unit / price):
{items}

Customer's cart now: {cart}

Return only JSON: {"add":[{"index":catalogue index,"qty":number}], "remove":[catalogue index], "checkout": true if they want to place the order now, "reply": "short friendly reply in the customer's language and script, 1-2 sentences"}
Never say the order is placed or confirmed: if checkout is true, say you need their name and address next. Only offer products in the catalogue. If they ask for something not listed, say so and suggest the closest item. Never invent prices.

{history}Customer said:
`;

const MODE_BTNS = [[{ text: "🛵 Home delivery", callback_data: "mode:delivery" }, { text: "🏃 I'll pick up", callback_data: "mode:pickup" }]];
const cartCount = cart => Object.values(cart).reduce((a, q) => a + q, 0);

async function buyerText(c, chat, s, m) {
  const sid = s.shop;
  const shop = await getShop(c, sid);
  const t = await heard(c, m, chat);
  if (!shop || !t) return;
  await tg(c, "sendChatAction", { chat_id: chat, action: "typing" });
  const cart = (s.cart = s.cart || {});
  const cartTxt = Object.entries(cart).filter(([i, q]) => q && +i < shop.items.length)
    .map(([i, q]) => `${q}x ${iname(shop.items[+i])}`).join(", ") || "empty";
  let plan;
  try {
    plan = await geminiJson(c, fill(BUYER_PROMPT, { shop: shop.shopName, area: shop.area || "", items: catalogueText(shop), cart: cartTxt, history: "" }) + t);
  } catch (e) {
    console.log("buyer llm", e && e.stack || e);
    return send(c, chat, "Tap the items below to add them.");
  }
  plan = plan && typeof plan === "object" ? plan : {};
  console.log(`  buyer plan ${JSON.stringify(plan).slice(0, 300)}`);
  for (const a of plan.add || []) {
    const i = parseInt(a && a.index, 10);
    if (Number.isNaN(i)) continue;
    if (i >= 0 && i < shop.items.length) cart[String(i)] = (cart[String(i)] || 0) + Math.max(1, parseInt(a.qty, 10) || 1);
  }
  for (const i of plan.remove || []) delete cart[String(i)];
  await save(c);
  await tg(c, "sendMessage", { chat_id: chat, text: plan.reply || "👍", reply_markup: catalogueMarkup(sid, shop, cart) });
  speak(c, chat, plan.reply);
  if (plan.checkout && cartCount(cart)) {
    s.step = null;
    await save(c);
    await send(c, chat, "How do you want it?", MODE_BTNS);
  }
}

// ---------- buyer ----------

function catalogueMarkup(sid, shop, cart) {
  const rows = shop.items.map((it, i) => {
    const q = cart[String(i)] || 0;
    return [{ text: `${q ? "✅ " + q + "× " : "+ "}${iname(it)}  ${rs(it.price)}`, callback_data: `a:${sid}:${i}` }];
  });
  const n = cartCount(cart);
  if (n) {
    const total = Object.entries(cart).filter(([i]) => +i < shop.items.length).reduce((a, [i, q]) => a + shop.items[+i].price * q, 0);
    rows.push([{ text: "↺ clear", callback_data: `x:${sid}` }, { text: `🛒 Order ${n} · ${rs(total)}`, callback_data: `c:${sid}` }]);
  }
  return { inline_keyboard: rows };
}

async function showShop(c, chat, sid) {
  const shop = await getShop(c, sid);
  if (!shop) return send(c, chat, "Shop not found.");
  const s = await sess(c, chat);
  Object.assign(s, { shop: sid, cart: {}, step: null });
  await save(c);
  return tg(c, "sendMessage", { chat_id: chat, parse_mode: "HTML",
    text: `🏪 <b>${h(shop.shopName)}</b>${shop.area ? " · " + h(shop.area) : ""}\n🎙 tap, or just say what you want`,
    reply_markup: { inline_keyboard: [[{ text: "🌐 Open full menu", web_app: { url: webLink(shop, sid) } }], ...catalogueMarkup(sid, shop, {}).inline_keyboard] } });
}

async function placeOrder(c, chat, s, phone) {
  const sid = s.shop, cart = s.cart || {};
  const shop = await getShop(c, sid);
  if (!shop) { s.step = null; return send(c, chat, "Shop not found."); }
  const lines = Object.entries(cart).filter(([i, q]) => q && +i < shop.items.length).map(([i, q]) => [shop.items[+i], q]);
  if (!lines.length) {
    s.step = null;
    return send(c, chat, "Your cart is empty.");
  }
  const mode = s.mode || "delivery";
  const oid = await newOrderId(c);
  const order = { shop: sid, buyer: chat, lines: lines.map(([it, q]) => [iname(it), q, it.price]),
    ...priceOrder(shop, lines, mode, s.loc), mode, loc: s.loc || null,
    address: s.address || "", phone, status: "new", at: now(), payment: "cod", paid: false };
  c.st.set(`order:${oid}`, order);
  await addToIndex(c, "index:orders", oid);
  Object.assign(s, { cart: {}, step: null, mode: null, loc: null });
  await save(c);
  const payWhen = mode === "delivery" ? "on delivery" : "at pickup";
  await tg(c, "sendMessage", { chat_id: chat, parse_mode: "HTML", reply_markup: { remove_keyboard: true },
    text: `🧾 <b>Order #${oid} sent</b>\n\n${orderBody(order)}\n<b>Total ${rs(order.total)}</b> · pay cash ${payWhen}` });
  speak(c, chat, `Order ${oid} sent. Total ${rs(order.total)}, pay cash ${payWhen}.`);
  await notifyOwner(c, oid, order, shop);
  console.log(`ORDER ${oid} shop=${sid} total=${order.total}`);
}

// lines: [[item, qty]] priced from the shop's own items
function priceOrder(shop, lines, mode, loc) {
  const subtotal = lines.reduce((a, [it, q]) => a + it.price * q, 0);
  const [fee, dist] = mode === "delivery" ? deliveryFee(shop, loc) : [0.0, null];
  const feeCharged = (shop.feeBy || "customer") === "customer" ? fee : 0.0;
  return { subtotal, fee, feeCharged, km: dist, total: subtotal + feeCharged };
}

async function newOrderId(c) {
  let oid;
  for (let t = 0; t < 5; t++) if (!(await getOrder(c, (oid = randChars("0123456789", 5))))) break;
  return oid;
}

function orderBody(o) {
  let body = o.lines.map(([n, q, p]) => `${q}× ${h(n)} — ${rs(p * q)}`).join("\n");
  if (o.mode === "delivery") body += `\n🛵 Delivery${o.km != null ? ` · ${o.km.toFixed(1)} km` : ""} — ${o.feeCharged ? rs(o.feeCharged) : "free"}`;
  else body += "\n🏃 Pickup from shop";
  return body;
}

// The owner's Telegram alert, the same for Telegram and web orders.
async function notifyOwner(c, oid, o, shop) {
  const who = [o.buyerName, o.address].filter(Boolean).join(", ");
  return send(c, shop.owner, `🔔 <b>New order #${oid}</b> · ${o.mode === "delivery" ? "🛵 delivery" : "🏃 pickup"}${o.source === "web" ? " · 🌐 web" : ""}\n\n${orderBody(o)}` +
    (o.mode === "delivery" && !o.feeCharged ? `\n(you absorb ${rs(o.fee)} delivery)` : "") +
    (o.payment === "upi" ? `\n💸 <b>${rs(o.total)} by UPI</b> · check your UPI app, then tap Mark paid` : `\n<b>Collect ${rs(o.total)}</b>`) + `\n\n🙋 ${h(who)}\n📞 ${h(o.phone)}` + (o.note ? `\n📝 ${h(o.note)}` : "") +
    (o.loc ? `\n🗺 https://maps.google.com/?q=${o.loc[0]},${o.loc[1]}` : ""),
    ownerButtons(oid, o));
}

// WhatsApp status updates to the buyer through MSG91, with the templates Qrave already has.
// Off until MSG91_AUTH_KEY and MSG91_WHATSAPP_NUMBER are set. Check params with /wa-templates?key=.
const WA_TEMPLATES = { accepted: "order_confirmed", completed: "order_delivered" };
async function waStatus(env, oid, o, sh) {
  const name = o.status === "out" ? (o.mode === "pickup" ? "order_ready" : "out_for_delivery") : WA_TEMPLATES[o.status];
  const to = String(o.buyerPhone || o.phone || "").replace(/\D/g, "").slice(-10);
  if (!name || to.length !== 10 || !env.MSG91_AUTH_KEY || !env.MSG91_WHATSAPP_NUMBER) return;
  const params = (env.MSG91_PARAMS || "name,shop,oid").split(",").map(k => ({ name: o.buyerName || "there", shop: (sh && sh.shopName) || "the shop", oid, total: rs(o.total) }[k.trim()] ?? ""));
  try {
    const r = await fetch("https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/", {
      method: "POST", signal: AbortSignal.timeout(10000), headers: { authkey: env.MSG91_AUTH_KEY, "content-type": "application/json" },
      body: JSON.stringify({ integrated_number: env.MSG91_WHATSAPP_NUMBER, content_type: "template", payload: {
        messaging_product: "whatsapp", type: "template", template: { name, language: { code: "en", policy: "deterministic" },
          to_and_components: [{ to: ["91" + to], components: Object.fromEntries(params.map((v, i) => [`body_${i + 1}`, { type: "text", value: String(v) }])) }] } } }),
    });
    console.log(`wa ${name} ${oid} ${r.status} ${(await r.text()).slice(0, 160)}`);
  } catch (e) { console.log("wa", String(e)); }
}

// Order life: new -> accepted -> out (out for delivery, or ready for pickup) -> completed; new -> declined.
// Like Arjun's lib/orders.ts: complete only once it is out/ready. Completed means the cash was collected.
const FLOW = {
  accept: { from: ["new"], to: "accepted" },
  decline: { from: ["new"], to: "declined" },
  out: { from: ["accepted"], to: "out" },
  complete: { from: ["out"], to: "completed" },
};
const outLabel = o => (o.mode === "pickup" ? "Ready for pickup" : "Out for delivery");
const STATUS_LABEL = { new: "New", accepted: "Accepted", out: "Out", completed: "Completed", declined: "Declined" };

function ownerButtons(oid, o) {
  const rows = statusButtons(oid, o);
  if (o.payment === "upi" && o.status !== "declined")
    rows.push([o.paid ? { text: "✓ UPI paid", callback_data: "home" } : { text: "💸 Mark paid", callback_data: `paid:${oid}` }]);
  return rows;
}

async function markPaid(c, sid, oid) {
  const o = await getOrder(c, oid);
  if (!o || o.shop !== sid) return { error: "Order not found." };
  if (o.payment !== "upi" || o.status === "declined") return { error: "Only UPI orders can be marked paid.", order: o };
  o.paid = true;
  o.paidAt = now();
  await save(c);
  console.log(`ORDER ${oid} paid`);
  return { order: o };
}

function statusButtons(oid, o) {
  if (o.status === "new") return [[{ text: "✅ Accept", callback_data: `ok:${oid}` }, { text: "✖ Can't", callback_data: `no:${oid}` }]];
  if (o.status === "declined") return [[{ text: "✖ Declined", callback_data: "home" }]];
  if (o.status === "completed") return [[{ text: "✔ Completed", callback_data: "home" }]];
  const rows = [[{ text: o.status === "out" ? `${o.mode === "pickup" ? "🏃" : "🛵"} ${outLabel(o)}` : "✅ Accepted", callback_data: "home" }]];
  rows.push(o.status === "accepted"
    ? [{ text: `${o.mode === "pickup" ? "🏃" : "🛵"} ${outLabel(o)}`, callback_data: `out:${oid}` }]
    : [{ text: "✔ Completed", callback_data: `done:${oid}` }]);
  return rows;
}

function buyerUpdate(shopName, oid, o) {
  const dlv = (o.mode || "delivery") === "delivery";
  return {
    accepted: `✅ ${h(shopName)} accepted order #${oid}. ` + (dlv ? "On its way 🛵" : "We'll keep it ready for pickup 🏃"),
    declined: `✖ ${h(shopName)} can't take order #${oid} right now.`,
    out: dlv ? `🛵 Order #${oid} from ${h(shopName)} is out for delivery.` : `🏃 Order #${oid} is ready for pickup at ${h(shopName)}.`,
    completed: `✔ Order #${oid} from ${h(shopName)} is complete. Thank you 🙏`,
  }[o.status];
}

// The owner moves an order on (from Telegram or the web). Returns { order } or { error }.
async function setStatus(c, sid, oid, action) {
  const o = await getOrder(c, oid);
  if (!o || o.shop !== sid) return { error: "Order not found." };
  const rule = FLOW[action];
  if (!rule) return { error: "Unknown action." };
  if (!rule.from.includes(o.status)) return { error: `Order #${oid} is ${(STATUS_LABEL[o.status] || o.status).toLowerCase()} already.`, order: o };
  o.status = rule.to;
  o.updated = now();
  await save(c);
  const sh = await getShop(c, sid);
  if (o.buyer) await send(c, o.buyer, buyerUpdate(sh ? sh.shopName : "The shop", oid, o));
  await waStatus(c.env, oid, o, sh);
  console.log(`ORDER ${oid} -> ${o.status}`);
  return { order: o };
}

async function cashToday(c, sid) {
  const start = istDayStart();
  return (await allOrders(c)).filter(([, o]) => o.shop === sid && o.status === "completed" && (o.updated || o.at) >= start)
    .reduce((a, [, o]) => a + o.total, 0);
}

// ---------- web orders: POST /api/order/<sid>, status at /o/<oid>?c=<code> ----------

async function orderApi(req, env, sid) {
  const c = { env, st: new Store(env.DB), bg: [] };
  const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
  if (softLimited(ORDER_HITS, req, 20)) return json({ error: "Too many orders. Wait a few minutes." }, 429);
  const shop = sid ? await getShop(c, sid) : null;
  if (!shop) return json({ error: "Shop not found." }, 404);
  const raw = await req.text();
  if (raw.length > 8000) return json({ error: "Order too big." }, 413);
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: "bad request" }, 400); }
  if (!b || typeof b !== "object") return json({ error: "bad request" }, 400);
  const lines = [], seen = new Set();
  for (const l of Array.isArray(b.lines) ? b.lines.slice(0, MAX_ITEMS) : []) {
    const i = parseInt(l && l.i, 10), q = Number(l && l.q), it = shop.items[i];
    if (!it || seen.has(i) || String(l.name || "") !== it.name) return json({ error: "The menu changed. Please refresh the page." }, 409);
    if (!Number.isInteger(q) || q < 1 || q > 99) return json({ error: "Quantity must be 1 to 99." }, 400);
    seen.add(i);
    lines.push([it, q]);
  }
  if (!lines.length) return json({ error: "Your cart is empty." }, 400);
  const mode = b.mode === "pickup" ? "pickup" : "delivery";
  let loc = null;
  if (mode === "delivery" && Array.isArray(b.loc) && b.loc.length === 2) {
    const [la, lo] = b.loc.map(Number);
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) loc = [la, lo];
  }
  const price = priceOrder(shop, lines, mode, loc);
  if (b.quote) return json(price);
  const one = (x, n) => String(x || "").replace(/\s+/g, " ").trim().slice(0, n);
  const name = one(b.name, 60), phone = String(b.phone || "").replace(/[^\d+]/g, "").slice(0, 15);
  const address = mode === "delivery" ? one(b.address, 200) : "", note = one(b.note, 200);
  if (!name) return json({ error: "Please add your name." }, 400);
  if (phone.replace(/\D/g, "").length < 10) return json({ error: "Please add a 10-digit phone number." }, 400);
  if (mode === "delivery" && address.length < 4) return json({ error: "Please add your delivery address." }, 400);
  c.bot = await botName(c);
  const oid = await newOrderId(c), code = randCode();
  const payment = b.payment === "upi" && shop.upi ? "upi" : "cod";
  const order = { shop: sid, buyer: null, lines: lines.map(([it, q]) => [iname(it), q, it.price]),
    ...price, mode, loc, address, phone, status: "new", at: now(),
    source: "web", buyerName: name, buyerPhone: phone, note, code, payment, paid: false, ...(payment === "upi" ? { upi: shop.upi } : {}) };
  c.st.set(`order:${oid}`, order);
  await addToIndex(c, "index:orders", oid);
  await save(c);
  await notifyOwner(c, oid, order, shop);
  console.log(`ORDER ${oid} shop=${sid} total=${order.total} web`);
  return json({ ok: true, oid, code, url: `/o/${oid}?c=${code}` });
}

// ---------- routing ----------

async function onMessage(c, m) {
  const chat = m.chat.id;
  const s = await sess(c, chat);
  const text = m.text || "";

  if (text.startsWith("/start")) {
    const arg = text.slice(6).trim();
    if (arg.startsWith("s_")) return showShop(c, chat, arg.slice(2));
    return (await myShop(c, chat))[1] ? dashboard(c, chat) : startOnboarding(c, chat);
  }
  if (text === "/shop" || text === "/menu" || text === "/web") return dashboard(c, chat);
  if (text === "/new") return startOnboarding(c, chat);
  if (text === "/admin" && chat === ADMIN) return showAdmin(c, chat);
  if (text === "/sales") return showSales(c, chat);
  if (text === "/orders") return showOrders(c, chat);

  const step = s.step || "";
  if (step === "setloc") {
    const [, shop] = await myShop(c, chat);
    if (shop && m.location) shop.loc = [m.location.latitude, m.location.longitude];
    s.step = null;
    await save(c);
    await tg(c, "sendMessage", { chat_id: chat, text: "✓ Shop location saved", reply_markup: { remove_keyboard: true } });
    return deliverySettings(c, chat);
  }
  if (step === "dloc") {
    if (m.location) {
      s.loc = [m.location.latitude, m.location.longitude];
      s.step = "address";
      await save(c);
      return tg(c, "sendMessage", { chat_id: chat, text: "🏠 Name, house / flat no. and landmark?", reply_markup: { remove_keyboard: true } });
    }
    s.loc = null;
    s.step = "address";
    await save(c);
    return tg(c, "sendMessage", { chat_id: chat, text: "🏠 Name and full delivery address?", reply_markup: { remove_keyboard: true } });
  }
  if (step === "address") {
    const t = await heard(c, m, chat);
    if (!t) return;
    Object.assign(s, { address: t, step: "phone" });
    await save(c);
    speak(c, chat, "Your phone?");
    return tg(c, "sendMessage", { chat_id: chat, text: "📞 Your phone?",
      reply_markup: { keyboard: [[{ text: "📱 Share my number", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  if (step === "phone") {
    const phone = (m.contact || {}).phone_number || text;
    return phone ? placeOrder(c, chat, s, phone) : null;
  }
  if (step.startsWith("ob_")) return onboardingStep(c, chat, s, m);
  const [ownSid] = await myShop(c, chat);
  if (s.shop && s.shop !== ownSid && (await getShop(c, s.shop))) return buyerText(c, chat, s, m);
  if (ownSid) return ownerText(c, chat, s, m);
  return startOnboarding(c, chat);
}

async function onCallback(c, q) {
  if (!q.message) return tg(c, "answerCallbackQuery", { callback_query_id: q.id });
  const chat = q.message.chat.id;
  const mid = q.message.message_id;
  const [kind, ...rest] = (q.data || "").split(":");
  const s = await sess(c, chat);
  await tg(c, "answerCallbackQuery", { callback_query_id: q.id });
  if (kind === "ob_done") return finishOnboarding(c, chat);
  if (kind === "tpl") return applyTemplate(c, chat, s, rest[0], rest[1]);
  if (kind === "home") return dashboard(c, chat);
  if (kind === "new") return startOnboarding(c, chat);
  if (kind === "add") {
    s.step = null;
    await save(c);
    return send(c, chat, "🎙 Say or type new items with prices.");
  }
  if (kind === "edit") return showEdit(c, chat);
  if (kind === "share") return shareCatalogue(c, chat);
  if (kind === "dlv") return deliverySettings(c, chat);
  if (kind === "feeby") {
    const [, shop] = await myShop(c, chat);
    if (shop) {
      shop.feeBy = (shop.feeBy || "customer") === "customer" ? "shop" : "customer";
      await save(c);
    }
    return deliverySettings(c, chat);
  }
  if (kind === "setloc") {
    s.step = "setloc";
    await save(c);
    return tg(c, "sendMessage", { chat_id: chat, text: "📍 Send your shop's location",
      reply_markup: { keyboard: [[{ text: "📍 Send shop location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  if (kind === "mode") {
    s.mode = rest[0];
    if (rest[0] === "pickup") {
      s.step = "address";
      await save(c);
      return send(c, chat, "🙋 Your name?");
    }
    s.step = "dloc";
    await save(c);
    return tg(c, "sendMessage", { chat_id: chat, text: "📍 Share your delivery location",
      reply_markup: { keyboard: [[{ text: "📍 Send my location", request_location: true }], [{ text: "Type address instead" }]],
        resize_keyboard: true, one_time_keyboard: true } });
  }
  if (kind === "sales") return showSales(c, chat);
  if (kind === "orders") return showOrders(c, chat);
  if (kind === "it") {
    const [, shop] = await myShop(c, chat);
    const i = parseInt(rest[0], 10);
    if (!shop || !(i < shop.items.length)) return;
    const it = shop.items[i];
    return send(c, chat, `<b>${h(iname(it))}</b> · ${h(it.unit)} · ${rs(it.price)}`,
      [[{ text: "💰 Change price", callback_data: `pr:${i}` }, { text: "🗑 Remove", callback_data: `rm:${i}` }],
       [{ text: "← Back", callback_data: "edit" }]]);
  }
  if (kind === "pr") {
    s.step = `price:${rest[0]}`;
    await save(c);
    return send(c, chat, "New price?");
  }
  if (kind === "rm") {
    const [sid, shop] = await myShop(c, chat);
    const i = parseInt(rest[0], 10);
    if (shop && i < shop.items.length) {
      const gone = shop.items.splice(i, 1)[0];
      await save(c);
      c.bg.push(publishPage(c, sid));
      await send(c, chat, `🗑 Removed ${h(iname(gone))}`);
    }
    return showEdit(c, chat);
  }
  if (kind === "a" || kind === "x" || kind === "c") {
    const sid = rest[0];
    const shop = await getShop(c, sid);
    if (!shop) return;
    if (s.shop !== sid) Object.assign(s, { shop: sid, cart: {} });
    const cart = (s.cart = s.cart || {});
    if (kind === "a") cart[rest[1]] = (cart[rest[1]] || 0) + 1;
    else if (kind === "x") clearObj(cart);
    else {
      await save(c);
      return send(c, chat, "How do you want it?", MODE_BTNS);
    }
    await save(c);
    return tg(c, "editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: catalogueMarkup(sid, shop, cart) });
  }
  if (["ok", "no", "out", "done", "paid"].includes(kind)) {
    const oid = rest[0];
    const o = await getOrder(c, oid);
    if (!o) return;
    const sh = await getShop(c, o.shop);
    if (!sh || String(sh.owner) !== String(chat)) return;
    const r = kind === "paid" ? await markPaid(c, o.shop, oid) : await setStatus(c, o.shop, oid, { ok: "accept", no: "decline", out: "out", done: "complete" }[kind]);
    if (r.order) await tg(c, "editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: ownerButtons(oid, r.order) } });
    if (r.error) await send(c, chat, h(r.error));
    return;
  }
}

// ---------- public catalogue page on Telegra.ph (updates whenever the shop changes) ----------

function pageNodes(c, sid, sh) {
  const items = sh.items.map(it => ({ tag: "li", children: [{ tag: "b", children: [iname(it)] },
    `${it.local && it.name ? " (" + it.name + ")" : ""}${it.unit ? " · " + it.unit : ""} — ${rs(it.price)}`] }));
  const d = istDate(now());
  return [
    { tag: "p", children: [`📍 ${sh.area || ""}  ·  Cash on delivery  ·  ${sh.items.length} items`] },
    { tag: "ul", children: items },
    { tag: "h4", children: [{ tag: "a", attrs: { href: shopLink(c, sid) }, children: ["🛒 Order on Telegram →"] }] },
    { tag: "p", children: [{ tag: "i", children: [`Updated ${pad(d.getUTCDate())} ${MON[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} · made with Munshi`] }] },
  ];
}

async function publishPage(c, sid) {
  const TPH = c.env.TELEGRAPH_TOKEN;
  if (!TPH) return;
  try {
    const sh = await getShop(c, sid);
    if (!sh) return;
    const data = new URLSearchParams({ access_token: TPH, title: sh.shopName, author_name: "Munshi",
      author_url: `https://t.me/${c.bot}`, content: JSON.stringify(pageNodes(c, sid, sh)) });
    const path = (sh.page || "").split("/").pop();
    const r = await (await fetch(`https://api.telegra.ph/${path ? "editPage/" + path : "createPage"}`,
      { method: "POST", body: data, signal: AbortSignal.timeout(15000) })).json();
    if (r.ok && !path) {
      sh.page = r.result.url;
      await save(c);
    } else if (!r.ok) {
      console.log("TPH ERR", JSON.stringify(r).slice(0, 200));
    }
  } catch (e) {
    console.log("TPH", e && e.stack || e);
  }
}

// ---------- public web pages ----------

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,650;1,9..144,500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const PAGE_CSS = `
:root{color-scheme:light;--bg:#fbf5ea;--bg2:#f4e9d6;--card:#fffdf8;--ink:#2a1a0e;--soft:#7c6a55;--line:#ebdcc4;--acc:#ec8a0b;--acc2:#b9620a;--leaf:#2f6b4f;--sh:0 1px 0 rgba(80,50,10,.04),0 8px 24px -12px rgba(80,50,10,.18);
--disp:"Fraunces",Georgia,serif;--body:"Manrope",system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Devanagari","Noto Sans Kannada","Noto Sans Tamil",sans-serif}
*{box-sizing:border-box;margin:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.5 var(--body);padding:22px 16px 110px;-webkit-font-smoothing:antialiased}
main{max-width:600px;margin:0 auto}
a{color:inherit}
.mark{display:inline-flex;align-items:center;gap:9px;color:var(--ink);font:600 19px/1 var(--disp);letter-spacing:-.01em;text-decoration:none}
.mark i{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffd36b,var(--acc) 55%,var(--acc2));box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 18%,transparent);display:inline-block}
h1{font:650 clamp(30px,7vw,40px)/1.08 var(--disp);letter-spacing:-.02em;margin:26px 0 6px}
.sub{color:var(--soft);font-size:15px}
.list{margin-top:22px;display:grid;gap:10px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px 14px;color:inherit;text-decoration:none;box-shadow:var(--sh);transition:transform .25s,border-color .25s}
a.row:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--acc) 45%,var(--line))}
.row b{font-weight:650}.row small{display:block;color:var(--soft);font-size:13px;margin-top:1px}
.lft{display:flex;align-items:center;gap:12px;min-width:0}
.av{width:44px;height:44px;border-radius:14px;flex:none;display:grid;place-items:center;font:600 19px/1 var(--disp);color:#3a2208;background:hsl(var(--hu,32) 85% 80%)}
.price{font-weight:700;color:var(--acc2);white-space:nowrap}
.go{position:fixed;left:16px;right:16px;bottom:16px;max-width:600px;margin:0 auto;display:flex;justify-content:center;align-items:center;gap:10px;text-align:center;background:var(--ink);color:var(--bg);font-weight:700;padding:16px;border-radius:18px;text-decoration:none;box-shadow:0 12px 30px -10px rgba(40,20,0,.5);z-index:5}
.go em{font-style:normal;background:var(--acc);color:#1d1206;border-radius:999px;padding:2px 10px;font-size:14px}
.empty{color:var(--soft);margin-top:30px}
.alt{display:block;text-align:center;color:var(--soft);font-size:14px;margin-top:18px}
.langs{display:flex;gap:2px;justify-content:flex-end}
.langs button{font:inherit;font-size:13px;background:none;border:1px solid transparent;color:var(--soft);padding:4px 8px;cursor:pointer;border-radius:999px}
.langs button.on{color:var(--ink);background:var(--card);border-color:var(--line)}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 14px;font-size:14px;font-weight:600;text-decoration:none;color:var(--ink)}
.rise{animation:rise .7s cubic-bezier(.2,.8,.2,1) both}.d1{animation-delay:.06s}.d2{animation-delay:.12s}.d3{animation-delay:.18s}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion:reduce){.rise{animation:none}}
`;

const FORM_CSS = `
.f{display:grid;gap:8px;margin-top:18px}
label{font-size:12px;color:var(--soft);letter-spacing:.04em;text-transform:lowercase}
input,select,textarea{width:100%;font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
input:focus,select:focus,textarea:focus{outline:2px solid var(--acc);border-color:transparent}
.add{background:none;border:1px dashed var(--line);border-radius:14px;padding:12px;color:var(--soft);font:inherit;cursor:pointer}
`;

const SHOP_CSS = FORM_CSS + `
.shead{display:flex;align-items:center;gap:16px;margin-top:22px}
.shead h1{margin:0 0 2px}
.av.big{width:64px;height:64px;border-radius:20px;font-size:30px}
.search{margin-top:20px;border-radius:999px!important;padding:12px 18px!important}

.rt{display:flex;align-items:center;gap:12px;flex-shrink:0}
.price{text-align:right;line-height:1.15}.price small{display:block;font-size:12px}
.qty{display:flex;align-items:center;gap:6px}
.q{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-size:18px;font-weight:700;cursor:pointer}
.q.p{background:var(--acc);border-color:var(--acc);color:#1d1206}
.n{min-width:18px;text-align:center}
.row:not(.has) .m,.row:not(.has) .n{display:none}
.rcpt{gap:0!important;background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--sh);overflow:hidden}
.rcpt .row{border:0;border-radius:0;box-shadow:none;background:none;border-top:1px dashed var(--line)}
.rcpt .row:first-child{border-top:0}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:18px}
.seg button{font:inherit;font-weight:600;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;cursor:pointer}
.seg button.on{border:2px solid var(--acc)}
.tot{margin-top:18px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px;display:grid;gap:4px}
.tot div{display:flex;justify-content:space-between;color:var(--soft)}
.tot div:last-child{color:var(--ink);font-weight:700;font-size:18px;border-top:1px solid var(--line);padding-top:6px;margin-top:2px}
.err{color:#b4441c;margin-top:12px;min-height:1px}
.steps{list-style:none;padding:0;margin-top:22px;display:grid;gap:12px}
.steps li{display:flex;gap:12px;align-items:center;color:var(--soft)}
.steps li i{width:22px;height:22px;border-radius:50%;border:2px solid var(--line);flex:none;font-style:normal;font-size:13px;display:grid;place-items:center}
.steps li.d{color:var(--ink);font-weight:600}.steps li.d i{background:var(--acc);border-color:var(--acc);color:#1d1206}
@media (pointer:coarse){.upiqr{display:none}}
.note{margin-top:18px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px}
[hidden]{display:none!important}
`;

function pageHtml(title, body, o = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title><meta name="color-scheme" content="light"><meta name="theme-color" content="#fbf5ea">${o.desc ? `<meta name="description" content="${h(o.desc)}"><meta property="og:title" content="${h(title)}"><meta property="og:description" content="${h(o.desc)}">` : ""}${FONTS}<style>${PAGE_CSS}${o.css || ""}</style></head><body><main>${body}</main></body></html>`,
    { status: o.status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": o.cache || "public, max-age=30" } });
}

// Buyer-side labels from Arjun's lib/i18n.ts; English is what the page renders.
const SHOP_I18N = {
  kn: { delivery: "ಡೆಲಿವರಿ", pickup: "ಪಿಕಪ್", name: "ಹೆಸರು", phone: "ಫೋನ್ ನಂಬರ್", deliveryAddress: "ಡೆಲಿವರಿ ವಿಳಾಸ", payCash: "ಡೆಲಿವರಿ ಅಥವಾ ಪಿಕಪ್ ವೇಳೆ ನಗದು ಪಾವತಿಸಿ",
    subtotal: "ಉಪ ಮೊತ್ತ", deliveryFee: "ಡೆಲಿವರಿ ಶುಲ್ಕ", total: "ಒಟ್ಟು", placeOrder: "ಆರ್ಡರ್ ಮಾಡಿ", backToShop: "ಅಂಗಡಿಗೆ ಹಿಂತಿರುಗಿ", items: "ಸಾಮಾನು", checkout: "ಚೆಕ್‌ಔಟ್" },
  hi: { delivery: "डिलीवरी", pickup: "पिकअप", name: "नाम", phone: "फ़ोन नंबर", deliveryAddress: "डिलीवरी का पता", payCash: "डिलीवरी या पिकअप पर नकद भुगतान करें",
    subtotal: "सामान का कुल", deliveryFee: "डिलीवरी चार्ज", total: "कुल", placeOrder: "ऑर्डर करें", backToShop: "दुकान पर वापस", items: "सामान", checkout: "चेकआउट" },
  ta: { delivery: "டெலிவரி", pickup: "பிக்கப்", name: "பெயர்", phone: "தொலைபேசி எண்", deliveryAddress: "டெலிவரி முகவரி", payCash: "டெலிவரி அல்லது பிக்கப்பின் போது ரொக்கமாக செலுத்துங்கள்",
    subtotal: "துணைத் தொகை", deliveryFee: "டெலிவரி கட்டணம்", total: "மொத்தம்", placeOrder: "ஆர்டர் செய்", backToShop: "கடைக்குத் திரும்பு", items: "பொருட்கள்", checkout: "செக்அவுட்" },
};

const jsonForScript = o => JSON.stringify(o).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");

async function webPage(env, sid) {
  const c = { env, st: new Store(env.DB) };
  c.bot = await botName(c);
  const mark = `<a class="mark" href="/" style="text-decoration:none"><i></i>munshi</a>`;
  if (!sid) return homePage(c, mark);
  const sh = await getShop(c, sid);
  if (!sh) return pageHtml("Not found", `${mark}<h1>Shop not found</h1><p class="sub"><a href="/">All shops</a></p>`, { status: 404 });
  const items = sh.items || [];
  const rows = items.map((it, i) => `<div class="row" data-i="${i}"><span class="lft">${avatar(it.name)}<span><b>${h(it.name)}</b>${it.local && it.local !== it.name ? `<small>${h(it.local)}</small>` : ""}</span></span><span class="rt"><span class="price">${rs(it.price)}${it.unit ? `<small style="font-weight:400;color:var(--soft)">/ ${h(it.unit)}</small>` : ""}</span><span class="qty"><button class="q m" aria-label="one less">−</button><b class="n">0</b><button class="q p" aria-label="one more">+</button></span></span></div>`).join("");
  const tel = sh.phone ? ` · <a href="tel:${h(sh.phone)}" style="color:inherit">📞 ${h(sh.phone)}</a>` : "";
  return pageHtml(sh.shopName, `<div class="top">${mark}<div class="langs">${[["en", "EN"], ...LANGS.filter(l => l[0] !== "en")].map(([k, l]) => `<button data-l="${k}">${l}</button>`).join("")}</div></div>
<section id="shop"><div class="shead rise" style="--hu:${hue(sh.shopName)}"><span class="av big">${h(initial(sh.shopName))}</span><div><h1>${h(sh.shopName)}</h1><p class="sub">${h(sh.area || "")}${tel}</p></div></div>
${items.length > 8 ? `<input class="search" id="find" placeholder="Search ${items.length} items" autocomplete="off">` : ""}
<div class="list">${rows || `<p class="empty">Menu coming soon.</p>`}</div>
<a class="alt" href="${h(waShare(sh, sid))}" target="_blank" rel="noopener">share on WhatsApp</a></section>
<section id="co" hidden><a class="alt" href="#" id="back" style="text-align:left;margin:18px 0 0">← <span data-t="backToShop">back</span></a><h1 data-t="checkout">Your order</h1>
<div class="list rcpt" id="lines"></div>
<div class="seg"><button type="button" data-m="delivery" class="on">🛵 <span data-t="delivery">Delivery</span></button><button type="button" data-m="pickup">🏃 <span data-t="pickup">Pickup</span></button></div>
${sh.upi ? `<div class="seg" id="pay"><button type="button" data-p="upi">Pay now by UPI</button><button type="button" data-p="cod" class="on" id="cod">Cash on delivery</button></div>` : ""}
<div class="f"><label data-t="name">name</label><input id="bn" maxlength="60" autocomplete="name">
<label data-t="phone">phone</label><input id="bp" maxlength="15" inputmode="tel" autocomplete="tel">
<div id="dl" class="f" style="margin:0"><label data-t="deliveryAddress">delivery address</label><textarea id="ba" maxlength="200" rows="2" autocomplete="street-address"></textarea>
<button type="button" class="add" id="gl">📍 use my location</button></div>
<label>note for the shop</label><input id="bt" maxlength="200" placeholder="optional"></div>
<div class="tot" id="tot"></div><p class="err" id="err"></p>
<p class="sub" style="text-align:center;margin-top:8px" id="paynote">Pay cash on delivery or pickup</p></section>
<a class="go" id="bar" href="#" hidden></a>
${TALK_HTML}
<script>
const SID = ${jsonForScript(sid)}, ITEMS = ${jsonForScript(items.map(it => ({ n: it.name, l: iname(it), p: it.price })))}, KEY = "munshi-cart-" + SID;
const I18N = ${jsonForScript(SHOP_I18N)};
let lang = "en";
try { lang = localStorage.getItem("munshi-lang") || "en"; } catch {}
const T = (k, en) => (I18N[lang] || {})[k] || en;
document.querySelectorAll("[data-t]").forEach(e => { e.dataset.en = e.textContent; });
function setLang(l) {
  lang = I18N[l] ? l : "en";
  try { localStorage.setItem("munshi-lang", lang); } catch {}
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-t]").forEach(e => { e.textContent = T(e.dataset.t, e.dataset.en); });
  document.querySelectorAll(".langs button").forEach(b => b.classList.toggle("on", b.dataset.l === lang));
  paint();
}
document.querySelectorAll(".langs button").forEach(b => b.onclick = () => setLang(b.dataset.l));
const $ = id => document.getElementById(id), rs = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
let cart = {}, mode = "delivery", pay = "cod", loc = null, quote = null, busy = false, qseq = 0;
try { cart = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch {}
for (const k in cart) if (!ITEMS[k] || ITEMS[k].n !== cart[k].n || !(cart[k].q > 0)) delete cart[k];
try { const b = JSON.parse(localStorage.getItem("munshi-buyer") || "{}"); $("bn").value = b.n || ""; $("bp").value = b.p || ""; $("ba").value = b.a || ""; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch {} };
const count = () => Object.values(cart).reduce((a, x) => a + x.q, 0);
const sub = () => Object.entries(cart).reduce((a, [i, x]) => a + ITEMS[i].p * x.q, 0);
const inCo = () => location.hash === "#checkout" && count() > 0;
function setQ(i, q) { q = Math.max(0, Math.min(99, q)); if (q) cart[i] = { n: ITEMS[i].n, q }; else delete cart[i]; save(); paint(); }
document.querySelectorAll(".row[data-i]").forEach(r => {
  const i = r.dataset.i;
  r.querySelector(".p").onclick = () => setQ(i, ((cart[i] || {}).q || 0) + 1);
  r.querySelector(".m").onclick = () => setQ(i, ((cart[i] || {}).q || 0) - 1);
});
function paint() {
  document.querySelectorAll(".row[data-i]").forEach(r => { const q = (cart[r.dataset.i] || {}).q || 0; r.classList.toggle("has", q > 0); r.querySelector(".n").textContent = q; });
  const n = count(), co = inCo();
  $("shop").hidden = co; $("co").hidden = !co; $("bar").hidden = !n;
  if (!co) { $("bar").innerHTML = "<em>" + n + "</em>" + T("items", n > 1 ? "items" : "item") + " · " + rs(sub()) + " →"; return; }
  $("bar").textContent = busy ? "…" : T("placeOrder", "Place order") + " · " + rs(quote ? quote.total : sub());
  $("lines").innerHTML = "";
  for (const [i, x] of Object.entries(cart)) {
    const d = document.createElement("div"); d.className = "row";
    d.innerHTML = "<span></span><span class=price></span>";
    d.firstChild.textContent = x.q + " × " + (lang === "en" ? ITEMS[i].n : ITEMS[i].l); d.lastChild.textContent = rs(ITEMS[i].p * x.q);
    $("lines").appendChild(d);
  }
  $("dl").hidden = mode !== "delivery";
  document.querySelectorAll(".seg button[data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
  document.querySelectorAll(".seg button[data-p]").forEach(b => b.classList.toggle("on", b.dataset.p === pay));
  if ($("cod")) $("cod").textContent = mode === "pickup" ? "Cash at pickup" : "Cash on delivery";
  $("paynote").textContent = pay === "upi" ? "You'll get a UPI pay button after you place the order" : T("payCash", "Pay cash on delivery or pickup");
  const t = quote || { subtotal: sub(), feeCharged: 0, total: sub() };
  $("tot").innerHTML = "<div><span>" + T("subtotal", "items") + "</span><span>" + rs(t.subtotal) + "</span></div>" +
    (mode === "delivery" ? "<div><span>" + T("deliveryFee", "delivery") + (t.km != null ? " · " + t.km.toFixed(1) + " km" : "") + "</span><span>" + (t.feeCharged ? rs(t.feeCharged) : "free") + "</span></div>" : "") +
    "<div><span>" + T("total", "total") + "</span><span>" + rs(t.total) + "</span></div>";
}
function body(extra) {
  return JSON.stringify(Object.assign({ lines: Object.entries(cart).map(([i, x]) => ({ i: +i, name: x.n, q: x.q })), mode, loc, payment: pay,
    name: $("bn").value, phone: $("bp").value, address: $("ba").value, note: $("bt").value }, extra));
}
const post = async extra => (await fetch("/api/order/" + encodeURIComponent(SID), { method: "POST", headers: { "content-type": "application/json" }, body: body(extra) })).json();
async function requote() {
  const my = ++qseq; quote = null; paint();
  try { const r = await post({ quote: true }); if (my === qseq && !r.error) { quote = r; paint(); } else if (r.error) $("err").textContent = r.error; } catch {}
}
async function place() {
  if (busy) return;
  busy = true; $("err").textContent = ""; paint();
  try {
    const r = await post({});
    if (r.error) throw new Error(r.error);
    try { localStorage.removeItem(KEY); localStorage.setItem("munshi-buyer", JSON.stringify({ n: $("bn").value, p: $("bp").value, a: $("ba").value })); } catch {}
    return location.replace(r.url);
  } catch (e) { $("err").textContent = e.message && !/fetch/i.test(e.message) ? e.message : "Couldn't place the order. Try again."; }
  busy = false; paint();
}
$("bar").onclick = e => { e.preventDefault(); if (inCo()) place(); else location.hash = "checkout"; };
$("back").onclick = e => { e.preventDefault(); history.back(); };
window.onhashchange = () => { scrollTo(0, 0); if (inCo()) requote(); else paint(); };
document.querySelectorAll(".seg button[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; requote(); });
document.querySelectorAll(".seg button[data-p]").forEach(b => b.onclick = () => { pay = b.dataset.p; paint(); });
$("gl").onclick = () => {
  if (!navigator.geolocation) return;
  $("gl").textContent = "📍 finding you…";
  navigator.geolocation.getCurrentPosition(p => { loc = [p.coords.latitude, p.coords.longitude]; $("gl").textContent = "📍 location added ✓"; requote(); },
    () => { $("gl").textContent = "📍 couldn't get your location"; }, { enableHighAccuracy: true, timeout: 15000 });
};
setLang(lang);
if (inCo()) requote();
window.TALK = {
  url: "/api/talk/" + encodeURIComponent(SID), hello: ${jsonForScript("Hi! Tell me what you'd like 🎙")},
  extra: () => ({ cart: Object.entries(cart).map(([i, x]) => [+i, x.q]), lang }),
  apply: r => { for (const [i, q] of r.add || []) setQ(i, ((cart[i] || {}).q || 0) + q); for (const i of r.remove || []) setQ(i, 0); if (r.checkout && count()) location.hash = "checkout"; },
};
new MutationObserver(() => document.body.classList.toggle("hasbar", !$("bar").hidden)).observe($("bar"), { attributes: true });
document.body.classList.toggle("hasbar", !$("bar").hidden);
${TALK_JS}
if ($("find")) $("find").oninput = e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll(".row[data-i]").forEach(r => { r.hidden = q && !r.textContent.toLowerCase().includes(q); }); };
</script>`, { css: SHOP_CSS + TALK_CSS, desc: `${sh.shopName}${sh.area ? " · " + sh.area : ""}: see the menu and order online.` });
}

async function statusRoute(env, url) {
  const api = url.pathname.startsWith("/api/");
  const oid = url.pathname.split("/").pop();
  const c = { env, st: new Store(env.DB) };
  const o = /^\d{1,10}$/.test(oid) ? await getOrder(c, oid) : null;
  // the code is the only key to a web order; a wrong code looks exactly like a missing order
  if (!o || !o.code || (url.searchParams.get("c") || "") !== o.code) {
    return api ? Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } })
      : pageHtml("Not found", `<span class="mark"><i></i>munshi</span><h1>Order not found</h1>`, { status: 404, cache: "no-store" });
  }
  if (api) return Response.json({ status: o.status, paid: !!o.paid }, { headers: { "cache-control": "no-store" } });
  const sh = (await getShop(c, o.shop)) || {};
  const dlv = o.mode === "delivery";
  const steps = [["new", "Order placed"], ["accepted", "Accepted by the shop"], ["out", dlv ? "Out for delivery" : "Ready for pickup"], ["completed", "Completed"]];
  const at = Math.max(0, steps.findIndex(x => x[0] === o.status));
  const upi = o.payment === "upi" && o.status !== "declined";
  const live = o.status !== "declined" && (o.status !== "completed" || (upi && !o.paid));
  let payBox = "";
  if (upi && o.paid) payBox = `<p class="note">✓ Paid by UPI · ${rs(o.total)}</p>`;
  else if (upi) {
    const link = upiLink(o, oid, sh.shopName);
    payBox = `<p class="note"><b>Unpaid</b> · ${rs(o.total)} by UPI to ${h(o.upi)}</p>
<a class="go" style="position:static;margin-top:12px" href="${h(link)}">Pay ${rs(o.total)}</a>
<div class="upiqr" style="text-align:center;margin-top:14px">${qrSvg(link, 200)}<p class="sub">or scan with any UPI app</p></div>
<p class="sub" style="margin-top:10px">We can't confirm UPI payments automatically; the shop confirms.</p>`;
  }
  const track = o.status === "declined" ? `<p class="note">✖ The shop couldn't take this order.${sh.phone ? " Please call them." : ""}</p>`
    : `<ol class="steps">${steps.map(([, label], i) => `<li class="${i <= at ? "d" : ""}"><i>${i <= at ? "✓" : ""}</i>${label}</li>`).join("")}</ol>`;
  const lines = o.lines.map(([n, q, p]) => `<div><span>${q} × ${h(n)}</span><span>${rs(p * q)}</span></div>`).join("");
  return pageHtml(`Order #${oid}`, `<a class="mark" href="/s/${encodeURIComponent(o.shop)}" style="text-decoration:none"><i></i>${h(sh.shopName || "munshi")}</a>
<h1>Order #${h(oid)}</h1><p class="sub">${dlv ? "🛵 Delivery" : "🏃 Pickup from shop"}${live && !upi ? ` · pay ${rs(o.total)} cash ${dlv ? "on delivery" : "at pickup"}` : ""}</p>
${payBox}
${track}
<div class="tot">${lines}${dlv ? `<div><span>delivery</span><span>${o.feeCharged ? rs(o.feeCharged) : "free"}</span></div>` : ""}<div><span>total</span><span>${rs(o.total)}</span></div></div>
${sh.phone ? `<a class="alt" href="tel:${h(sh.phone)}">📞 call the shop</a>` : ""}
<a class="alt" href="/s/${encodeURIComponent(o.shop)}">back to the shop</a>
${live ? `<script>const S0 = ${jsonForScript(o.status)}, P0 = ${o.paid ? "true" : "false"};
const t = setInterval(async () => { try { const r = await (await fetch("/api/o/${h(oid)}" + location.search, { cache: "no-store" })).json(); if (r.status && (r.status !== S0 || r.paid !== P0)) { clearInterval(t); location.reload(); } } catch {} }, 10000);</script>` : ""}`,
    { css: SHOP_CSS, cache: "no-store" });
}

// ---------- owner web dashboard: /m/<sid>?k=<signed key> ----------

async function manageKey(env, sid) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WEBHOOK_SECRET || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("manage:" + sid)));
  return [...sig.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function manageLink(env, sid) {
  return `${PUBLIC_URL}/m/${encodeURIComponent(sid)}?k=${await manageKey(env, sid)}`;
}

const unh = s => String(s).replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

async function ttsMp3(env, text) {
  const t = ttsText(text);
  if (!wordChars(t) || !env.ELEVENLABS_API_KEY) return null;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: t, model_id: "eleven_multilingual_v2" }),
  });
  if (!r.ok) { console.log("web tts", r.status); return null; }
  return b64(await r.arrayBuffer());
}

async function sttBlob(env, buf, mime) {
  const fd = new FormData();
  fd.append("model_id", "scribe_v1");
  fd.append("file", new Blob([buf], { type: mime || "audio/webm" }), "voice." + ((mime || "").includes("mp4") ? "mp4" : "webm"));
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY }, body: fd, signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`stt ${r.status} ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()).text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

// One turn of a web voice/text conversation: audio (base64) or text, plus recent turns.
async function talkInput(env, req, who) {
  let b;
  try { b = await req.json(); } catch { return { error: "Bad request." }; }
  let text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 400), heard = "";
  if (!text) {
    const a = typeof b.audio === "string" ? b.audio : "";
    if (a.length < 2000) return { error: "Too short. Try again." };
    if (a.length > 1200000) return { error: "Too long. Keep it short." };
    let buf;
    try { buf = Uint8Array.from(atob(a), ch => ch.charCodeAt(0)).buffer; } catch { return { error: "Bad audio." }; }
    try { heard = await sttBlob(env, buf, String(b.mime || "audio/webm")); } catch (e) { console.log("web stt", String(e)); }
    if (wordChars(heard).length < 2) return { error: "Couldn't catch that. Try again." };
    text = heard;
  }
  const turns = (Array.isArray(b.history) ? b.history : []).slice(-8)
    .filter(x => Array.isArray(x) && typeof x[1] === "string")
    .map(x => `${x[0] === "user" ? who : "Munshi"}: ${x[1].slice(0, 300)}`);
  return { text, heard, b, history: turns.length ? `Conversation so far:\n${turns.join("\n")}\n\n` : "" };
}

const TALK_HITS = new Map(), ORDER_HITS = new Map(); // per isolate: soft brakes on the public endpoints
function softLimited(hits, req, max) {
  const ip = req.headers.get("cf-connecting-ip") || "?", t = Date.now(), w = hits.get(ip);
  if (!w || t - w[1] > 600000) { hits.set(ip, [1, t]); return false; }
  return ++w[0] > max;
}
const talkLimited = req => softLimited(TALK_HITS, req, 40);

// Customers talk to the shop on the web page: the reply is spoken, the cart changes on their screen.
async function talkApi(req, env, sid) {
  const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
  if (talkLimited(req)) return json({ error: "Too many messages. Wait a few minutes." }, 429);
  const c = { env, st: new Store(env.DB), bg: [] };
  const shop = await getShop(c, sid);
  if (!shop) return json({ error: "Shop not found." }, 404);
  const t = await talkInput(env, req, "Customer");
  if (t.error) return json({ error: t.error });
  const n = shop.items.length, cart = {};
  for (const x of Array.isArray(t.b.cart) ? t.b.cart : []) {
    const i = parseInt(x && x[0], 10), q = parseInt(x && x[1], 10);
    if (i >= 0 && i < n && q > 0) cart[i] = Math.min(99, q);
  }
  const cartTxt = Object.entries(cart).map(([i, q]) => `${q}x ${iname(shop.items[+i])}`).join(", ") || "empty";
  let plan = {};
  try {
    plan = await geminiJson(c, fill(BUYER_PROMPT, { shop: shop.shopName, area: shop.area || "", items: catalogueText(shop), cart: cartTxt, history: t.history }) + t.text);
  } catch (e) { console.log("talk llm", String(e)); }
  plan = plan && typeof plan === "object" ? plan : {};
  const add = [];
  for (const a of Array.isArray(plan.add) ? plan.add : []) {
    const i = parseInt(a && a.index, 10);
    if (i >= 0 && i < n) add.push([i, Math.min(99, Math.max(1, parseInt(a.qty, 10) || 1))]);
  }
  const remove = (Array.isArray(plan.remove) ? plan.remove : []).map(i => parseInt(i, 10)).filter(i => i >= 0 && i < n);
  const reply = String(plan.reply || (add.length ? "Added." : "Sorry, say that again?")).slice(0, 400);
  console.log(`talk ${sid}: ${t.text.slice(0, 60)} -> ${JSON.stringify(add)}`);
  return json({ heard: t.heard, reply, add, remove, checkout: !!plan.checkout, audio: await ttsMp3(env, reply) });
}

const TALK_CSS = `
.fab{position:fixed;right:16px;bottom:22px;z-index:15;width:58px;height:58px;border-radius:50%;border:0;background:var(--ink);color:var(--bg);font-size:24px;cursor:pointer;box-shadow:0 12px 30px -10px rgba(60,30,0,.6)}
body.hasbar .fab{bottom:92px}
.tk{position:fixed;left:0;right:0;bottom:0;z-index:30;padding:0 10px 10px;display:none}
.tk.open{display:block}
.sheet{max-width:560px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:24px;box-shadow:0 24px 60px -20px rgba(60,30,0,.5);padding:12px}
.msgs{max-height:44vh;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:4px 2px}
.mb{max-width:86%;padding:9px 13px;border-radius:17px;font-size:15px;line-height:1.35;white-space:pre-line}
.mb.u{align-self:flex-end;background:#dff3dc;color:#183b1a;border-bottom-right-radius:5px}
.mb.b{align-self:flex-start;background:var(--bg2);border-bottom-left-radius:5px}
.mb.n{align-self:center;background:none;color:var(--soft);font-size:13px;padding:2px}
.tkr{display:flex;gap:8px;align-items:center;margin-top:10px}
.tkr input{flex:1;min-width:0;font:inherit;font-size:15px;padding:12px 14px;border-radius:999px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.tkm{width:52px;height:52px;flex:none;border-radius:50%;border:0;background:var(--ink);color:var(--bg);font-size:21px;cursor:pointer}
.tkm.on{background:var(--acc);color:#1d1206;animation:tkp 1.1s infinite}
.tkm.wait{opacity:.55}
@keyframes tkp{50%{box-shadow:0 0 0 10px color-mix(in srgb,var(--acc) 25%,transparent)}}
.tkx{background:none;border:0;color:var(--soft);font-size:22px;cursor:pointer;padding:0 4px}
.tkh{display:flex;justify-content:space-between;align-items:center;padding:0 4px 4px;font:600 15px var(--disp)}
`;
const TALK_HTML = `<button class="fab" id="fab" aria-label="Talk">🎙</button>
<div class="tk" id="tk"><div class="sheet"><div class="tkh"><span>Munshi</span><button class="tkx" id="tkx" aria-label="Close">×</button></div><div class="msgs" id="msgs"></div>
<form class="tkr" id="tkf"><input id="tki" placeholder="type, or tap 🎙" autocomplete="off"><button class="tkm" id="tkm" type="button">🎙</button></form></div></div>`;
// Hands-free: listen, stop on a pause, send, speak the reply, listen again. Tap 🎙 to cut in or stop.
const TALK_JS = `
(() => {
const K = window.TALK, $t = id => document.getElementById(id);
let hist = [], live = false, rec = null, stream = null, ac = null, au = null, busy = false, queued = "";
const say = (cls, text) => { const d = document.createElement("div"); d.className = "mb " + cls; d.textContent = text; $t("msgs").appendChild(d); $t("msgs").scrollTop = 1e9; };
const state = s => { $t("tkm").className = "tkm " + s; $t("tkm").textContent = s === "on" ? "■" : s === "wait" ? "…" : "🎙"; };
const b64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1] || ""); f.readAsDataURL(blob); });
function open() { $t("tk").classList.add("open"); $t("fab").hidden = true; if (!$t("msgs").children.length) say("b", K.hello); }
function release() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
function close() { live = false; if (rec && rec.state === "recording") { rec.cancel = true; rec.stop(); } if (au) au.pause(); release(); state(""); $t("tk").classList.remove("open"); $t("fab").hidden = false; }
function next() { state(""); if (queued) { const v = queued; queued = ""; return sendText(v); } if (live) listen(); else release(); }
function sendText(v) { say("u", v); hist.push(["user", v]); live = false; send({ text: v }); }
async function send(body) {
  busy = true; state("wait");
  let r;
  try { r = await (await fetch(K.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, history: hist.slice(-8), ...K.extra() }) })).json(); }
  catch { r = { error: "Network problem. Try again." }; }
  busy = false;
  if (r.heard) { say("u", r.heard); hist.push(["user", r.heard]); }
  if (r.error) { say("n", r.error); live = false; return next(); }
  if (r.reply) { say("b", r.reply); hist.push(["munshi", r.reply]); }
  try { K.apply(r, say); } catch (e) {}
  if (r.checkout) live = false;
  if (!r.audio) return next();
  au = new Audio("data:audio/mpeg;base64," + r.audio); au.onended = next;
  au.play().catch(next);
}
async function listen() {
  if (busy) return;
  try { stream = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { live = false; say("n", "Allow the microphone, or type."); return state(""); }
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  const src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
  const buf = new Uint8Array(an.fftSize), chunks = [], t0 = performance.now();
  let spoke = false, quiet = t0;
  const r = rec = new MediaRecorder(stream);
  r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  r.onstop = async () => {
    src.disconnect();
    if (r.cancel) return;
    if (!spoke) { live = false; return next(); }
    const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
    send({ audio: await b64(blob), mime: blob.type });
  };
  r.start(250); state("on");
  const tick = () => {
    if (r.state !== "recording") return;
    an.getByteTimeDomainData(buf);
    let e = 0; for (const v of buf) { const x = (v - 128) / 128; e += x * x; }
    const now = performance.now();
    if (Math.sqrt(e / buf.length) > 0.035) { spoke = true; quiet = now; }
    if ((spoke && now - quiet > 1300) || now - t0 > 20000 || (!spoke && now - t0 > 9000)) return r.stop();
    setTimeout(tick, 60);
  };
  tick();
}
$t("fab").onclick = () => { open(); live = true; listen(); };
$t("tkx").onclick = close;
$t("tkm").onclick = () => {
  if (rec && rec.state === "recording") { live = false; rec.stop(); return; }
  if (au && !au.paused) { au.pause(); live = true; return listen(); }
  if (busy) return;
  live = true; listen();
};
$t("tkf").onsubmit = e => { e.preventDefault(); const v = $t("tki").value.trim(); if (!v) return; $t("tki").value = ""; if (busy) { queued = v; return say("n", "…"); } sendText(v); };
})();
`;

const shopView = sh => ({ shopName: sh.shopName || "", area: sh.area || "", phone: sh.phone || "", upi: sh.upi || "", items: sh.items || [] });
const UPI_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const upiLink = (o, oid, shopName) => `upi://pay?pa=${encodeURIComponent(o.upi)}&pn=${encodeURIComponent(shopName || "Shop")}` +
  `&am=${Number(o.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent("Order " + oid)}`;

async function manageRoute(req, env, url, ctx) {
  const parts = url.pathname.split("/").filter(Boolean); // ["m", sid] or ["api","m",sid,(voice)]
  const api = parts[0] === "api";
  const sid = decodeURIComponent(parts[api ? 2 : 1] || "");
  const k = url.searchParams.get("k") || "";
  if (!sid || !env.WEBHOOK_SECRET || k !== await manageKey(env, sid)) return new Response("This link is not valid.", { status: 403 });
  const c = { env, st: new Store(env.DB), bg: [] };
  c.bot = await botName(c);
  const shop = await getShop(c, sid);
  if (!shop) return new Response("Shop not found", { status: 404 });
  const json = o => Response.json(o, { headers: { "cache-control": "no-store" } });

  if (!api) return managePage(sid, shop);
  if (req.method === "GET" && parts[3] === "template") {
    const have = parseInt(url.searchParams.get("have"), 10) || 0;
    return json({ items: templateItems(decodeURIComponent(parts[4] || ""), url.searchParams.get("lang"), MAX_ITEMS - have) });
  }
  if (parts[3] === "orders") {
    if (req.method === "POST" && parts[4]) {
      let b = {};
      try { b = await req.json(); } catch {}
      const action = String((b && b.action) || "");
      const r = action === "paid" ? await markPaid(c, sid, parts[4]) : await setStatus(c, sid, parts[4], action);
      if (r.error) return json({ error: r.error, ...(await ordersView(c, sid)) });
      return json({ ok: true, ...(await ordersView(c, sid)) });
    }
    return json(await ordersView(c, sid));
  }
  if (req.method === "GET") return json(shopView(shop));

  if (req.method === "POST" && parts[3] === "voice") {
    const t = await talkInput(env, req, "Shopkeeper");
    if (t.error) return json({ error: t.error });
    console.log(`web talk ${sid}: ${t.text.slice(0, 80)}`);
    let plan;
    try {
      plan = await geminiJson(c, fill(OWNER_PROMPT, {
        shop: shop.shopName, items: catalogueText(shop), history: t.history,
        today: JSON.stringify(await sales(c, sid, true)), alltime: JSON.stringify(await sales(c, sid)) }) + t.text);
    } catch (e) {
      plan = { actions: [{ type: "add", items: await parseItems(c, t.text) }], reply: "" };
    }
    plan = plan && typeof plan === "object" ? plan : {};
    const { notes } = applyOwnerPlan(shop, plan);
    if (notes.length) { await save(c); ctx.waitUntil(publishPage(c, sid)); }
    const reply = plan.reply || (notes.length ? "Done." : "");
    return json({ heard: t.heard, reply, notes: notes.map(unh), shop: shopView(shop), audio: await ttsMp3(env, reply) });
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad request" }); }
    const name = String(b.shopName || "").trim().slice(0, 80);
    if (!name) return json({ error: "Shop name can't be empty." });
    let items;
    try {
      items = (b.items || []).filter(i => i && String(i.name || "").trim()).slice(0, 200).map(i => cleanItem({ ...i, name: String(i.name).trim().slice(0, 80) }));
    } catch { return json({ error: "Every item needs a price (a number)." }); }
    shop.shopName = name;
    shop.area = String(b.area || "").trim().slice(0, 80);
    shop.phone = String(b.phone || "").replace(/[^\d+ ]/g, "").slice(0, 16);
    const upi = String(b.upi || "").trim();
    if (upi && !UPI_RE.test(upi)) return json({ error: "UPI ID should look like name@bank." });
    shop.upi = upi;
    shop.items = items;
    await save(c);
    ctx.waitUntil(publishPage(c, sid));
    return json({ ok: true, shop: shopView(shop) });
  }
  return new Response("not allowed", { status: 405 });
}

// The owner's view of recent orders (owner only: includes buyer contact details).
async function ordersView(c, sid) {
  const mine = (await allOrders(c)).filter(([, o]) => o.shop === sid).sort((a, b) => b[1].at - a[1].at).slice(0, 30);
  const d = sec => { const x = istDate(sec); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${hm(sec)}`; };
  return {
    cash: await cashToday(c, sid),
    orders: mine.map(([oid, o]) => ({
      oid, when: d(o.at), status: o.status, mode: o.mode || "delivery", total: o.total, source: o.source || "telegram",
      lines: o.lines.map(([n, q]) => `${q}× ${n}`).join(", "), who: [o.buyerName, o.address].filter(Boolean).join(", "),
      phone: o.phone || "", note: o.note || "",
      payment: o.payment || "cod", paid: !!o.paid,
      actions: Object.entries(FLOW).filter(([, r]) => r.from.includes(o.status)).map(([a]) => a)
        .concat(o.payment === "upi" && !o.paid && o.status !== "declined" ? ["paid"] : []),
    })),
  };
}

function managePage(sid, shop) {
  const css = PAGE_CSS + FORM_CSS + TALK_CSS + `
.fab{display:none!important}
.it{display:grid;grid-template-columns:1fr 84px 32px;gap:6px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px}
.it .sub2{grid-column:1/3;display:grid;grid-template-columns:1fr 84px;gap:6px}
.it input{padding:8px 10px;font-size:15px}
.x{background:none;border:0;color:var(--soft);font-size:20px;cursor:pointer}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 16px 18px;background:linear-gradient(transparent,var(--bg) 30%)}
.bar div{max-width:560px;margin:0 auto;display:flex;gap:10px;align-items:center}
.save{flex:1;border:0;background:var(--acc);color:#1d1206;font:inherit;font-weight:700;padding:15px;border-radius:14px;cursor:pointer}
.mic{width:56px;height:56px;border-radius:50%;border:0;background:var(--ink);color:var(--bg);font-size:22px;cursor:pointer;flex:none}
.mic.on{background:#c0392b;color:#fff;animation:p 1.2s infinite}
@keyframes p{50%{transform:scale(1.08)}}
.say{margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:15px;display:none}
.say small{display:block;color:var(--soft);margin-bottom:4px}
.top{display:flex;justify-content:space-between;align-items:center}
.top a{color:var(--soft);font-size:14px}
.tr{display:flex;align-items:center;gap:14px}.tr .login{text-decoration:none}
.tp{display:grid;grid-template-columns:1fr 110px;gap:6px}
h2{font:650 24px var(--disp);letter-spacing:-.01em;margin:34px 0 4px}
details.set{margin-top:34px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:4px 16px 14px}
details.set summary{cursor:pointer;font:600 17px var(--disp);padding:12px 0 6px;list-style:none}
details.set summary::-webkit-details-marker{display:none}
details.set summary:after{content:"＋";float:right;color:var(--soft)}
details.set[open] summary:after{content:"−"}
.oc,.it,.share{box-shadow:var(--sh);border-radius:18px}
.share{display:flex;gap:14px;align-items:center;margin-top:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.share svg{width:120px;height:120px;flex:none;border-radius:6px}
.sb{display:grid;gap:8px;flex:1;min-width:0}.sb small{color:var(--soft);font-size:12px;word-break:break-all}
.sh{display:block;text-align:center;font:inherit;font-size:14px;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:8px;text-decoration:none;cursor:pointer}
.sh.wa{background:var(--acc);border-color:var(--acc);color:#1d1206}
.oc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:15px}
.oc .hd{display:flex;justify-content:space-between;gap:8px}.oc small{display:block;color:var(--soft);font-size:13px;margin-top:3px}
.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.acts button{font:inherit;font-size:14px;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:7px 12px;cursor:pointer}
.acts button.pri{background:var(--acc);border-color:var(--acc);color:#1d1206}
`;
  const data = JSON.stringify(shopView(shop)).replace(/</g, "\\u003c");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="theme-color" content="#fbf5ea"><title>${h(shop.shopName)} · manage</title>${FONTS}<style>${css}</style></head><body><main>
<div class="top"><span class="mark"><i></i>munshi</span><a href="/s/${encodeURIComponent(sid)}" target="_blank">view ↗</a></div>
<div class="shead rise" style="display:flex;align-items:center;gap:14px;margin-top:22px"><span class="av" style="--hu:${hue(shop.shopName)};width:56px;height:56px;border-radius:18px;font-size:26px">${h(initial(shop.shopName))}</span><div><h1 style="margin:0">${h(shop.shopName)}</h1><p class="sub" id="cash" style="margin:0"></p></div></div>
<div class="say" id="say"></div>
<h2>Orders</h2>
<div class="list" id="orders"></div>
<h2>Items</h2>
<div class="list" id="items"></div>
<div class="list"><button class="add" id="addb">+ add item</button>
<div class="tp"><select id="tc"><option value="">📋 template</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${h(k)}">${h(t.label.en)}</option>`).join("")}</select><select id="tl">${LANGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div></div>
<h2>Share</h2>
<div class="share">${qrSvg(webLink(shop, sid))}<div class="sb">
<a class="sh wa" href="${h(waShare(shop, sid))}" target="_blank" rel="noopener">WhatsApp</a>
<a class="sh" href="https://t.me/share/url?url=${encodeURIComponent(webLink(shop, sid))}&amp;text=${encodeURIComponent(shop.shopName)}" target="_blank" rel="noopener">Telegram</a>
<button class="sh" id="copy" data-link="${h(webLink(shop, sid))}">Copy link</button></div></div>
<details class="set"><summary>Shop details</summary><div class="f"><label>shop name</label><input id="n"><label>area</label><input id="a"><label>phone</label><input id="p" inputmode="tel"><label>UPI ID</label><input id="u" placeholder="name@bank" autocapitalize="off"></div></details>
<div style="height:90px"></div>
</main>
<div class="bar"><div><button class="mic" id="mic" title="Talk to Munshi">🎙</button><button class="save" id="save">Save</button></div></div>
${TALK_HTML}
<script>
const API = "/api/m/${encodeURIComponent(sid)}" + location.search;
let S = ${data};
const $ = id => document.getElementById(id);
function row(it, i) {
  const d = document.createElement("div"); d.className = "it";
  d.innerHTML = '<input placeholder="item" data-k="name"><input placeholder="₹" inputmode="decimal" data-k="price"><button class="x" title="remove">×</button><div class="sub2"><input placeholder="local name" data-k="local"><input placeholder="unit" data-k="unit"></div>';
  d.querySelectorAll("input").forEach(inp => { inp.value = it[inp.dataset.k] ?? ""; inp.oninput = () => { S.items[i][inp.dataset.k] = inp.value; dirty(); }; });
  d.querySelector(".x").onclick = () => { S.items.splice(i, 1); render(); dirty(); };
  return d;
}
function render() {
  $("n").value = S.shopName; $("a").value = S.area; $("p").value = S.phone; $("u").value = S.upi || "";
  const box = $("items"); box.innerHTML = ""; S.items.forEach((it, i) => box.appendChild(row(it, i)));
}
function dirty() { $("save").textContent = "Save"; }
["n","a","p","u"].forEach((id, j) => $(id).oninput = e => { S[["shopName","area","phone","upi"][j]] = e.target.value; dirty(); });
$("addb").onclick = () => { S.items.push({ name: "", local: "", price: "", unit: "" }); render(); dirty(); $("items").lastChild.querySelector("input").focus(); };
$("save").onclick = async () => {
  $("save").textContent = "Saving…";
  const r = await (await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(S) })).json();
  if (r.error) { $("save").textContent = "Save"; return alert(r.error); }
  S = r.shop; render(); $("save").textContent = "Saved ✓";
};
$("tc").onchange = async () => {
  const cat = $("tc").value; if (!cat) return;
  const r = await (await fetch(API.replace("?", "/template/" + encodeURIComponent(cat) + "?") + "&lang=" + $("tl").value + "&have=" + S.items.length)).json();
  $("tc").value = "";
  if (!r.items || !r.items.length) return show("No room for more items.");
  S.items.push(...r.items); render(); dirty();
  show("Added " + r.items.length + ". Check the prices, then Save.");
};
const OAPI = API.replace("?", "/orders?"), ST = { new: "🟡 new", accepted: "✅ accepted", out: "🛵 out", completed: "✔ completed", declined: "✖ declined" };
const ACT = { accept: "Accept", decline: "Decline", out: "Out for delivery", complete: "Completed", paid: "Mark paid" };
const money = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
function orders(r) {
  if (r.error) show(esc(r.error));
  $("cash").textContent = "today " + money(r.cash || 0);
  const box = $("orders"); box.innerHTML = "";
  if (!r.orders || !r.orders.length) { box.innerHTML = '<p class="sub">No orders yet.</p>'; return; }
  for (const o of r.orders) {
    const d = document.createElement("div"); d.className = "oc";
    d.innerHTML = '<div class="hd"><b></b><span></span></div><small class="l"></small><small class="w"></small><div class="acts"></div>';
    d.querySelector("b").textContent = "#" + o.oid + " · " + money(o.total);
    d.querySelector(".hd span").textContent = (ST[o.status] || o.status) + (o.status === "out" && o.mode === "pickup" ? " (ready)" : "");
    d.querySelector(".l").textContent = o.when + " · " + (o.mode === "pickup" ? "pickup" : "delivery") + (o.source === "web" ? " · web" : "") + (o.payment === "upi" ? (o.paid ? " · UPI paid ✓" : " · UPI unpaid") : "") + " · " + o.lines;
    d.querySelector(".w").textContent = [o.who, o.phone, o.note && "“" + o.note + "”"].filter(Boolean).join(" · ");
    for (const a of o.actions) {
      const b = document.createElement("button"); b.textContent = a === "out" && o.mode === "pickup" ? "Ready for pickup" : ACT[a];
      if (a !== "decline") b.className = "pri";
      b.onclick = async () => { b.disabled = true; orders(await (await fetch(OAPI.replace("?", "/" + o.oid + "?"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: a }) })).json()); };
      d.querySelector(".acts").appendChild(b);
    }
    box.appendChild(d);
  }
}
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("copy").dataset.link); $("copy").textContent = "Copied ✓"; } catch { prompt("Copy this link", $("copy").dataset.link); } };
const loadOrders = async () => { try { orders(await (await fetch(OAPI)).json()); } catch {} };
loadOrders(); setInterval(loadOrders, 20000);
function show(html) { const b = $("say"); b.innerHTML = html; b.style.display = "block"; }
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
window.TALK = {
  url: API.replace("?", "/voice?"), hello: "Namaste! Tell me what to change, or ask about sales 🎙",
  extra: () => ({}),
  apply: (r, say) => { (r.notes || []).forEach(n => say("n", n)); if (r.shop) { S = r.shop; render(); $("save").textContent = "Saved ✓"; } },
};
${TALK_JS}
$("mic").onclick = () => $("fab").click();
render();
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// ---------- homepage ----------

function hue(s) { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.codePointAt(0)) % 360; return x; }
function initial(s) { return ([...String(s).trim()][0] || "•").toUpperCase(); }
function avatar(name) { return `<span class="av" style="--hu:${hue(name)}">${h(initial(name))}</span>`; }

const HOME_CSS = `
body{padding-top:18px}
main{max-width:1040px}
.hero{display:grid;gap:34px;align-items:center;margin-top:34px}
@media (min-width:860px){.hero{grid-template-columns:1.1fr .9fr;margin-top:56px}}
.kick{display:inline-flex;gap:8px;align-items:center;font-size:13px;font-weight:600;color:var(--leaf);background:color-mix(in srgb,var(--leaf) 10%,transparent);border-radius:999px;padding:6px 12px}
.hero h1{font-size:clamp(42px,8.5vw,72px);line-height:.98;margin:18px 0 16px}
.hero h1 em{font-style:italic;color:var(--acc2)}
.lead{font-size:18px;color:var(--soft);max-width:30em}
.ctas{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:15px 22px;border-radius:16px;font-weight:700;text-decoration:none;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.btn.main{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.btn:hover{transform:translateY(-1px)}
.say{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.say span{font-size:14px;border:1px dashed var(--line);border-radius:999px;padding:6px 12px;color:var(--soft)}
.phone{position:relative;justify-self:center;width:min(100%,360px);background:var(--card);border:1px solid var(--line);border-radius:34px;padding:18px 16px 20px;box-shadow:0 30px 60px -30px rgba(80,40,0,.45)}
.phone:before{content:"";position:absolute;inset:-14px -14px auto auto;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--acc) 35%,transparent),transparent 70%);z-index:-1}
.bub{max-width:85%;padding:10px 14px;border-radius:18px;font-size:14px;margin-top:10px}
.bub.me{margin-left:auto;background:#dff3dc;color:#183b1a;border-bottom-right-radius:6px}
.bub.bot{background:var(--bg2);border-bottom-left-radius:6px}
.wave{display:flex;align-items:center;gap:3px;height:22px}
.wave i{width:3px;border-radius:2px;background:currentColor;opacity:.7;animation:w 1.1s ease-in-out infinite}
.wave i:nth-child(2n){animation-delay:.15s}.wave i:nth-child(3n){animation-delay:.3s}
@keyframes w{0%,100%{height:6px}50%{height:20px}}
.mini{margin-top:12px;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.mini div{display:flex;justify-content:space-between;padding:9px 12px;font-size:14px;border-top:1px solid var(--line)}
.mini div:first-child{border-top:0;font:600 15px var(--disp);background:var(--bg2)}
.mini b{color:var(--acc2)}
h2{font:650 clamp(26px,5vw,34px)/1.1 var(--disp);letter-spacing:-.015em;margin:80px 0 22px}
.steps3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:70px}
.step{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:var(--sh)}
.step .ic{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;font-size:22px;background:var(--bg2)}
.step h3{font:600 20px var(--disp);margin:14px 0 0}
.step p{color:var(--soft);font-size:15px}
.feats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media (min-width:760px){.feats{grid-template-columns:repeat(4,1fr)}}
.feat{border-top:2px solid var(--acc);padding-top:12px}
.feat b{display:block;font:600 17px var(--disp)}
.feat span{color:var(--soft);font-size:14px}
.shops{display:grid;gap:10px}
@media (min-width:760px){.shops{grid-template-columns:repeat(2,1fr)}}
.band{margin-top:80px;background:var(--ink);color:var(--bg);border-radius:28px;padding:34px 26px;display:grid;gap:16px;align-items:center}
@media (min-width:760px){.band{grid-template-columns:1fr auto;padding:40px}}
.band h2{margin:0;color:var(--bg)}
.band .btn{background:var(--acc);color:#1d1206;border-color:var(--acc)}
footer{margin-top:40px;color:var(--soft);font-size:13px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
`;

// ---------- owner log in by phone: MSG91 OTP widget on the page, the server verifies the token ----------

const LOGIN_HITS = new Map(); // per isolate: a brake on code guessing
const loginLimited = req => softLimited(LOGIN_HITS, req, 10);
const digits10 = s => String(s || "").replace(/\D/g, "").slice(-10);
const jsStr = v => JSON.stringify(String(v || "")).replace(/</g, "\\u003c");

// The mobile MSG91 says it verified (same fields Qrave's extractVerifiedMobile reads).
function verifiedMobile(data) {
  const d = data || {};
  for (const c of [d.message, d.mobile, d.identifier, d.phone, d.data && d.data.mobile, d.data && d.data.identifier, d.data && d.data.message]) {
    if (typeof c !== "string" && typeof c !== "number") continue;
    const t = String(c).trim();
    if (/^\+?\d{10,15}$/.test(t)) return digits10(t);
  }
  return "";
}

async function loginPage(env) {
  const c = { env, st: new Store(env.DB) };
  const mark = `<a class="mark" href="/" style="text-decoration:none"><i></i>munshi</a>`;
  const css = FORM_CSS + `button.btn{font:inherit;cursor:pointer}#out{display:grid;gap:10px;margin-top:18px}#out .pill{justify-content:center}`;
  const headers = { cache: "no-store" };
  if (!env.MSG91_WIDGET_ID || !env.MSG91_TOKEN_AUTH) {
    const tg = `https://t.me/${await botName(c)}`;
    return pageHtml("Log in · munshi", `<div class="top">${mark}<a href="/">back</a></div><h1>Log in</h1>
<p class="note">Login by phone is not set up yet. <a href="${tg}">Start on Telegram</a></p>`, { css, ...headers });
  }
  return pageHtml("Log in · munshi", `<div class="top">${mark}<a href="/">back</a></div>
<h1>Log in</h1>
<p class="note" id="msg" hidden></p>
<form id="pf" class="f"><label for="pn">phone</label><input id="pn" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="98765 43210" required>
<button id="pb" class="btn main" type="submit">Send code</button></form>
<form id="cf" class="f" hidden><label for="cd">code</label><input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="4" placeholder="1234" required>
<button id="cb" class="btn main" type="submit">Verify</button></form>
<div id="out"></div>
<script>
(() => {
const W = ${jsStr(env.MSG91_WIDGET_ID)}, T = ${jsStr(env.MSG91_TOKEN_AUTH)};
const $ = id => document.getElementById(id);
const say = t => { $("msg").textContent = t; $("msg").hidden = !t; };
const reason = e => typeof e === "string" ? e : (e && e.message) || "";
let ready = false, phone = "";
const s = document.createElement("script");
s.src = "https://control.msg91.com/app/assets/otp-provider/otp-provider.js";
s.async = true;
s.onerror = () => say("Could not load the code service.");
s.onload = () => setTimeout(() => {
  try { window.initSendOTP({ widgetId: W, tokenAuth: T, exposeMethods: true, success() {}, failure() {} }); } catch (e) {}
  let n = 0;
  const iv = setInterval(() => {
    if (window.sendOtp && window.verifyOtp) { clearInterval(iv); ready = true; }
    else if (++n >= 50) { clearInterval(iv); say("The code service did not start."); }
  }, 200);
}, 500);
document.body.appendChild(s);
const links = list => {
  $("cf").hidden = true; $("pf").hidden = true; $("out").innerHTML = "";
  for (const x of list) { const a = document.createElement("a"); a.className = "pill"; a.href = x.url; a.textContent = x.name; $("out").appendChild(a); }
};
$("pf").onsubmit = e => {
  e.preventDefault();
  phone = $("pn").value.replace(/\\D/g, "").slice(-10);
  if (phone.length !== 10) return say("Enter the 10-digit number.");
  if (!ready) return say("One moment.");
  $("pb").disabled = true;
  window.sendOtp("91" + phone, () => {
    $("pb").disabled = false; $("pf").hidden = true; $("cf").hidden = false; $("cd").focus(); say("Code sent.");
  }, err => { $("pb").disabled = false; say(reason(err) || "Could not send the code."); });
};
$("cf").onsubmit = e => {
  e.preventDefault();
  const code = $("cd").value.trim();
  if (!/^\\d{4}$/.test(code)) return say("Enter the 4-digit code.");
  if (!ready) return say("One moment.");
  $("cb").disabled = true;
  const fail = m => { $("cb").disabled = false; say(m); };
  window.verifyOtp(code, async data => {
    const token = data && data.message;
    if (!token) return fail("No code received. Try again.");
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, token }) });
      const j = await r.json();
      if (j.url) return (location.href = j.url);
      if (j.shops) return links(j.shops);
      fail(j.error || "Could not log in.");
      if (j.start) links([{ name: "Start on Telegram", url: j.start }]);
    } catch (x) { fail("Network problem. Try again."); }
  }, err => fail(reason(err) || "That code did not match."));
};
})();
</script>`, { css, ...headers });
}

async function loginApi(req, env) {
  const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
  if (!env.MSG91_AUTH_KEY) return json({ error: "Login by phone is not set up yet." }, 503);
  if (loginLimited(req)) return json({ error: "Too many tries. Wait a few minutes." }, 429);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const phone = digits10(b && b.phone), token = b && typeof b.token === "string" ? b.token : "";
  if (phone.length !== 10 || !token || token.length > 4000) return json({ error: "Enter your number and the code." }, 400);
  let data = null;
  try {
    const r = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ authkey: env.MSG91_AUTH_KEY, "access-token": token }),
    });
    data = await r.json();
  } catch { data = null; }
  // Refuse unless MSG91 says the token is good AND names the verified mobile. Never trust the phone we were sent alone.
  const mobile = data && data.type === "success" ? verifiedMobile(data) : "";
  if (!mobile || mobile !== phone) return json({ error: "That code did not match this number." }, 401);
  const c = { env, st: new Store(env.DB), bg: [] };
  const mine = (await allShops(c)).filter(([, sh]) => digits10(sh.phone) === phone);
  if (!mine.length) return json({ error: "No shop with this number.", start: `https://t.me/${await botName(c)}` }, 404);
  if (mine.length === 1) return json({ url: await manageLink(env, mine[0][0]) });
  return json({ shops: await Promise.all(mine.map(async ([id, sh]) => ({ name: sh.shopName || id, url: await manageLink(env, id) }))) });
}

async function homePage(c, mark) {
  const shops = await allShops(c);
  const tg = `https://t.me/${c.bot}`;
  const cards = shops.map(([id, sh]) => `<a class="row" href="/s/${encodeURIComponent(id)}"><span class="lft">${avatar(sh.shopName)}<span><b>${h(sh.shopName)}</b><small>${h(sh.area || "")}</small></span></span><span class="sub">${(sh.items || []).length} items →</span></a>`).join("");
  const body = `<div class="top">${mark}<span class="tr"><a class="login" href="/login">Log in</a><a class="pill" href="${tg}">Start</a></span></div>
<section class="hero">
  <div>
    <span class="kick rise">● ಕನ್ನಡ · हिंदी · தமிழ் · English</span>
    <h1 class="rise d1">Speak your shop <em>online.</em></h1>
    <p class="lead rise d2">One voice note. Your menu, a link, orders.</p>
    <div class="ctas rise d3"><a class="btn main" href="${tg}">🎙 Start</a>${shops.length ? `<a class="btn" href="/s/${encodeURIComponent(shops[0][0])}">See a shop</a>` : ""}</div>
  </div>
  <div class="phone rise d2" aria-hidden="true">
    <div class="bub me"><div class="wave">${"<i></i>".repeat(18)}</div></div>
    <div class="bub bot">Shop is live ✓</div>
    <div class="mini"><div>Tea Corner</div><div>Cutting chai <b>₹10</b></div><div>Masala chai <b>₹15</b></div><div>Samosa <b>₹20</b></div></div>
    <div class="bub bot">🛵 New order · ₹40</div>
  </div>
</section>

<div class="steps3">
  <div class="step"><div class="ic">🎙</div><h3>Speak</h3></div>
  <div class="step"><div class="ic">🔗</div><h3>Share</h3></div>
  <div class="step"><div class="ic">🛵</div><h3>Sell</h3></div>
</div>

${shops.length ? `<h2>Shops</h2><div class="shops">${cards}</div>` : ""}

<div class="band"><h2>Open in two minutes.</h2><a class="btn" href="${tg}">🎙 Start</a></div>
<footer><span>munshi</span><span>ಕನ್ನಡ · हिंदी · தமிழ் · English</span></footer>`;
  return pageHtml("Munshi · speak your shop online", body, { css: HOME_CSS, desc: "Send a voice note with your items and prices. Munshi builds your menu, gives you a link to share, and brings you orders." });
}
