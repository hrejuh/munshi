"use client";

import { useState } from "react";

export function ShareLink({ url, text, labels }: { url: string; text: string; labels: { copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked; the link is also shown on the home screen */
          }
        }}
        className="rounded-xl border border-line py-3 font-semibold"
      >
        {copied ? labels.copied : labels.copy}
      </button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-xl bg-leaf py-3 font-semibold text-white"
      >
        WhatsApp
      </a>
    </div>
  );
}
