// Smoke test: stubbed fetch + Map-backed KV, pushes updates through onboarding, buyer ordering and accept.
// Run: node test/smoke.mjs   (no network, no real keys)
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { qrMatrix } from "../src/qr.js";

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
const kb = () => calls.filter(c => c.url.endsWith("/editMessageReplyMarkup")).at(-1).body.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
assert.ok(kb().includes(`out:${oid}`), "out for delivery button after accept");

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

// public shop page: cart + checkout script that at least parses
const page = await (await W(`/s/${sid}`)).text();
assert.match(page, /data-i="0"/);
assert.match(page, /or order on Telegram/);
for (const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);

// web order: priced on the server, same shape as Telegram orders, owner alerted with the same buttons
const order$ = body => W(`/api/order/${sid}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const base = { lines: [{ i: 0, name: "Tea", q: 2, price: 1 }, { i: 1, name: "Samosa", q: 1 }], mode: "delivery",
  name: "Meena <b>", phone: "98450 12345", address: "4th cross, Jayanagar", note: "ring twice", total: 1 };
const quote = await (await order$({ ...base, quote: true })).json();
assert.deepEqual([quote.subtotal, quote.feeCharged, quote.total], [44, 52, 96], "quote ignores client prices");
assert.equal((await order$({ ...base, lines: [{ i: 0, name: "Coffee", q: 1 }] })).status, 409, "menu changed");
assert.equal((await order$({ ...base, lines: [{ i: 0, name: "Tea", q: 0 }] })).status, 400, "bad qty");
assert.equal((await order$({ ...base, phone: "12" })).status, 400, "bad phone");
assert.equal((await order$({ ...base, address: "" })).status, 400, "delivery needs address");
assert.equal((await W(`/api/order/nosuchshop`, { method: "POST", body: "{}" })).status, 404);
const nIdx = JSON.parse(kv.get("index:orders")).length;
const b3 = calls.length;
const placed = await (await order$({ ...base, loc: [12.95, 77.6] })).json();
assert.ok(placed.ok && /^\d{5}$/.test(placed.oid) && placed.code.length >= 8 && placed.url === `/o/${placed.oid}?c=${placed.code}`);
const wo = JSON.parse(kv.get(`order:${placed.oid}`));
assert.equal(JSON.parse(kv.get("index:orders")).length, nIdx + 1);
assert.deepEqual(wo.lines, [["चाय", 2, 12], ["Samosa", 1, 20]]);
assert.equal(wo.subtotal, 44);
assert.equal(wo.total, wo.subtotal + wo.feeCharged);
assert.ok(wo.km > 0);
for (const k of ["shop", "lines", "total", "status", "at", "mode", "fee", "feeCharged", "address", "phone"]) assert.ok(k in wo, k);
assert.deepEqual([wo.source, wo.buyerName, wo.buyerPhone, wo.status, wo.note], ["web", "Meena <b>", "9845012345", "new", "ring twice"]);
const alert = calls.slice(b3).find(c => c.url.endsWith("/sendMessage") && c.body.chat_id === OWNER);
assert.ok(alert, "owner alerted");
assert.match(alert.body.text, new RegExp(`New order #${placed.oid}.*web`));
assert.match(alert.body.text, /Meena &lt;b&gt;, 4th cross/);
assert.deepEqual(alert.body.reply_markup.inline_keyboard[0].map(b => b.callback_data), [`ok:${placed.oid}`, `no:${placed.oid}`]);
const pick = await (await order$({ ...base, mode: "pickup", address: "" })).json();
assert.ok(pick.ok);
assert.equal(JSON.parse(kv.get(`order:${pick.oid}`)).total, 44, "pickup: no fee");

// status page: needs the code; never shows the buyer's phone or address
const sp = await W(placed.url);
assert.equal(sp.status, 200);
const spText = await sp.text();
assert.match(spText, new RegExp(`Order #${placed.oid}`));
assert.ok(!spText.includes("9845012345") && !spText.includes("4th cross") && !spText.includes("Meena"), "no buyer details");
for (const m of spText.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
assert.equal((await W(`/o/${placed.oid}?c=wrongcode`)).status, 404);
assert.equal((await W(`/o/${placed.oid}`)).status, 404);
assert.equal((await W(`/o/${oid}?c=`)).status, 404, "telegram orders have no status page");
assert.deepEqual(await (await W(`/api/o/${placed.oid}?c=${placed.code}`)).json(), { status: "new" });
assert.equal((await W(`/api/o/${placed.oid}?c=nope`)).status, 404);

// telegram: out for delivery -> completed, buyer told each time; invalid taps refused
await post(cb(OWNER, `ok:${oid}`));
assert.match(sent().at(-1), /accepted already/);
await post(cb(OWNER, `done:${oid}`));
assert.equal(JSON.parse(kv.get(`order:${oid}`)).status, "accepted", "can't complete before out");
await post(cb(OWNER, `out:${oid}`));
assert.equal(JSON.parse(kv.get(`order:${oid}`)).status, "out");
assert.match(sent().at(-1), /out for delivery/);
assert.ok(kb().includes(`done:${oid}`));
await post(cb(OWNER, `done:${oid}`));
assert.equal(JSON.parse(kv.get(`order:${oid}`)).status, "completed");
assert.match(sent().at(-1), /complete/);
await post(cb(BUYER, `ok:${placed.oid}`));
assert.equal(JSON.parse(kv.get(`order:${placed.oid}`)).status, "new", "only the owner can accept");

const mp = await (await W(`/m/${sid}${mq}`)).text();
for (const m of mp.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
// sharing: WhatsApp / Telegram / copy / QR on the dashboard, WhatsApp on the public page
assert.ok(mp.includes("https://wa.me/?text=") && mp.includes(encodeURIComponent(`/s/${sid}`)));
assert.match(mp, /t\.me\/share\/url\?url=/);
assert.match(mp, /id="copy"/);
assert.match(mp, /<svg[^>]*aria-label="QR code"[\s\S]*?<path d="M/);
assert.ok(page.includes("https://wa.me/?text="), "share on the public page");
assert.equal(qrMatrix("https://munshi.hrejuh.workers.dev/s/" + sid).length, 33, "version 4");
assert.equal(qrMatrix("x".repeat(300)), null, "too long for v10");

// owner web dashboard: orders, valid transitions only, cash collected
const OA = (o, action) => W(`/api/m/${sid}/orders/${o}${mq}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
assert.equal((await W(`/api/m/${sid}/orders?k=bad`)).status, 403);
let ov = await (await W(`/api/m/${sid}/orders${mq}`)).json();
assert.equal(ov.orders[0].oid === placed.oid || ov.orders[1].oid === placed.oid, true, "newest first");
assert.deepEqual(ov.orders.find(o => o.oid === placed.oid).actions, ["accept", "decline"]);
assert.equal(ov.cash, order.total, "cash = the completed telegram order");
const b4 = calls.length;
ov = await (await OA(placed.oid, "complete")).json();
assert.match(ov.error, /new already/);
ov = await (await OA(placed.oid, "accept")).json();
assert.ok(ov.ok);
assert.equal(JSON.parse(kv.get(`order:${placed.oid}`)).status, "accepted");
await OA(placed.oid, "out");
ov = await (await OA(placed.oid, "complete")).json();
assert.equal(JSON.parse(kv.get(`order:${placed.oid}`)).status, "completed");
assert.equal(ov.cash, order.total + wo.total);
assert.ok(!calls.slice(b4).some(c => c.url.endsWith("/sendMessage")), "web buyers have no Telegram chat");
assert.deepEqual(await (await W(`/api/o/${placed.oid}?c=${placed.code}`)).json(), { status: "completed" });
assert.match(await (await W(placed.url)).text(), /Completed/);
ov = await (await OA(pick.oid, "decline")).json();
assert.equal(JSON.parse(kv.get(`order:${pick.oid}`)).status, "declined");
assert.equal((await (await OA(pick.oid, "accept")).json()).error.includes("declined"), true);
assert.equal((await (await OA("99999", "accept")).json()).error, "Order not found.");

console.log = origLog;
assert.deepEqual(errors, [], "no errors logged");
console.log(`ok: ${calls.length} stubbed calls, shop ${sid}, order #${oid} total ${order.total}`);
