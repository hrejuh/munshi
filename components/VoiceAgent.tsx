"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceLabels {
  tapToTalk: string;
  stop: string;
  typeInstead: string;
  send: string;
  listening: string;
  speaking: string;
  connecting: string;
  voiceUnavailable: string;
}

interface Line {
  role: "user" | "agent" | "system";
  text: string;
}

export interface VoiceAgentProps {
  kind: "setup" | "order";
  /** Required for the buyer (order) agent: which live shop the session is for. */
  shopSlug?: string;
  lang: string;
  labels: VoiceLabels;
  dynamicVariables: Record<string, string | number | boolean>;
  firstMessage?: string;
  /** Called after each server tool the agent runs, so the page can refresh what it shows. */
  onToolResponse?: (toolName: string) => void;
  clientTools?: Record<string, (params: Record<string, unknown>) => string | Promise<string>>;
  /** Used when voice isn't configured: handle typed text locally and return a reply. */
  onFallbackText?: (text: string) => Promise<string>;
  intro?: string;
}

export function VoiceAgent(props: VoiceAgentProps) {
  return (
    <ConversationProvider>
      <VoiceAgentInner {...props} />
    </ConversationProvider>
  );
}

function VoiceAgentInner({ kind, shopSlug, lang, labels, dynamicVariables, firstMessage, onToolResponse, clientTools, onFallbackText, intro }: VoiceAgentProps) {
  const [lines, setLines] = useState<Line[]>(intro ? [{ role: "agent", text: intro }] : []);
  const [text, setText] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const pendingText = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const push = (line: Line) => setLines((prev) => [...prev, line]);

  const conversation = useConversation({
    clientTools,
    onConnect: () => {
      setBusy(false);
      if (pendingText.current) {
        const msg = pendingText.current;
        pendingText.current = null;
        // Give the agent a beat to finish its first message before sending the typed text.
        setTimeout(() => conversation.sendUserMessage(msg), 400);
      }
    },
    onDisconnect: () => {
      setBusy(false);
      setMode(null);
    },
    onMessage: ({ message, role }) => {
      if (message?.trim()) push({ role: role === "user" ? "user" : "agent", text: message });
    },
    onAgentToolResponse: (event) => {
      const name = (event as { tool_name?: string })?.tool_name;
      if (name) onToolResponse?.(name);
    },
    onError: (message) => {
      setBusy(false);
      push({ role: "system", text: typeof message === "string" ? message : "Connection problem. Try again or type below." });
    },
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting" || busy;

  const start = useCallback(
    async (textOnly: boolean) => {
      setBusy(true);
      try {
        const qs = new URLSearchParams({ kind, ...(shopSlug ? { shop: shopSlug } : {}) });
        const resp = await fetch(`/api/voice/signed-url?${qs}`, { cache: "no-store" });
        if (resp.status === 503) {
          setUnavailable(true);
          setBusy(false);
          return false;
        }
        if (!resp.ok) throw new Error(await resp.text());
        const { signedUrl, shopToken } = (await resp.json()) as { signedUrl: string; shopToken: string };
        setMode(textOnly ? "text" : "voice");
        conversation.startSession({
          signedUrl,
          dynamicVariables: { ...dynamicVariables, shop_token: shopToken },
          textOnly,
          overrides: {
            agent: { language: lang as never, ...(firstMessage ? { firstMessage } : {}) },
            ...(textOnly ? { conversation: { textOnly: true } } : {}),
          },
        });
        return true;
      } catch (err) {
        setBusy(false);
        push({ role: "system", text: err instanceof Error ? err.message : "Could not start Munshi" });
        return false;
      }
    },
    [conversation, dynamicVariables, firstMessage, kind, lang, shopSlug],
  );

  const toggleMic = async () => {
    if (connected || connecting) {
      conversation.endSession();
      return;
    }
    await start(false);
  };

  const sendText = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setText("");
    if (connected) {
      conversation.sendUserMessage(msg);
      // Text sent during a text-only session isn't echoed by onMessage; voice sessions echo it.
      if (mode === "text") push({ role: "user", text: msg });
      return;
    }
    push({ role: "user", text: msg });
    if (unavailable && onFallbackText) {
      setBusy(true);
      try {
        push({ role: "agent", text: await onFallbackText(msg) });
      } finally {
        setBusy(false);
      }
      return;
    }
    pendingText.current = msg;
    const ok = await start(true);
    if (!ok && onFallbackText) {
      pendingText.current = null;
      push({ role: "agent", text: await onFallbackText(msg) });
    }
  };

  const status = connecting ? labels.connecting : connected ? (conversation.isSpeaking ? labels.speaking : mode === "voice" ? labels.listening : "") : "";

  return (
    <div className="flex flex-col">
      <div ref={scroller} className="max-h-[42vh] min-h-32 space-y-2 overflow-y-auto pb-2" aria-live="polite">
        {lines.map((line, i) => (
          <p
            key={i}
            className={
              line.role === "user"
                ? "ml-10 rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-white"
                : line.role === "agent"
                  ? "mr-10 rounded-2xl rounded-bl-md border border-line bg-card px-4 py-2.5 text-[15px]"
                  : "text-center text-xs text-sindoor"
            }
          >
            {line.text}
          </p>
        ))}
      </div>

      {unavailable && <p className="mb-2 rounded-xl bg-turmeric/20 px-3 py-2 text-sm">{labels.voiceUnavailable}</p>}

      {!unavailable && (
        <div className="my-4 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={toggleMic}
            aria-label={connected ? labels.stop : labels.tapToTalk}
            className={`flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-ink shadow-[0_5px_0_var(--color-ink)] transition-transform active:translate-y-1 active:shadow-none ${
              connected && mode === "voice" ? "mic-ring bg-turmeric" : connected ? "bg-ink text-white" : "bg-turmeric"
            }`}
          >
            {connected ? (
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
          <p className="min-h-5 text-sm font-semibold text-ink-soft">{status || (connected ? "" : labels.tapToTalk)}</p>
        </div>
      )}

      <form onSubmit={sendText} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={labels.typeInstead}
          className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-3 text-base focus:border-ink focus:outline-none"
        />
        <button type="submit" disabled={!text.trim() || busy} className="rounded-xl bg-ink px-4 font-semibold text-white disabled:opacity-40">
          {labels.send}
        </button>
      </form>
    </div>
  );
}
