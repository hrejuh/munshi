// Smoke test: stubbed fetch + Map-backed KV, pushes updates through onboarding, buyer ordering and accept.
// Run: node test/smoke.mjs   (no network, no real keys)
import assert from "node:assert/strict";
import worker from "../src/index.js";

const kv = new Map();
const DB = {
  async get(k) { return kv.has(k) ? kv.get(k) : null; },
  async put(k, v) { kv.set(k, String(v)); },
};
const env = { DB, TELEGRAM_TOKEN: "test-token", ELEVENLABS_API_KEY: "x", OPENROUTER_API_KEY: "x",
  TELEGRAPH_TOKEN: "x", WEBHOOK_SECRET: "s3cret" };

const calls = [];
const errors = [];
const origLog = console.log;
console.log = (...a) => { if (/ERR|failed/.test(String(a[0]))) errors.push(a.join(" ")); };

const json = o => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  let body = init.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch {} }
  calls.push({ url, body });
  if (url.includes("api.telegram.org/file/")) return new Response(new Uint8Array([1, 2, 3]));
  if (url.includes("api.telegram.org/bot")) {
    const method = url.split("/").pop();
    if (method === "getMe") return json({ ok: true, result: { username: "Munshi_test_bot" } });
    if (method === "getFile") return json({ ok: true, result: { file_path: "voice/1.oga" } });
    return json({ ok: true, result: { message_id: 1 } });
  }
  if (url.includes("speech-to-text")) return json({ text: "chai 15, samosa 20", language_code: "hin" });
  if (url.includes("text-to-speech")) {
    assert.ok(url.includes("cgSgspJ2msm6clMCkdW9") && url.includes("mp3_44100_64"));
    assert.ok(body.text.length <= 300 && !/[<>]/.test(body.text), "tts text cleaned");
    return new Response(new Uint8Array([0xff, 0xfb, 0x90]));
  }
  if (url.includes("openrouter.ai")) {
    const p = body.messages[0].content;
    let out;
    if (p.startsWith("A shopkeeper answered")) out = { value: p.split("Answer: ")[1].trim() };
    else if (p.startsWith("You help an Indian")) out = { items: [{ name: "Tea", local: "चाय", price: 15, unit: "cup" }, { name: "Samosa", local: "", price: 20, unit: "each" }] };
    else if (p.includes("talking to the shopkeeper")) out = { actions: [{ type: "price", index: 0, price: 12 }], reply: "चाय अब 12 रुपये।" };
    else out = { add: [{ index: 1, qty: 2 }], remove: [], checkout: true, reply: "2 samosa added. Name and address?" };
    return json({ choices: [{ message: { content: JSON.stringify(out) } }] });
  }
  if (url.includes("telegra.ph")) return json({ ok: true, result: { url: "https://telegra.ph/Ravi-Stores-10-24" } });
  throw new Error("unexpected fetch " + url);
};

let uid = 100;
async function post(update, secret = "s3cret") {
  const waits = [];
  const res = await worker.fetch(new Request("https://munshi.example.workers.dev/tg/s3cret", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret, "content-type": "application/json" },
    body: JSON.stringify({ update_id: uid++, ...update }),
  }), env, { waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const OWNER = 555, BUYER = 777;
const msg = (chat, extra) => ({ message: { message_id: 1, chat: { id: chat }, ...extra } });
const cb = (chat, data) => ({ callback_query: { id: "q", data, message: { message_id: 9, chat: { id: chat } } } });
const sent = () => calls.filter(c => c.url.endsWith("/sendMessage")).map(c => c.body.text);

// routes
assert.equal((await (await worker.fetch(new Request("https://x.dev/"), env, {})).text()).includes("Shops on Munshi"), true);
assert.equal((await post(msg(OWNER, { text: "/start" }), "wrong")).status, 403);

// onboarding by text
await post(msg(OWNER, { text: "/start" }));
assert.match(sent().at(-1), /What's your shop called/);
await post(msg(OWNER, { text: "Ravi Stores" }));
assert.match(sent().at(-1), /Ravi Stores.*Which area/s);
await post(msg(OWNER, { text: "Jayanagar" }));
await post(msg(OWNER, { contact: { phone_number: "+91 98765 43210" } }));
await post(msg(OWNER, { location: { latitude: 12.93, longitude: 77.58 } }));
assert.match(sent().at(-1), /what do you sell/);

// items by voice -> transcript, text reply, then a voice reply
const before = calls.length;
await post(msg(OWNER, { voice: { file_id: "F1" } }));
const voiceCalls = calls.slice(before);
assert.ok(voiceCalls.some(c => c.url.endsWith("/sendVoice")), "voice reply sent");
assert.ok(voiceCalls.findIndex(c => c.url.endsWith("/sendMessage")) < voiceCalls.findIndex(c => c.url.endsWith("/sendVoice")), "text before voice");
assert.match(sent().at(-1), /Added 2/);

// dedupe a retried update
const n = calls.length;
uid--;
await post(msg(OWNER, { voice: { file_id: "F1" } }));
assert.equal(calls.length, n, "duplicate update skipped");

// template at the items step: pick one, pick a language, items are appended
await post(cb(OWNER, "tpl"));
assert.match(sent().at(-1), /Pick a template/);
await post(cb(OWNER, "tpl:bakery"));
await post(cb(OWNER, "tpl:bakery:kn"));
assert.match(sent().at(-1), /Added 37 from Bakery/);
assert.equal(JSON.parse(kv.get(`sess:${OWNER}`)).draft.items.length, 39);

await post(cb(OWNER, "ob_done"));
const sid = JSON.parse(kv.get(`owner:${OWNER}`));
const shop = JSON.parse(kv.get(`shop:${sid}`));
assert.equal(shop.items.length, 39);
assert.ok(shop.items[2].local && /[\u0C80-\u0CFF]/.test(shop.items[2].local), "kannada local names");
assert.equal(shop.page, "https://telegra.ph/Ravi-Stores-10-24");
assert.deepEqual(JSON.parse(kv.get("index:shops")), [sid]);
assert.ok(sent().some(t => /Ravi Stores is open/.test(t)));

// owner chat by text: no voice reply
const b2 = calls.length;
await post(msg(OWNER, { text: "chai 12 kar do" }));
assert.ok(!calls.slice(b2).some(c => c.url.endsWith("/sendVoice")), "no voice for text input");
assert.equal(JSON.parse(kv.get(`shop:${sid}`)).items[0].price, 12);

// buyer: open shop, tap, chat, delivery, location, address, phone
await post(msg(BUYER, { text: `/start s_${sid}` }));
await post(cb(BUYER, `a:${sid}:0`));
await post(msg(BUYER, { text: "do samose bhi" }));
assert.equal(sent().at(-1), "How do you want it?");
await post(cb(BUYER, "mode:delivery"));
await post(msg(BUYER, { location: { latitude: 12.97, longitude: 77.59 } }));
await post(msg(BUYER, { text: "Asha, 12 MG Road" }));
await post(msg(BUYER, { contact: { phone_number: "9000000000" } }));
const oid = JSON.parse(kv.get("index:orders"))[0];
const order = JSON.parse(kv.get(`order:${oid}`));
assert.equal(order.subtotal, 12 + 40);
assert.ok(order.fee > 52, "distance fee above base");
assert.equal(order.total, order.subtotal + order.fee);
await post(cb(OWNER, `ok:${oid}`));
assert.equal(JSON.parse(kv.get(`order:${oid}`)).status, "accepted");
assert.match(sent().at(-1), /accepted order/);

// owner web dashboard: link comes from the Telegram dashboard button
const mlink = calls.flatMap(c => (c.body && c.body.reply_markup && c.body.reply_markup.inline_keyboard || []).flat()).map(b => b.url).find(u => u && u.includes("/m/"));
const mq = new URL(mlink).search;
const W = (path, init) => worker.fetch(new Request("https://x.dev" + path, init), env, { waitUntil: () => {} });
assert.equal((await W(`/m/${sid}?k=bad`)).status, 403);
assert.match(await (await W(`/m/${sid}${mq}`)).text(), /start from a template/);
const tplRes = await (await W(`/api/m/${sid}/template/kirana${mq}&lang=hi&have=10`)).json();
assert.equal(tplRes.items.length, 50);
assert.ok(tplRes.items.every(i => i.name && i.price > 0) && /[\u0900-\u097F]/.test(tplRes.items[0].local));

// dashboards
await post(msg(OWNER, { text: "/sales" }));
assert.match(sent().at(-1), /Today: <b>1<\/b> orders/);

console.log = origLog;
assert.deepEqual(errors, [], "no errors logged");
console.log(`ok: ${calls.length} stubbed calls, shop ${sid}, order #${oid} total ${order.total}`);
