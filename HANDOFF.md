# Munshi: engineering handoff

_Last updated 24 Oct 2026. Source of truth for product scope: `Munshi_PRD.pdf`._

Munshi is a voice-first shop assistant. A shop owner sets up an online store by talking in Kannada, Hindi, Tamil or English. Each shop gets its own storefront at `/s/<shop-slug>`. Buyers order through that link, by voice in the browser, by voice note or text, or by phoning Munshi. The owner only approves: the store, each product, and each order. Fulfilment is delivery or pickup.

**Payments: cash on delivery only (decision, 24 Oct).** There are no online payments of any kind: no sign-up or activation fee, no Pine Labs checkout, no payment links. Buyers pay the shop in cash on delivery or at pickup. When the owner taps **Completed**, the order is handed over and the cash collected; the Orders screen totals that as "Cash collected". All payment code (`lib/payments.ts`, `app/pay/*`, the activation screen, the `Payment` table, `PAYMENTS_MODE`, `ACTIVATION_FEE`) was removed. This departs from the PRD (F1 sign-up fee, F9 Pine Labs).

## Where things stand

**Works and is verified locally** (no third-party keys):
- `npm run build` passes, `tsc` is clean, and 20 unit tests pass (`npm test`).
- Smoke-tested against a running production build:
  - storefront renders with Kannada text and the cash-on-delivery note
  - web order → owner accept → out for delivery → completed (cash collected)
  - buyer status page updates
  - an invalid transition is blocked
  - every step is written to the agent log
  - typed-order parsing works
  - voice endpoints refuse unauthenticated calls
  - `/admin` login gate works

**Built but NOT yet run against the real services.** No keys were available while building. Every integration follows the provider's docs or SDK source (links below), but the first live run will probably need small fixes. **Do the checklist in "Bring it live" first.**

| Integration | What it does | Code | Risk to check first |
|---|---|---|---|
| ElevenLabs Agents | Voice onboarding + voice ordering (web + phone) | `components/VoiceAgent.tsx`, `lib/voice-tools.ts`, `app/api/voice/*`, `scripts/setup-elevenlabs.ts` | Setup script request shape; Kannada support for the chosen TTS model; `assignments` on `select_shop` (script retries without it) |
| ElevenLabs Scribe STT | Photo+speak, speak-an-item, spoken price lists, buyer voice notes | `lib/elevenlabs.ts` (`transcribe`), `app/api/stt` | Language code for Kannada (`kan`) |
| AgenticOrg (Pine Labs) | Onboarding, Catalog, Order agents; every run logged | `lib/agenticorg.ts`, `scripts/setup-agenticorg.ts`, `lib/prompts.ts` | Shape of `/agents/{id}/run` output; agents start in **shadow** and may need promoting |
| Vobiz SMS | Order link after phone/message orders, owner + buyer alerts | `lib/sms.ts` | India **DLT** IDs are required or carriers drop SMS |
| Vobiz SIP → ElevenLabs | Phone ordering | Dashboard config + `app/api/voice/init` | ElevenLabs **India residency** needed for Indian numbers (TRAI) |

If a provider fails, Munshi degrades instead of breaking:
- **AgenticOrg down:** the voice tools use the details ElevenLabs already extracted, plus a deterministic parser (`lib/catalog-match.ts`).
- **Voice down:** typed input works everywhere.

## Run it locally (5 minutes)

You need Node.js 20+ (22 recommended). No Docker or Postgres install is needed: `npm run db:local` runs a real Postgres 17 downloaded through npm.

**1. Install and configure**
```bash
npm install
cp .env.example .env
```
Edit `.env` and set:
- `SESSION_SECRET`: 32+ random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `ADMIN_PASSWORD`: anything; it protects `/admin`.
- Leave `DATABASE_URL` as is (it points at the local database below).

**2. Start the database (terminal 1, leave it running)**
```bash
npm run db:local
```
Wait for `Local Postgres ready: postgresql://munshi:munshi@localhost:5433/munshi`. Data is kept in `.local-db/` (git-ignored) between runs. Stop it with Ctrl+C.

**3. Create the tables and demo data (terminal 2)**
```bash
npx prisma db push      # creates/updates tables from prisma/schema.prisma
npm run db:seed         # demo live shop with 30 products: /s/ganesh-provision-stores-demo
```

**4. Run the app**
```bash
npm run dev             # http://localhost:3000
npm test                # unit tests (no database needed)
```

**What to try**
- Buyer: open http://localhost:3000/s/ganesh-provision-stores-demo, add items, check out. The order is placed straight away as cash on delivery/pickup and the buyer lands on its status page.
- Owner of the demo shop: go to `/start` and sign in with phone `9999900001`. Any other number creates a brand-new shop and walks you through setup.
- Proof dashboard: `/admin` with your `ADMIN_PASSWORD`.
- Voice and SMS need the keys in "Bring it live". Without them the UI says voice isn't set up and offers typing; ordering still works.

**Using your own Postgres instead** (Neon, Supabase, Render, a local install): skip step 2 and set `DATABASE_URL` in `.env` to your connection string. The database must be UTF-8, which is the default everywhere except some Windows installs.

**Troubleshooting**
- `Can't reach database server at localhost:5433`: the database from step 2 isn't running.
- Port 5433 already in use: an old database process is still running. Stop it with `node_modules/@embedded-postgres/<platform>/native/bin/pg_ctl stop -D .local-db`, or reboot.
- `character with byte sequence ... has no equivalent in encoding "WIN1252"`: your `.local-db` was created by an older version of the script. Stop the database, delete `.local-db/`, and repeat steps 2–3.
- Start over with a clean database: stop it, delete `.local-db/`, and repeat steps 2–3.

## Bring it live (do in this order)

1. **Deploy to Render.** `render.yaml` provisions a web service and Postgres. Set `APP_URL` to the Render https URL. ElevenLabs calls back to it, so localhost won't work; use a tunnel (`cloudflared`/`ngrok`) for local voice testing.
2. **AgenticOrg** ([agenticorg.pinelabs.com](https://agenticorg.pinelabs.com)):
   - Create an API key (`ao_sk_…`) with `agents:write` + `agents:execute`, and set `AGENTICORG_API_KEY` (+ `AGENTICORG_COMPANY_ID` if your tenant uses companies).
   - `npm run setup:agenticorg` → copy the 3 printed agent IDs into env. No connectors are needed (no payments).
   - If agents show "shadow", promote them in the dashboard. Runs may otherwise be refused (maker-checker).
3. **ElevenLabs:**
   - Set `ELEVENLABS_API_KEY` (with Agents write + Speech-to-Text access). That's all voice needs on Render: `VOICE_TOOL_SECRET` is generated by `render.yaml`, and on the first voice request the server creates or updates the "Munshi Setup" and "Munshi Orders" agents and their tools itself (`lib/elevenlabs-agents.ts`), logged on `/admin` as `voice_agents_synced`.
   - Optional: `npm run setup:elevenlabs` does the same from your machine (needs the same `APP_URL` and `VOICE_TOOL_SECRET` as the server) and prints agent IDs you can pin as `ELEVENLABS_SETUP_AGENT_ID` / `ELEVENLABS_ORDER_AGENT_ID`. Pinned IDs skip the automatic setup.
   - Dashboard → post-call webhook → `https://<app>/api/voice/post-call`; copy its secret into `ELEVENLABS_WEBHOOK_SECRET`.
   - Test Kannada first. If voice quality is poor, try `ELEVENLABS_TTS_MODEL` / `ELEVENLABS_VOICE_ID` (the PRD names Sarvam as a fallback).
4. **Vobiz:**
   - Set `VOBIZ_AUTH_ID`, `VOBIZ_AUTH_TOKEN`, `VOBIZ_SMS_FROM`, and the `VOBIZ_DLT_*` IDs.
   - Import the Vobiz number into ElevenLabs via SIP trunk ([guide](https://www.vobiz.ai/docs/integrations/elevenlabs-dashboard)) and assign it to "Munshi Orders".
   - Set `MUNSHI_PHONE_NUMBER`.
5. Run the demo path below and screenshot `/admin` for proof.

## How it fits together

```
Owner phone ──► /app/* (Next.js server components + server actions in app/app/actions.ts)
                 │  voice: VoiceAgent ──signed URL──► ElevenLabs "Munshi Setup" ──tools──► /api/voice/tools/*
                 │  push-to-talk: /api/stt (Scribe) ──► Catalog agent (AgenticOrg) ──► DRAFT products
Buyer ─────────► /s/<slug> storefront, cart (localStorage), /s/<slug>/checkout ──► /api/orders ──► status page
                 │  voice bubble ──► ElevenLabs "Munshi Orders" ──tools──► place_order ──► open_order (status page)
                 │  voice note / text ──► /api/stt or /api/orders/parse ──► Order agent ──► cart to confirm
Phone call ────► Vobiz SIP ► ElevenLabs ──init webhook──► /api/voice/init (shop + caller tokens) ──► SMS order link
Payment ───────► cash on delivery / at pickup; owner taps Completed = handed over + cash collected
Everything ────► agent_logs table ──► /admin proof dashboard + CSV export
```

**Key files**
- `prisma/schema.prisma` holds the data model (PRD tables minus `payments`, plus delivery, conversations, images, notifications). Money is whole rupees (`Int`).
- `lib/shops.ts`, `lib/catalog.ts`, `lib/order-service.ts`, `lib/order-actions.ts` are the domain services. Pages, voice tools and APIs all call these.
- `lib/orders.ts` has totals, validation, and the order state machine (`nextStatus`, `availableActions`).
- `lib/catalog-match.ts` holds the fuzzy matching of spoken items to products and the fallback parser for "Aashirvaad atta 5 kilo 260 rupees".
- `lib/voice-tools.ts` contains the ElevenLabs server tools. They are authorised by a **signed shop token** (`lib/voice-token.ts`), never a raw shop ID, so a caller can't act on another shop. Setup tools require the owner's setup scope.
- `lib/i18n.ts` has the UI strings in en/hi/kn/ta, plus the agents' first messages.
- `lib/prompts.ts` has the system prompts for all 5 agents (2 ElevenLabs + 3 AgenticOrg).
- `data/templates/*.json` holds 231 catalog template items (kirana 124, bakery 37, stationery 30, fruits-veg 40) with local names and voice aliases.

**Guardrails from the PRD, and where they live**
- Nothing public or sent without owner approval (nothing is charged online at all):
  - shop stays `DRAFT` until `approveShop`
  - products stay `DRAFT` until `approveDraft`
  - orders wait for owner `accept`
  - price changes from voice become drafts with the old price shown
- Every agent action is logged with a timestamp: `logAgent` in `lib/log.ts`, called from every agent run, tool call, approval, order step and SMS.
- When unsure, the agent asks instead of guessing:
  - `confidentMatch` returns null on ties ("atta" with 5 kg and 10 kg packs)
  - missing prices become 0 = "price needed"
  - unclear order items are returned for clarification

## PRD coverage

| ID | Feature | Status |
|---|---|---|
| F1 | Sign-up | **Changed by decision:** phone + name sign-up only (no OTP per PRD), free; no sign-up fee |
| F2 | Voice/text onboarding (kn/hi/en/ta) | Built: web voice + typed fallback + manual form. Onboarding by phone call not wired (buyer line only) |
| F3 | Draft store page + approve | Built and verified |
| F4 | Category template + prices by voice/text | Built (tick list, typed prices, "Say prices" voice) |
| F5 | Shelf photo | **Changed by decision:** no vision model. "Photo + speak" instead: photo is the product image, owner speaks name/size/price |
| F6 | Add/change product by voice | Built (creates, or proposes a price update to an existing item) |
| F7 | Buyer store link + cart + checkout | Built and verified |
| F8 | Order by text or voice note | Built (agent parses, buyer confirms) |
| F9 | Pay through Pine Labs | **Changed by decision:** cash on delivery/pickup only; no online payments |
| F10 | Owner alert + accept/reject | Built: in-app (polling + chime + badge) + SMS. Spoken-yes voice-call alerts not built |
| F11 | Orders + revenue | Built (today, all time, cash collected from completed orders) |
| F12 | Repeat-order nudges | Not built (P2). The data exists (`buyers.orderCount`, `usualOrder`) |
| F13 | Proof dashboard | Built (`/admin`, CSV export) |
| F14 | Order by phone call | Built (init webhook, shop code on the shared line, caller recognition, SMS order link); needs live SIP setup |
| Delivery | Delivery/pickup, fee, minimum order, statuses | Built |

## Known gaps and suggested next steps (priority order)

1. **First live run of each integration** (checklist above). Watch `/admin` and the server logs: failed agent runs are logged as `<action>:failed` with the error.
2. **Re-run both setup scripts after this change.** The Order agent no longer gets the Plural connector, and the ElevenLabs web tool `open_payment` was replaced by `open_order`. If agents were created before 24 Oct, update or recreate them (`setup:agenticorg` reuses existing agents by name, so edit the Order agent's tools/prompt in the dashboard or delete it first).
3. **No OTP.** Anyone who knows an owner's phone number can sign in as them (PRD accepted this for the event). Add OTP before real use. Sign-up is free, so nothing stops spam sign-ups either.
4. **No rate limiting** on public endpoints (`/api/voice/signed-url`, `/api/stt`, `/api/orders`). These cost ElevenLabs credits, and cash orders can be placed with any phone number, so add limits before sharing widely.
5. **Dependencies:** `npm audit` reports advisories in `next@15.5.28`. Bump to the latest patched Next before production.
6. **Database migrations:** currently `prisma db push`. Switch to `prisma migrate` once the schema settles. A database created before 24 Oct still has the `Payment` table and payment columns, which make `prisma db push` stop with a data-loss error. Render's build runs `prisma/cleanup-payments.sql` first to remove them (it does nothing once they are gone). For an old local `.local-db`, run `npx prisma db execute --file prisma/cleanup-payments.sql --schema prisma/schema.prisma` once before `npx prisma db push`.
7. **Per-shop phone numbers:** `shops.munshiNumber` exists and is used by the phone webhook, but there's no UI to set it. Everyone shares `MUNSHI_PHONE_NUMBER` + shop code.
8. **Content review:** template prices are estimates, and the Hindi/Kannada/Tamil names and UI strings (including the new cash-on-delivery strings) haven't been checked by native speakers.
9. **Not built:** owner onboarding over a phone call, voice-call order alerts, repeat-order nudges (F12), WhatsApp channel.

## Demo path (from the PRD)

1. `/start` → pick Kannada → name + phone.
2. Talk to Munshi: shop name, type, address, hours, delivery → the draft card fills in live → "See my store" → **Approve**.
3. Add products: "Pick from list" (tick 10 items, say prices) → "Photo + speak" one item → **Review drafts** → Approve all.
4. Open `/s/<slug>` on another phone → add items → checkout → order placed (cash on delivery).
5. Order by voice: "Order by voice" bubble (or call the Munshi number) → order read back → told to pay cash; phone callers get the order link by SMS.
6. Owner hears the chime on Orders → **Accept** → **Out for delivery** → **Completed** (cash collected) → the buyer status page updates.
7. `/admin` shows every step with timestamps.

## References used while building
- AgenticOrg SDK `agenticorg-sdk@0.4.0` and open-source backend `github.com/mishrasanjeev/agentic-org` (routes `api/v1/agents.py`, `api/v1/approvals.py`)
- [ElevenLabs tools API](https://elevenlabs.io/docs/api-reference/tools/create)
- [ElevenLabs agents API](https://elevenlabs.io/docs/api-reference/agents/create)
- [ElevenLabs SIP trunking](https://elevenlabs.io/docs/conversational-ai/phone-numbers/sip-trunking)
- [Vobiz send message](https://www.vobiz.ai/docs/sms/api/messages/send-message)
- [Vobiz + ElevenLabs](https://www.vobiz.ai/docs/integrations/elevenlabs-dashboard)
