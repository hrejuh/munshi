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
