import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Button, inputClass } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdmin, startAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function login(form: FormData) {
  "use server";
  if (env.adminPassword && String(form.get("password")) === env.adminPassword) {
    await startAdminSession();
  }
  redirect("/admin");
}

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" });

/** PRD F13: timestamped proof of sign-ups, orders, calls and agent actions for judges. */
export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <main className="mx-auto max-w-sm px-4 pt-16">
        <h1 className="font-display text-3xl font-extrabold">Munshi admin</h1>
        <form action={login} className="mt-6 space-y-3">
          <input name="password" type="password" placeholder="Admin password" className={inputClass} required />
          <Button type="submit" tone="ink" className="w-full">Sign in</Button>
        </form>
      </main>
    );
  }

  const [shops, orders, logs, calls, buyers, products, approvals, completed] = await Promise.all([
    db.shop.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.order.findMany({ orderBy: { createdAt: "desc" }, include: { shop: true, buyer: true }, take: 100 }),
    db.agentLog.findMany({ orderBy: { createdAt: "desc" }, include: { shop: true }, take: 200 }),
    db.conversation.count(),
    db.buyer.count(),
    db.product.count({ where: { status: "APPROVED" } }),
    db.agentLog.count({ where: { approvedBy: { not: null } } }),
    db.order.count({ where: { status: "COMPLETED" } }),
  ]);
  const live = shops.filter((s) => s.status === "LIVE").length;

  const metrics = [
    { label: "Shops live", value: live, goal: 5, stretch: 10 },
    { label: "Total users (owners + buyers)", value: shops.length + buyers, goal: 20, stretch: 40 },
    { label: "Products listed", value: products, goal: 100, stretch: 300 },
    { label: "Orders completed (cash collected)", value: completed, goal: 1, stretch: 5 },
    { label: "Agent actions approved by owners", value: approvals, goal: 30, stretch: 100 },
    { label: "Voice sessions and calls", value: calls },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Proof dashboard</h1>
          <p className="text-sm text-mute">All times IST. Updated {fmt(new Date())}.</p>
        </div>
        <div className="flex gap-2 text-sm font-semibold">
          {["shops", "orders", "logs"].map((type) => (
            <a key={type} href={`/admin/export?type=${type}`} className="rounded-lg border border-line bg-card px-3 py-2">
              {type}.csv
            </a>
          ))}
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm text-mute">{m.label}</p>
            <p className="font-display text-4xl font-extrabold">{m.value}</p>
            {m.goal !== undefined && (
              <p className={`text-xs ${m.value >= m.goal ? "text-leaf" : "text-mute"}`}>
                goal {m.goal}, stretch {m.stretch}
              </p>
            )}
          </div>
        ))}
      </section>

      <Table
        title="Sign-ups"
        head={["Time", "Owner", "Phone", "Shop", "Status", "Live since"]}
        rows={shops.map((s) => [fmt(s.createdAt), s.ownerName, s.phone, s.name ?? "", s.status, s.approvedAt ? fmt(s.approvedAt) : ""])}
      />
      <Table
        title="Orders (cash on delivery)"
        head={["Time", "Code", "Shop", "Buyer", "Channel", "Total", "Status"]}
        rows={orders.map((o) => [fmt(o.createdAt), o.code, o.shop.name ?? "", o.buyer.name, o.channel, `₹${o.total}`, o.status])}
      />
      <Table
        title="Agent activity log"
        head={["Time", "Shop", "Agent", "Action", "Provider", "Approval", "Output"]}
        rows={logs.map((l) => [
          fmt(l.createdAt),
          l.shop?.name ?? "",
          l.agent,
          l.action,
          l.provider,
          l.approvedBy ? `approved by ${l.approvedBy}` : l.needsApproval ? "needs approval" : "",
          (l.outputSummary ?? "").slice(0, 120),
        ])}
      />
    </main>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-bold">
        {title} <span className="text-mute">({rows.length})</span>
      </h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-ink-soft">
            <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
