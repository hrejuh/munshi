"""Munshi Telegram bot.

Shopkeeper: guided onboarding (name -> area -> number -> items by voice/text), then a dashboard to
add items, edit prices, remove items and see sales. Buyer: opens the shop link, taps items, orders
cash on delivery; shopkeeper accepts. Each shop also gets a public Telegra.ph catalogue page, republished on every change.

Env (.env next to this file): TELEGRAM_TOKEN (required), ELEVENLABS_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY (fallback when Gemini is down).
TELEGRAPH_TOKEN enables the public pages.
"""
import html, json, os, re, time, random, string, threading, traceback
from datetime import datetime, timezone, timedelta
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, ".env")
for line in open(ENV) if os.path.exists(ENV) else []:
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1)
        os.environ.setdefault(k, v)

TG = os.environ["TELEGRAM_TOKEN"]
XI = os.environ.get("ELEVENLABS_API_KEY", "")
GEM = os.environ.get("GEMINI_API_KEY", "")
API = f"https://api.telegram.org/bot{TG}"
DB_PATH = os.path.join(HERE, "shops.json")
TPH = os.environ.get("TELEGRAPH_TOKEN", "")
IST = timezone(timedelta(hours=5, minutes=30))
LOCK = threading.Lock()

db = json.load(open(DB_PATH)) if os.path.exists(DB_PATH) else {}
for k in ("shops", "orders", "sessions", "owners"):
    db.setdefault(k, {})
for sid, sh in db["shops"].items():
    db["owners"].setdefault(str(sh["owner"]), sid)


def save():
    with LOCK:
        tmp = DB_PATH + ".tmp"
        json.dump(db, open(tmp, "w"), ensure_ascii=False, indent=1)
        os.replace(tmp, DB_PATH)


def tg(method, **params):
    r = requests.post(f"{API}/{method}", json=params, timeout=60)
    out = r.json()
    if not out.get("ok"):
        print("TG ERR", method, out, flush=True)
    else:
        print(f"  -> {method} {str(params.get('text', ''))[:50]!r}", flush=True) if method == "sendMessage" else None
    return out.get("result")


def send(chat, text, buttons=None, **kw):
    if buttons is not None:
        kw["reply_markup"] = {"inline_keyboard": buttons}
    return tg("sendMessage", chat_id=chat, text=text, parse_mode="HTML", disable_web_page_preview=True, **kw)


def rs(n):
    n = float(n)
    return f"₹{int(n):,}" if n.is_integer() else f"₹{n:,.2f}"


def h(s):
    return html.escape(str(s or ""))


def shop_link(sid):
    return f"https://t.me/{BOT_NAME}?start=s_{sid}"


def web_link(sid):
    return db["shops"].get(sid, {}).get("page", "")


def iname(it):
    return it.get("local") or it.get("name")


# ---------- understanding speech and text ----------

def transcribe(file_id):
    t0 = time.time()
    f = tg("getFile", file_id=file_id)
    audio = requests.get(f"https://api.telegram.org/file/bot{TG}/{f['file_path']}", timeout=60).content
    r = requests.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": XI},
                      data={"model_id": "scribe_v1"}, files={"file": ("voice.ogg", audio, "audio/ogg")}, timeout=45)
    r.raise_for_status()
    open(os.path.join(HERE, "last_voice.ogg"), "wb").write(audio)
    j = r.json()
    if not re.sub(r"\[[^\]]*\]|\W", "", j.get("text", "")) and GEM:
        try:
            import base64
            g = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={GEM}",
                json={"contents": [{"parts": [{"inline_data": {"mime_type": "audio/ogg", "data": base64.b64encode(audio).decode()}},
                                              {"text": "Transcribe this voice note exactly, in its original language and script. Return only the words. If there is no speech, return nothing."}]}]},
                timeout=20)
            g.raise_for_status()
            j["text"] = g.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            print("  stt fallback: gemini", flush=True)
        except Exception as e:
            print(f"  stt fallback failed: {str(e)[:100]}", flush=True)
    print(f"  stt {time.time() - t0:.1f}s lang={j.get('language_code')} bytes={len(audio)} text={j.get('text', '')[:120]!r}", flush=True)
    return j.get("text", "").strip()


OR_KEY = os.environ.get("OPENROUTER_API_KEY", "")


def _openrouter(prompt):
    r = requests.post("https://openrouter.ai/api/v1/chat/completions", timeout=15,
                      headers={"Authorization": f"Bearer {OR_KEY}"},
                      json={"model": "google/gemini-2.5-flash-lite", "response_format": {"type": "json_object"},
                            "messages": [{"role": "user", "content": prompt}]})
    r.raise_for_status()
    txt = r.json()["choices"][0]["message"]["content"].strip()
    return json.loads(re.sub(r"^```(?:json)?|```$", "", txt).strip())


def _gemini(prompt):
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={GEM}",
        json={"contents": [{"parts": [{"text": prompt}]}],
              "generationConfig": {"responseMimeType": "application/json", "temperature": 0}},
        timeout=15)
    r.raise_for_status()
    return json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])


def gemini_json(prompt):
    """JSON from an LLM: OpenRouter first (fast, reliable), Google AI Studio as fallback."""
    last = None
    for name, fn, on in (("openrouter", _openrouter, OR_KEY), ("gemini", _gemini, GEM)):
        if not on:
            continue
        t0 = time.time()
        try:
            out = fn(prompt)
            print(f"  {name} {time.time() - t0:.1f}s", flush=True)
            return out
        except Exception as e:
            print(f"  {name} failed after {time.time() - t0:.1f}s: {str(e).split(' for url')[0][:120]}", flush=True)
            last = e
    raise last or RuntimeError("no LLM configured")


ITEMS_PROMPT = """You help an Indian neighbourhood shop list its products. The shopkeeper said the text below, possibly in Kannada, Hindi, Tamil, English or a mix, possibly transliterated.
Return only a JSON array: [{"name": English product name, "local": product name in the shopkeeper's own language and script, or "" if they spoke English, "price": number in rupees, "unit": short unit like "1 kg", "500 ml", "each"}]. Skip anything without a price.

Shopkeeper said:
"""

CLEAN_PROMPT = """A shopkeeper answered "{q}" by voice or text. Return only JSON {{"value": the answer cleaned up, in its original script, without filler words}}.

Answer: """


def parse_items(text):
    if GEM:
        try:
            out = gemini_json(ITEMS_PROMPT + text)
            out = out.get("items", []) if isinstance(out, dict) else out
            return [{"name": str(i.get("name", "")), "local": str(i.get("local", "")), "price": float(i["price"]),
                     "unit": str(i.get("unit", ""))} for i in out if i.get("price") not in (None, "", 0)]
        except Exception:
            traceback.print_exc()
    items = []
    for part in re.split(r"[,\n;।.]+(?!\d)", text):
        m = re.match(r"\s*(.+?)\s*(?:-|:|₹|rs\.?|rupaye|rupees)?\s*(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees|₹)?\s*$", part, re.I)
        if m and m.group(1).strip():
            items.append({"name": m.group(1).strip(), "local": "", "price": float(m.group(2)), "unit": ""})
    return items


def clean(q, text):
    if GEM:
        try:
            return str(gemini_json(CLEAN_PROMPT.format(q=q) + text).get("value") or text).strip()[:60]
        except Exception:
            traceback.print_exc()
    return text.strip()[:60]


def heard(m, chat):
    """Text of a message, transcribing voice notes. Returns None if nothing usable."""
    if m.get("text"):
        return m["text"].strip()
    v = m.get("voice") or m.get("audio")
    if not v:
        return None
    if not XI:
        send(chat, "Voice is off right now. Please type it.")
        return None
    tg("sendChatAction", chat_id=chat, action="typing")
    try:
        t = transcribe(v["file_id"])
    except Exception:
        traceback.print_exc()
        send(chat, "Couldn't hear that. Try again, or type it.")
        return None
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)", "", t).strip(" .।")
    if len(re.sub(r"\W", "", t)) < 2:
        send(chat, "🎧 Couldn't catch that. Please say it again, closer to the phone, or type it.")
        return None
    send(chat, f"🎧 <i>{h(t)}</i>")
    return t


# ---------- delivery (Qrave model: Rs 52 up to 3 km, Rs 11/km after; shop passes it on or absorbs it) ----------

def km(a, b):
    from math import radians, sin, cos, asin, sqrt
    la1, lo1, la2, lo2 = map(radians, (a[0], a[1], b[0], b[1]))
    x = sin((la2 - la1) / 2) ** 2 + cos(la1) * cos(la2) * sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(x)) * 1.3  # road distance is roughly 1.3x straight line


def delivery_fee(shop, loc):
    if not shop.get("loc") or not loc:
        return 52.0, None
    d = km(shop["loc"], loc)
    return float(52 + max(0, round(d - 3 + 0.49)) * 11), d


# ---------- shopkeeper ----------

def my_shop(chat):
    sid = db["owners"].get(str(chat))
    return (sid, db["shops"][sid]) if sid in db["shops"] else (None, None)


def start_onboarding(chat):
    s = sess(chat)
    s.clear()
    s.update({"step": "ob_name", "draft": {}})
    save()
    send(chat, "🏪 <b>Welcome to Munshi</b>\nLet's open your shop. Speak or type.\n\n<b>What's your shop called?</b>")


def items_summary(items, limit=30):
    return "\n".join(f"• {h(iname(i))}{' · ' + h(i['unit']) if i.get('unit') else ''} — {rs(i['price'])}" for i in items[:limit])


def onboarding_step(chat, s, m):
    step = s["step"]
    d = s.setdefault("draft", {})
    if step == "ob_phone":
        phone = (m.get("contact") or {}).get("phone_number") or (m.get("text") or "")
        digits = re.sub(r"\D", "", phone)[-10:]
        if len(digits) < 10:
            return send(chat, "Please send a 10-digit number, or tap the button.")
        d["phone"] = digits
        s["step"] = "ob_loc"
        save()
        return tg("sendMessage", chat_id=chat, text="📍 Share your shop's location, for delivery distance",
                  reply_markup={"keyboard": [[{"text": "📍 Send shop location", "request_location": True}], [{"text": "Skip"}]],
                                "resize_keyboard": True, "one_time_keyboard": True})
    if step == "ob_loc":
        loc = m.get("location")
        if loc:
            d["loc"] = [loc["latitude"], loc["longitude"]]
        s["step"] = "ob_items"
        save()
        tg("sendMessage", chat_id=chat, text="✓", reply_markup={"remove_keyboard": True})
        return send(chat, "🎙 <b>Now, what do you sell?</b>\nSay items with prices, like <i>\"aata 5 kilo 260, chawal kilo 58\"</i>.\nSend as many as you like.",
                    [[{"text": "✅ Done, open my shop", "callback_data": "ob_done"}]])
    t = heard(m, chat)
    if not t:
        return
    if step == "ob_name":
        d["shopName"] = clean("What's your shop called?", t)
        s["step"] = "ob_area"
        save()
        return send(chat, f"<b>{h(d['shopName'])}</b> ✓\n\n📍 <b>Which area?</b>")
    if step == "ob_area":
        d["area"] = clean("Which area is your shop in?", t)
        s["step"] = "ob_phone"
        save()
        return tg("sendMessage", chat_id=chat, text=f"📍 {d['area']} ✓\n\n📞 Your WhatsApp number, for orders?",
                  reply_markup={"keyboard": [[{"text": "📱 Share my number", "request_contact": True}]],
                                "resize_keyboard": True, "one_time_keyboard": True})
    if step == "ob_items":
        tg("sendChatAction", chat_id=chat, action="typing")
        new = parse_items(t)
        if not new:
            return send(chat, "No prices caught. Try: <i>rice 1 kilo 60</i>")
        d.setdefault("items", []).extend(new)
        save()
        return send(chat, f"Added {len(new)}:\n{items_summary(new)}\n\n<b>{len(d['items'])} items so far.</b> Send more, or:",
                    [[{"text": "✅ Done, open my shop", "callback_data": "ob_done"}]])


def finish_onboarding(chat):
    s = sess(chat)
    d = s.get("draft") or {}
    if not d.get("items"):
        return send(chat, "Add at least one item first.")
    sid = re.sub(r"[^a-z0-9]+", "", (d.get("shopName") or "shop").lower())[:12] or "shop"
    sid += "".join(random.choices(string.ascii_lowercase, k=3))
    db["shops"][sid] = {"shopName": d.get("shopName") or "My shop", "area": d.get("area", ""), "phone": d.get("phone", ""),
                        "items": d["items"][:60], "owner": chat, "createdAt": time.time(),
                        "loc": d.get("loc"), "feeBy": "customer"}
    db["owners"][str(chat)] = sid
    s.clear()
    save()
    t = publish_page(sid)
    if t:
        t.join(15)
    print(f"SHOP {sid} {d.get('shopName')} items={len(d['items'])}", flush=True)
    link = shop_link(sid)
    send(chat, f"🎉 <b>{h(d.get('shopName'))} is open</b>\n\nSend this to customers:\n{link}",
         [[{"text": "📤 Share on Telegram", "url": f"https://t.me/share/url?url={link}"}]]
         + ([[{"text": "🌐 Public page", "url": web_link(sid)}]] if web_link(sid) else []))
    dashboard(chat)


def dashboard(chat):
    sess(chat)["shop"] = None
    sid, shop = my_shop(chat)
    if not shop:
        return start_onboarding(chat)
    today = sales(sid, today_only=True)
    send(chat, f"🏪 <b>{h(shop['shopName'])}</b>{' · ' + h(shop['area']) if shop.get('area') else ''}\n"
               f"{len(shop['items'])} items · today {today['n']} orders · {rs(today['total'])}",
         [[{"text": "➕ Add items", "callback_data": "add"}, {"text": "✏️ Edit items", "callback_data": "edit"}],
          [{"text": "📊 Sales", "callback_data": "sales"}, {"text": "📦 Orders", "callback_data": "orders"}],
          [{"text": "📤 Share catalogue", "callback_data": "share"}, {"text": "🛵 Delivery", "callback_data": "dlv"}],
          [{"text": "🆕 Start a new shop", "callback_data": "new"}]])


def catalogue_card(sid):
    shop = db["shops"][sid]
    lines = "\n".join(f"• {iname(i)}{' · ' + i['unit'] if i.get('unit') else ''} — {rs(i['price'])}" for i in shop["items"][:25])
    return f"🏪 {shop['shopName']}{' · ' + shop['area'] if shop.get('area') else ''}\n\n{lines}\n\n🛵 Home delivery or pickup · cash on delivery"


def share_catalogue(chat):
    sid, shop = my_shop(chat)
    if not shop:
        return
    card = catalogue_card(sid)
    links = f"\n\nOrder: {shop_link(sid)}" + (f"\nMenu: {web_link(sid)}" if web_link(sid) else "")
    from urllib.parse import quote
    tg("sendMessage", chat_id=chat, text=card + "\n\n👇 Tap to order", disable_web_page_preview=True,
       reply_markup={"inline_keyboard": [[{"text": "🛒 Order now", "url": shop_link(sid)}]]
                     + ([[{"text": "🌐 See full menu", "url": web_link(sid)}]] if web_link(sid) else [])})
    send(chat, "☝️ Forward that card to your customer groups.\nOr send it on WhatsApp:",
         [[{"text": "🟢 Share on WhatsApp", "url": "https://wa.me/?text=" + quote(card + links)}],
          [{"text": "✈️ Share on Telegram", "url": "https://t.me/share/url?url=" + quote(shop_link(sid)) + "&text=" + quote(card)}],
          [{"text": "← Back", "callback_data": "home"}]])


def delivery_settings(chat):
    sid, shop = my_shop(chat)
    if not shop:
        return
    who = "customer pays" if shop.get("feeBy", "customer") == "customer" else "you absorb it"
    send(chat, f"🛵 <b>Delivery</b>\n₹52 up to 3 km, then ₹11 per km.\nFee: <b>{who}</b>\nShop location: <b>{'set' if shop.get('loc') else 'not set (flat ₹52)'}</b>",
         [[{"text": "🔁 Customer pays / I absorb", "callback_data": "feeby"}],
          [{"text": "📍 Set shop location", "callback_data": "setloc"}],
          [{"text": "← Back", "callback_data": "home"}]])


def sales(sid, today_only=False):
    start = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    os_ = [o for o in db["orders"].values() if o["shop"] == sid and o["status"] != "declined" and (not today_only or o["at"] >= start)]
    tally = {}
    for o in os_:
        for name, q, p in o["lines"]:
            tally[name] = tally.get(name, 0) + q
    return {"n": len(os_), "total": sum(o["total"] for o in os_), "top": sorted(tally.items(), key=lambda x: -x[1])[:5]}


def show_sales(chat):
    sid, shop = my_shop(chat)
    if not shop:
        return
    t, a = sales(sid, True), sales(sid)
    top = "\n".join(f"• {h(n)} × {q}" for n, q in a["top"]) or "—"
    send(chat, f"📊 <b>Sales</b>\n\nToday: <b>{t['n']}</b> orders · <b>{rs(t['total'])}</b>\nAll time: {a['n']} orders · {rs(a['total'])}\n\n<b>Best sellers</b>\n{top}",
         [[{"text": "← Back", "callback_data": "home"}]])


def show_orders(chat):
    sid, shop = my_shop(chat)
    if not shop:
        return
    mine = sorted(((k, o) for k, o in db["orders"].items() if o["shop"] == sid), key=lambda x: -x[1]["at"])[:10]
    icon = {"new": "🟡", "accepted": "✅", "declined": "✖"}
    body = "\n".join(f"{icon.get(o['status'], '')} #{k} · {rs(o['total'])} · {datetime.fromtimestamp(o['at'], IST):%H:%M}" for k, o in mine) or "No orders yet."
    send(chat, f"📦 <b>Orders</b>\n\n{body}", [[{"text": "← Back", "callback_data": "home"}]])


def show_edit(chat):
    sid, shop = my_shop(chat)
    if not shop:
        return
    rows = [[{"text": f"{iname(it)} · {rs(it['price'])}", "callback_data": f"it:{i}"}] for i, it in enumerate(shop["items"])]
    send(chat, "✏️ Tap an item", rows + [[{"text": "← Back", "callback_data": "home"}]])


def owner_text(chat, s, m):
    """Messages from a shopkeeper outside onboarding: add items or set a price."""
    sid, shop = my_shop(chat)
    step = s.get("step") or ""
    if step.startswith("price:"):
        t = heard(m, chat)
        if not t:
            return
        nums = re.findall(r"\d+(?:\.\d+)?", t)
        if not nums:
            return send(chat, "Send just the new price, like 65.")
        i = int(step.split(":")[1])
        shop["items"][i]["price"] = float(nums[0])
        s["step"] = None
        save()
        publish_page(sid)
        send(chat, f"✓ {h(iname(shop['items'][i]))} is now {rs(nums[0])}")
        return dashboard(chat)
    t = heard(m, chat)
    if not t:
        return
    tg("sendChatAction", chat_id=chat, action="typing")
    try:
        plan = gemini_json(OWNER_PROMPT.format(
            shop=shop["shopName"], items=catalogue_text(shop),
            today=json.dumps(sales(sid, True), ensure_ascii=False), alltime=json.dumps(sales(sid), ensure_ascii=False)) + t)
    except Exception:
        traceback.print_exc()
        plan = {"actions": [{"type": "add", "items": parse_items(t)}], "reply": ""}
    print(f"  owner plan {json.dumps(plan, ensure_ascii=False)[:300]}", flush=True)
    notes, show = [], None
    removals = []
    for a in plan.get("actions") or []:
        kind = a.get("type")
        try:
            if kind == "add":
                new = [{"name": str(i.get("name", "")), "local": str(i.get("local", "")), "price": float(i["price"]),
                        "unit": str(i.get("unit", ""))} for i in a.get("items") or [] if i.get("price")]
                shop["items"].extend(new)
                if new:
                    notes.append(f"➕ {', '.join(h(iname(i)) for i in new)}")
            elif kind == "price":
                it = shop["items"][int(a["index"])]
                it["price"] = float(a["price"])
                notes.append(f"💰 {h(iname(it))} → {rs(it['price'])}")
            elif kind == "remove":
                removals.append(int(a["index"]))
            elif kind == "show":
                show = a.get("what")
        except (KeyError, IndexError, ValueError, TypeError):
            traceback.print_exc()
    for i in sorted(set(removals), reverse=True):
        if 0 <= i < len(shop["items"]):
            notes.append(f"🗑 {h(iname(shop['items'].pop(i)))}")
    if notes:
        save()
        publish_page(sid)
    reply = h(plan.get("reply") or "")
    body = "\n".join(x for x in [reply, "\n".join(notes)] if x) or "👍"
    send(chat, body, [[{"text": "🏪 My shop", "callback_data": "home"}]])
    {"sales": show_sales, "orders": show_orders, "edit": show_edit, "items": show_edit, "dashboard": dashboard}.get(show, lambda c: None)(chat)


def catalogue_text(shop):
    return "\n".join(f"{i}. {it['name']} / {it.get('local') or '-'} / {it.get('unit') or '-'} / Rs {it['price']}" for i, it in enumerate(shop["items"])) or "(no items yet)"


OWNER_PROMPT = """You are Munshi, the assistant inside a Telegram bot that runs a small Indian shop's online orders. You are talking to the shopkeeper of "{shop}". They speak Kannada, Hindi, Tamil, English or a mix, by voice or text.

Their catalogue (index. English / local name / unit / price):
{items}

Sales today ("n" is number of orders, "total" is rupees, "top" is items sold): {today}
Sales all time: {alltime}

Work out what they want and return only JSON:
{{"actions": [ ... ], "reply": "a short, warm reply in the same language and script they used, 1-2 sentences, stating what you did or answering their question"}}
Possible actions:
 {{"type":"add","items":[{{"name":English,"local":name in their language/script or "","price":number,"unit":short unit}}]}}  - new products with prices
 {{"type":"price","index":catalogue index,"price":number}}  - change a price
 {{"type":"remove","index":catalogue index}}  - remove a product (sold out, not selling)
 {{"type":"show","what":"sales"|"orders"|"items"|"dashboard"}}  - when they ask to see something
Use no actions for greetings, questions you can answer from the data above, or small talk. Never invent products or prices they did not say. If something is ambiguous, ask in the reply and take no action.

Shopkeeper said:
"""


BUYER_PROMPT = """You are Munshi, the shop assistant for "{shop}" ({area}) on Telegram. A customer is chatting with you in Kannada, Hindi, Tamil, English or a mix. Delivery is cash on delivery.

Catalogue (index. English / local name / unit / price):
{items}

Customer's cart now: {cart}

Return only JSON: {{"add":[{{"index":catalogue index,"qty":number}}], "remove":[catalogue index], "checkout": true if they want to place the order now, "reply": "short friendly reply in the customer's language and script, 1-2 sentences"}}
Never say the order is placed or confirmed: if checkout is true, say you need their name and address next. Only offer products in the catalogue. If they ask for something not listed, say so and suggest the closest item. Never invent prices.

Customer said:
"""


def buyer_text(chat, s, m):
    sid = s["shop"]
    shop = db["shops"].get(sid)
    t = heard(m, chat)
    if not shop or not t:
        return
    tg("sendChatAction", chat_id=chat, action="typing")
    cart = s.setdefault("cart", {})
    cart_txt = ", ".join(f"{q}x {iname(shop['items'][int(i)])}" for i, q in cart.items() if q and int(i) < len(shop["items"])) or "empty"
    try:
        plan = gemini_json(BUYER_PROMPT.format(shop=shop["shopName"], area=shop.get("area", ""), items=catalogue_text(shop), cart=cart_txt) + t)
    except Exception:
        traceback.print_exc()
        return send(chat, "Tap the items below to add them.")
    print(f"  buyer plan {json.dumps(plan, ensure_ascii=False)[:300]}", flush=True)
    for a in plan.get("add") or []:
        try:
            i = int(a["index"])
            if 0 <= i < len(shop["items"]):
                cart[str(i)] = cart.get(str(i), 0) + max(1, int(a.get("qty") or 1))
        except (KeyError, ValueError, TypeError):
            pass
    for i in plan.get("remove") or []:
        cart.pop(str(i), None)
    save()
    tg("sendMessage", chat_id=chat, text=plan.get("reply") or "👍", reply_markup=catalogue_markup(sid, cart))
    if plan.get("checkout") and sum(cart.values()):
        s["step"] = None
        save()
        send(chat, "How do you want it?", [[{"text": "🛵 Home delivery", "callback_data": "mode:delivery"}, {"text": "🏃 I'll pick up", "callback_data": "mode:pickup"}]])


# ---------- buyer ----------

def sess(chat):
    return db["sessions"].setdefault(str(chat), {})


def catalogue_markup(sid, cart):
    shop = db["shops"][sid]
    rows = []
    for i, it in enumerate(shop["items"]):
        q = cart.get(str(i), 0)
        rows.append([{"text": f"{'✅ ' + str(q) + '× ' if q else '+ '}{iname(it)}  {rs(it['price'])}", "callback_data": f"a:{sid}:{i}"}])
    n = sum(cart.values())
    if n:
        total = sum(shop["items"][int(i)]["price"] * q for i, q in cart.items() if int(i) < len(shop["items"]))
        rows.append([{"text": "↺ clear", "callback_data": f"x:{sid}"}, {"text": f"🛒 Order {n} · {rs(total)}", "callback_data": f"c:{sid}"}])
    return {"inline_keyboard": rows}


def show_shop(chat, sid):
    shop = db["shops"].get(sid)
    if not shop:
        return send(chat, "Shop not found.")
    s = sess(chat)
    s.update({"shop": sid, "cart": {}, "step": None})
    save()
    tg("sendMessage", chat_id=chat, parse_mode="HTML",
       text=f"🏪 <b>{h(shop['shopName'])}</b>{' · ' + h(shop['area']) if shop.get('area') else ''}\nTap to add · cash on delivery",
       reply_markup=catalogue_markup(sid, {}))


def place_order(chat, s, phone):
    sid, cart = s["shop"], s.get("cart", {})
    shop = db["shops"][sid]
    lines = [(shop["items"][int(i)], q) for i, q in cart.items() if q and int(i) < len(shop["items"])]
    if not lines:
        s["step"] = None
        return send(chat, "Your cart is empty.")
    subtotal = sum(it["price"] * q for it, q in lines)
    mode = s.get("mode", "delivery")
    fee, dist = delivery_fee(shop, s.get("loc")) if mode == "delivery" else (0.0, None)
    charged = fee if shop.get("feeBy", "customer") == "customer" else 0.0
    total = subtotal + charged
    oid = "".join(random.choices(string.digits, k=5))
    db["orders"][oid] = {"shop": sid, "buyer": chat, "lines": [[iname(it), q, it["price"]] for it, q in lines],
                         "subtotal": subtotal, "fee": fee, "feeCharged": charged, "mode": mode, "km": dist, "loc": s.get("loc"),
                         "total": total, "address": s.get("address", ""), "phone": phone, "status": "new", "at": time.time()}
    s.update({"cart": {}, "step": None, "mode": None, "loc": None})
    save()
    body = "\n".join(f"{q}× {h(iname(it))} — {rs(it['price'] * q)}" for it, q in lines)
    dist_txt = f" · {dist:.1f} km" if dist is not None else ""
    if mode == "delivery":
        body += f"\n🛵 Delivery{dist_txt} — {rs(charged) if charged else 'free'}"
    else:
        body += "\n🏃 Pickup from shop"
    tg("sendMessage", chat_id=chat, parse_mode="HTML", reply_markup={"remove_keyboard": True},
       text=f"🧾 <b>Order #{oid} sent</b>\n\n{body}\n<b>Total {rs(total)}</b> · pay cash {'on delivery' if mode == 'delivery' else 'at pickup'}")
    send(shop["owner"], f"🔔 <b>New order #{oid}</b> · {'🛵 delivery' if mode == 'delivery' else '🏃 pickup'}\n\n{body}"
         + (f"\n(you absorb {rs(fee)} delivery)" if mode == "delivery" and not charged else "")
         + f"\n<b>Collect {rs(total)}</b>\n\n🙋 {h(db['orders'][oid]['address'])}\n📞 {h(phone)}"
         + (f"\n🗺 https://maps.google.com/?q={db['orders'][oid]['loc'][0]},{db['orders'][oid]['loc'][1]}" if db['orders'][oid].get('loc') else ""),
         [[{"text": "✅ Accept", "callback_data": f"ok:{oid}"}, {"text": "✖ Can't", "callback_data": f"no:{oid}"}]])
    print(f"ORDER {oid} shop={sid} total={total}", flush=True)


# ---------- routing ----------

def on_message(m):
    chat = m["chat"]["id"]
    s = sess(chat)
    text = m.get("text") or ""

    if text.startswith("/start"):
        arg = text[6:].strip()
        if arg.startswith("s_"):
            return show_shop(chat, arg[2:])
        return dashboard(chat) if my_shop(chat)[1] else start_onboarding(chat)
    if text in ("/shop", "/menu"):
        return dashboard(chat)
    if text == "/new":
        return start_onboarding(chat)
    if text == "/sales":
        return show_sales(chat)
    if text == "/orders":
        return show_orders(chat)

    step = s.get("step") or ""
    if step == "setloc":
        sid, shop = my_shop(chat)
        if shop and m.get("location"):
            shop["loc"] = [m["location"]["latitude"], m["location"]["longitude"]]
        s["step"] = None
        save()
        tg("sendMessage", chat_id=chat, text="✓ Shop location saved", reply_markup={"remove_keyboard": True})
        return delivery_settings(chat)
    if step == "dloc":
        if m.get("location"):
            s["loc"] = [m["location"]["latitude"], m["location"]["longitude"]]
            s["step"] = "address"
            save()
            return tg("sendMessage", chat_id=chat, text="🏠 Name, house / flat no. and landmark?", reply_markup={"remove_keyboard": True})
        s["loc"] = None
        s["step"] = "address"
        save()
        return tg("sendMessage", chat_id=chat, text="🏠 Name and full delivery address?", reply_markup={"remove_keyboard": True})
    if step == "address":
        t = heard(m, chat)
        if not t:
            return
        s.update({"address": t, "step": "phone"})
        save()
        return tg("sendMessage", chat_id=chat, text="📞 Your phone?",
                  reply_markup={"keyboard": [[{"text": "📱 Share my number", "request_contact": True}]],
                                "resize_keyboard": True, "one_time_keyboard": True})
    if step == "phone":
        phone = (m.get("contact") or {}).get("phone_number") or text
        return place_order(chat, s, phone) if phone else None
    if step.startswith("ob_"):
        return onboarding_step(chat, s, m)
    own_sid = my_shop(chat)[0]
    if s.get("shop") and s["shop"] != own_sid and s["shop"] in db["shops"]:
        return buyer_text(chat, s, m)
    if own_sid:
        return owner_text(chat, s, m)
    return start_onboarding(chat)


def on_callback(q):
    chat = q["message"]["chat"]["id"]
    mid = q["message"]["message_id"]
    kind, *rest = q["data"].split(":")
    s = sess(chat)
    tg("answerCallbackQuery", callback_query_id=q["id"])
    if kind == "ob_done":
        return finish_onboarding(chat)
    if kind == "home":
        return dashboard(chat)
    if kind == "new":
        return start_onboarding(chat)
    if kind == "add":
        s["step"] = None
        save()
        return send(chat, "🎙 Say or type new items with prices.")
    if kind == "edit":
        return show_edit(chat)
    if kind == "share":
        return share_catalogue(chat)
    if kind == "dlv":
        return delivery_settings(chat)
    if kind == "feeby":
        sid, shop = my_shop(chat)
        if shop:
            shop["feeBy"] = "shop" if shop.get("feeBy", "customer") == "customer" else "customer"
            save()
        return delivery_settings(chat)
    if kind == "setloc":
        s["step"] = "setloc"
        save()
        return tg("sendMessage", chat_id=chat, text="📍 Send your shop's location",
                  reply_markup={"keyboard": [[{"text": "📍 Send shop location", "request_location": True}]],
                                "resize_keyboard": True, "one_time_keyboard": True})
    if kind == "mode":
        s["mode"] = rest[0]
        if rest[0] == "pickup":
            s["step"] = "address"
            save()
            return send(chat, "🙋 Your name?")
        s["step"] = "dloc"
        save()
        return tg("sendMessage", chat_id=chat, text="📍 Share your delivery location",
                  reply_markup={"keyboard": [[{"text": "📍 Send my location", "request_location": True}], [{"text": "Type address instead"}]],
                                "resize_keyboard": True, "one_time_keyboard": True})
    if kind == "sales":
        return show_sales(chat)
    if kind == "orders":
        return show_orders(chat)
    if kind == "it":
        sid, shop = my_shop(chat)
        i = int(rest[0])
        if not shop or i >= len(shop["items"]):
            return
        it = shop["items"][i]
        return send(chat, f"<b>{h(iname(it))}</b> · {h(it.get('unit'))} · {rs(it['price'])}",
                    [[{"text": "💰 Change price", "callback_data": f"pr:{i}"}, {"text": "🗑 Remove", "callback_data": f"rm:{i}"}],
                     [{"text": "← Back", "callback_data": "edit"}]])
    if kind == "pr":
        s["step"] = f"price:{rest[0]}"
        save()
        return send(chat, "New price?")
    if kind == "rm":
        sid, shop = my_shop(chat)
        i = int(rest[0])
        if shop and i < len(shop["items"]):
            gone = shop["items"].pop(i)
            save()
            publish_page(sid)
            send(chat, f"🗑 Removed {h(iname(gone))}")
        return show_edit(chat)
    if kind in ("a", "x", "c"):
        sid = rest[0]
        if sid not in db["shops"]:
            return
        if s.get("shop") != sid:
            s.update({"shop": sid, "cart": {}})
        cart = s.setdefault("cart", {})
        if kind == "a":
            cart[rest[1]] = cart.get(rest[1], 0) + 1
        elif kind == "x":
            cart.clear()
        else:
            save()
            return send(chat, "How do you want it?", [[{"text": "🛵 Home delivery", "callback_data": "mode:delivery"}, {"text": "🏃 I'll pick up", "callback_data": "mode:pickup"}]])
        save()
        return tg("editMessageReplyMarkup", chat_id=chat, message_id=mid, reply_markup=catalogue_markup(sid, cart))
    if kind in ("ok", "no"):
        o = db["orders"].get(rest[0])
        if not o or db["shops"][o["shop"]]["owner"] != chat:
            return
        o["status"] = "accepted" if kind == "ok" else "declined"
        save()
        shop = db["shops"][o["shop"]]["shopName"]
        tg("editMessageReplyMarkup", chat_id=chat, message_id=mid,
           reply_markup={"inline_keyboard": [[{"text": "✅ Accepted" if kind == "ok" else "✖ Declined", "callback_data": "home"}]]})
        send(o["buyer"], f"✅ {h(shop)} accepted order #{rest[0]}. " + ("On its way 🛵" if o.get("mode", "delivery") == "delivery" else "We'll keep it ready for pickup 🏃") if kind == "ok" else f"✖ {h(shop)} can't take order #{rest[0]} right now.")


# ---------- public catalogue page on Telegra.ph (updates whenever the shop changes) ----------

def page_nodes(sid):
    sh = db["shops"][sid]
    items = [{"tag": "li", "children": [{"tag": "b", "children": [iname(it)]},
             f"{' (' + it['name'] + ')' if it.get('local') and it.get('name') else ''}{' · ' + it['unit'] if it.get('unit') else ''} — {rs(it['price'])}"]}
             for it in sh["items"]]
    return [
        {"tag": "p", "children": [f"📍 {sh.get('area') or ''}  ·  Cash on delivery  ·  {len(sh['items'])} items"]},
        {"tag": "ul", "children": items},
        {"tag": "h4", "children": [{"tag": "a", "attrs": {"href": shop_link(sid)}, "children": ["🛒 Order on Telegram →"]}]},
        {"tag": "p", "children": [{"tag": "i", "children": [f"Updated {datetime.now(IST):%d %b, %H:%M} · made with Munshi"]}]},
    ]


def publish_page(sid):
    if not TPH:
        return
    def run():
        try:
            sh = db["shops"][sid]
            data = {"access_token": TPH, "title": sh["shopName"], "author_name": "Munshi",
                    "author_url": f"https://t.me/{BOT_NAME}", "content": json.dumps(page_nodes(sid), ensure_ascii=False)}
            path = sh.get("page", "").rsplit("/", 1)[-1]
            r = requests.post(f"https://api.telegra.ph/{'editPage/' + path if path else 'createPage'}", data=data, timeout=30).json()
            if r.get("ok") and not path:
                sh["page"] = r["result"]["url"]
                save()
            elif not r.get("ok"):
                print("TPH ERR", r, flush=True)
        except Exception:
            traceback.print_exc()
    t = threading.Thread(target=run)
    t.start()
    return t


def main():
    global BOT_NAME
    BOT_NAME = tg("getMe")["username"]
    tg("setMyCommands", commands=[{"command": "shop", "description": "My shop"}, {"command": "sales", "description": "Sales"},
                                  {"command": "orders", "description": "Orders"}, {"command": "new", "description": "Start a new shop"}])
    print(f"running as @{BOT_NAME}  voice={'on' if XI else 'off'}  gemini={'on' if GEM else 'off'}", flush=True)
    offset = 0
    while True:
        try:
            ups = requests.get(f"{API}/getUpdates", params={"offset": offset, "timeout": 30}, timeout=40).json().get("result", [])
        except Exception:
            time.sleep(2)
            continue
        for u in ups:
            offset = u["update_id"] + 1
            try:
                m = u.get("message") or {}
                kinds = [k for k in ("text", "voice", "audio", "contact") if k in m] or (["callback"] if "callback_query" in u else ["other"])
                print(f"{datetime.now(IST):%H:%M:%S} update {kinds} step={sess((m.get('chat') or u.get('callback_query', {}).get('message', {}).get('chat') or {}).get('id', 0)).get('step')} {(m.get('text') or (u.get('callback_query') or {}).get('data') or '')[:40]!r}", flush=True)
                if "message" in u:
                    on_message(u["message"])
                elif "callback_query" in u:
                    on_callback(u["callback_query"])
            except Exception:
                traceback.print_exc()


if __name__ == "__main__":
    main()
