import { db } from "@/lib/db";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

function csv(rows: Array<Array<string | number | null | undefined>>) {
  return rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export async function GET(req: Request) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const type = new URL(req.url).searchParams.get("type");
  let rows: Array<Array<string | number | null>> = [];

  if (type === "shops") {
    const shops = await db.shop.findMany({ orderBy: { createdAt: "asc" } });
    rows = [["created_at", "owner", "phone", "shop", "slug", "status", "approved_at"], ...shops.map((s) => [s.createdAt.toISOString(), s.ownerName, s.phone, s.name, s.slug, s.status, s.approvedAt?.toISOString() ?? null])];
  } else if (type === "orders") {
    const orders = await db.order.findMany({ orderBy: { createdAt: "asc" }, include: { shop: true, buyer: true } });
    rows = [["created_at", "code", "shop", "buyer", "channel", "fulfilment", "total", "status"], ...orders.map((o) => [o.createdAt.toISOString(), o.code, o.shop.name, o.buyer.name, o.channel, o.fulfilment, o.total, o.status])];
  } else {
    const logs = await db.agentLog.findMany({ orderBy: { createdAt: "asc" }, include: { shop: true } });
    rows = [["created_at", "shop", "agent", "action", "provider", "run_id", "confidence", "needs_approval", "approved_by", "input", "output"], ...logs.map((l) => [l.createdAt.toISOString(), l.shop?.name ?? null, l.agent, l.action, l.provider, l.runId, l.confidence, String(l.needsApproval), l.approvedBy, l.inputSummary, l.outputSummary])];
  }

  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="munshi-${type ?? "logs"}.csv"`,
    },
  });
}
