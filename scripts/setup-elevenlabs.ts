// Creates (or updates) Munshi's two ElevenLabs agents and their tools.
// Optional: the server does this by itself on first voice use when the agent IDs aren't set.
// Run it to pin the IDs in env, or after changing prompts/voice to push them to ElevenLabs right away.
// Usage: APP_URL=https://your-public-url npm run setup:elevenlabs
import "dotenv/config";
import { syncVoiceAgents } from "../lib/elevenlabs-agents";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");

async function main() {
  const ids = await syncVoiceAgents({
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    appUrl: APP_URL,
    toolSecret: process.env.VOICE_TOOL_SECRET ?? "",
    llm: process.env.ELEVENLABS_LLM,
    ttsModel: process.env.ELEVENLABS_TTS_MODEL,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    log: (line) => console.log(line),
  });

  console.log(`
Optionally add these to your environment (.env locally, Render dashboard in production);
without them the server finds the agents by name itself:

ELEVENLABS_SETUP_AGENT_ID=${ids.setup}
ELEVENLABS_ORDER_AGENT_ID=${ids.order}

Then, in the ElevenLabs dashboard:
  1. Agents Platform > Settings > Post-call webhook: ${APP_URL}/api/voice/post-call
     (copy its signing secret into ELEVENLABS_WEBHOOK_SECRET)
  2. Phone numbers > Import from SIP trunk (your Vobiz number, see https://www.vobiz.ai/docs/integrations/elevenlabs-dashboard)
     and assign it to "Munshi Orders". Indian numbers may need ElevenLabs' India residency setup.
  3. If the conversation-initiation webhook didn't save on the agent, set it under the agent's Security tab
     to ${APP_URL}/api/voice/init with header x-munshi-secret.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
