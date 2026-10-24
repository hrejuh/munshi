# Munshi

Every shop's AI munshi. A shop owner talks to it in Kannada, Hindi, Tamil or English, and it sets up their store, lists products, and takes buyer orders from a store link, voice or phone. Buyers pay cash on delivery or pickup. The owner only approves.

- Product spec: `Munshi_PRD.pdf`
- **Start here:** [`HANDOFF.md`](./HANDOFF.md) covers status, local setup, the go-live checklist, architecture and known gaps.

Stack: Next.js 15 + TypeScript + Tailwind, Prisma + Postgres, ElevenLabs (voice), AgenticOrg by Pine Labs (agents), Vobiz (phone + SMS). Deploys to Render via `render.yaml`.

```bash
npm install && cp .env.example .env
npm run db:local          # separate terminal
npx prisma db push && npm run db:seed && npm run dev
```
