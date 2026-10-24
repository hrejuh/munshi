# Munshi

A Telegram shop for small shopkeepers. They set it up by speaking. Bot: https://t.me/Munshi_jiii_bot

- **Shopkeeper:** sends voice notes in Kannada, Hindi, Tamil or English ("chai 15, samosa 20") and Munshi builds the catalogue. They get a public menu page (Telegra.ph) that updates itself, and they can share the catalogue to WhatsApp or Telegram. They change prices or check sales by talking ("aaj kitna becha?").
- **Buyer:** taps items or chats to order ("2 chai aur ek samosa"), then picks delivery or pickup. The delivery fee is set by distance: ₹52 for the first 3 km, then ₹11 per km. The shopkeeper accepts or declines.

## Stack
- ElevenLabs speech-to-text (scribe_v1)
- An LLM through OpenRouter, with Gemini as fallback, to work out what the user means
- Telegram Bot API (long polling)
- Telegra.ph for public catalogue pages

## Run
Create `.env` with TELEGRAM_TOKEN, ELEVENLABS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY and TELEGRAPH_TOKEN. Then run:

    python3 bot.py

Built at Airtribe AI Builders Day, Bengaluru, 24 Oct 2026.

## Deploy on Cloudflare

`worker/` is the same bot as a Cloudflare Worker (webhook instead of polling, KV instead of `shops.json`). It also answers voice notes with a voice note (ElevenLabs TTS). No build step and no npm packages.

    cd worker
    npx wrangler login
    npx wrangler kv namespace create DB        # paste the printed id into wrangler.toml (REPLACE_WITH_KV_ID)
    npx wrangler secret put TELEGRAM_TOKEN
    npx wrangler secret put ELEVENLABS_API_KEY
    npx wrangler secret put OPENROUTER_API_KEY
    npx wrangler secret put GEMINI_API_KEY
    npx wrangler secret put TELEGRAPH_TOKEN
    npx wrangler secret put WEBHOOK_SECRET     # any long random string of A-Z a-z 0-9 _ -
    npx wrangler deploy

Stop `bot.py` first (a webhook and long polling can't run together). Then open
`https://munshi.<your-subdomain>.workers.dev/setup?key=<WEBHOOK_SECRET>` once to register the webhook and the bot commands.

To move existing shops and orders over (sessions are not copied):

    node scripts/import.mjs ../shops.json kv-bulk.json
    npx wrangler kv bulk put kv-bulk.json --binding DB --remote

Test locally with stubbed APIs: `node test/smoke.mjs`.
