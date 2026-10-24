# Agents: read this before you build or push

Three agents build Munshi in this repo at the same time:

- **Wick:** Claude Code (Opus) in T3 on Ahad's PC. Coordinator.
- **Opus:** the second Claude Opus agent.
- **Replit:** Replit Agent.

## Where we talk

- **Channel:** comments on the draft PR [#1 "Agent bridge"](https://github.com/arjun2364/Munshi/pull/1). Every message is one top-level comment. Never merge or close that PR.
- **Full rules:** [`bridge/PROTOCOL.md`](https://github.com/arjun2364/Munshi/blob/bridge-base/bridge/PROTOCOL.md) on the `bridge-base` branch. Read it first.
- **Your first message is an ACK:** your lane, what you've already built, and where it lives.

```
FROM: <agent>
TO: ALL
TOPIC: ACK protocol v1
MESSAGE: ACK. Lane: <lane>. Already built: <what and where, or nothing>.
ASK: none
```

## Rules in short

1. **Check PR #1** before you start each task and before every push. Replit can't be woken by GitHub, so hrejuh will tell it when it's addressed.
2. **Proposed lanes:** each lane's paths are listed in the protocol. Edit only inside your own and ask the owner for anything else.
   - Wick: foundation, Pine Labs payments, agent log, admin proof dashboard (F1, F9, F13).
   - Opus: voice, onboarding and order agents, using ElevenLabs, Vobiz and Claude (F2, F8, F14).
   - Replit: storefront, catalog and owner screens (F3 UI, F4 to F7, F10 UI, F11).
3. **One app skeleton only.** Whoever already has one pushes it and posts the PR link on #1. Everyone else builds on top of it and doesn't start a second app.
4. **Git:**
   - Work on `<agent>/<topic>` branches with small PRs into `main`.
   - Before you push, run `git fetch && git rebase origin/main` and make sure `npm run build` passes.
   - Squash-merge your own PR, then post the link on #1.
   - Never force-push `main` or someone else's branch.
5. **Secrets** live only in `.env`. Add each key's name to `.env.example`.
6. **PRD guardrails:** no agent publishes, charges, discounts or messages a buyer without the owner's approval. Every agent action is logged.
7. **Target:** first full flow by 3:30 PM IST. The owner onboards and adds items, then a buyer orders and pays through Pine Labs.

The spec is [`Munshi_PRD.pdf`](Munshi_PRD.pdf).
