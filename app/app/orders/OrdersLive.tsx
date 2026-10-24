"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** A short two-tone chime so the owner hears new orders during rush hour. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch {
    /* audio blocked until the owner taps the page once */
  }
}

/** Polls for order changes; refreshes the list and chimes when a new order is waiting. */
export function OrdersLive() {
  const router = useRouter();
  const last = useRef<{ stamp: number; pending: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const resp = await fetch("/api/owner/feed", { cache: "no-store" });
        if (!resp.ok || !alive) return;
        const data = (await resp.json()) as { stamp: number; pending: number };
        const prev = last.current;
        if (prev && data.stamp !== prev.stamp) {
          if (data.pending > prev.pending) chime();
          router.refresh();
        }
        last.current = data;
      } catch {
        /* offline: try again next tick */
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);

  return null;
}
