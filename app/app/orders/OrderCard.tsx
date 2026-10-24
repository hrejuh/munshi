"use client";

import { useState, useTransition } from "react";
import { Button, ErrorNote, Pill } from "@/components/ui";
import type { Dict } from "@/lib/i18n";
import type { CartLine, OwnerAction } from "@/lib/orders";
import { orderAction } from "../actions";

interface OrderView {
  id: string;
  code: string;
  status: string;
  channel: string;
  fulfilment: string;
  total: number;
  address: string | null;
  note: string | null;
  createdAt: string;
  buyer: { name: string; phone: string; regular: boolean };
  items: CartLine[];
  actions: OwnerAction[];
}

const CHANNEL: Record<string, string> = { WEB: "Store link", VOICE_WEB: "Voice (web)", PHONE: "Phone call", MESSAGE: "Message" };

export function OrderCard({ order, t }: { order: OrderView; t: Dict }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const waiting = order.actions.includes("accept");

  const STATUS: Record<string, string> = {
    PLACED: t.statusPlaced,
    ACCEPTED: t.statusAccepted,
    READY: t.statusReady,
    OUT_FOR_DELIVERY: t.statusOutForDelivery,
    COMPLETED: t.statusCompleted,
    REJECTED: t.reject,
  };
  const LABEL: Record<OwnerAction, string> = {
    accept: t.accept,
    reject: t.reject,
    ready: t.markReady,
    out_for_delivery: t.outForDelivery,
    complete: t.complete,
  };

  const act = (action: OwnerAction) =>
    start(async () => {
      setError(null);
      const res = await orderAction(order.id, action);
      if (res?.error) setError(res.error);
    });

  const time = new Date(order.createdAt).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

  return (
    <article className={`rounded-xl bg-card p-4 ${waiting ? "border-2 border-ink" : "border border-line"} ${order.status === "COMPLETED" || order.status === "REJECTED" ? "opacity-70" : ""}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold leading-tight">
            #{order.code} <span className="font-sans text-base font-semibold">₹{order.total}</span>
          </p>
          <p className="text-sm text-ink-soft">
            {order.buyer.name}
            {order.buyer.regular && " (regular)"}, <a href={`tel:${order.buyer.phone}`} className="underline">{order.buyer.phone}</a>
          </p>
          <p className="text-xs text-mute">{time}, {CHANNEL[order.channel] ?? order.channel}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {order.status === "COMPLETED" && <Pill tone="leaf">{t.cashCollected}</Pill>}
          <Pill tone={waiting ? "turmeric" : "plain"}>{STATUS[order.status] ?? order.status}</Pill>
        </div>
      </header>

      <ul className="mt-3 space-y-0.5 text-[15px]">
        {order.items.map((l) => (
          <li key={l.productId}>
            <strong>{l.qty} ×</strong> {l.name} {l.size && <span className="text-mute">({l.size})</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-soft">
        {order.fulfilment === "DELIVERY" ? `${t.delivery}: ${order.address}` : t.pickup}
      </p>
      {order.note && <p className="mt-1 text-sm italic text-ink-soft">{order.note}</p>}

      <ErrorNote>{error}</ErrorNote>
      {order.actions.length > 0 && (
        <div className={`mt-3 grid gap-2 ${order.actions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {order.actions.map((a) => (
            <Button key={a} tone={a === "reject" ? "danger" : "leaf"} disabled={pending} onClick={() => act(a)} className="py-3">
              {LABEL[a]}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
