// Central place for configuration so missing keys degrade features instead of crashing pages.
export const env = {
  // Render sets RENDER_EXTERNAL_URL itself, so shared links work even before APP_URL is filled in.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, ""),
  sessionSecret: process.env.SESSION_SECRET ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",

  elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenSetupAgentId: process.env.ELEVENLABS_SETUP_AGENT_ID ?? "",
  elevenOrderAgentId: process.env.ELEVENLABS_ORDER_AGENT_ID ?? "",
  elevenWebhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
  elevenSttModel: process.env.ELEVENLABS_STT_MODEL ?? "scribe_v1",
  elevenLlm: process.env.ELEVENLABS_LLM ?? "",
  elevenTtsModel: process.env.ELEVENLABS_TTS_MODEL ?? "",
  elevenVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  voiceToolSecret: process.env.VOICE_TOOL_SECRET ?? "",

  agenticOrgBaseUrl: (process.env.AGENTICORG_BASE_URL ?? "https://agenticorg.pinelabs.com").replace(/\/$/, ""),
  agenticOrgKey: process.env.AGENTICORG_API_KEY ?? "",
  agenticOrgCompanyId: process.env.AGENTICORG_COMPANY_ID ?? "",
  agenticOrgAgents: {
    onboarding: process.env.AGENTICORG_ONBOARDING_AGENT_ID ?? "",
    catalog: process.env.AGENTICORG_CATALOG_AGENT_ID ?? "",
    order: process.env.AGENTICORG_ORDER_AGENT_ID ?? "",
  },

  vobizAuthId: process.env.VOBIZ_AUTH_ID ?? "",
  vobizAuthToken: process.env.VOBIZ_AUTH_TOKEN ?? "",
  vobizSmsFrom: process.env.VOBIZ_SMS_FROM ?? "",
  vobizDltEntityId: process.env.VOBIZ_DLT_ENTITY_ID ?? "",
  vobizDltHeaderId: process.env.VOBIZ_DLT_HEADER_ID ?? "",
  vobizDltTemplateId: process.env.VOBIZ_DLT_TEMPLATE_ID ?? "",
  munshiNumber: process.env.MUNSHI_PHONE_NUMBER ?? "",
};
