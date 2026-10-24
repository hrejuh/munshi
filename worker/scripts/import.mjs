#!/usr/bin/env node
// Convert bot.py's shops.json into a `wrangler kv bulk put` file using the Worker's key scheme.
// Usage: node scripts/import.mjs path/to/shops.json [out.json]
//        npx wrangler kv bulk put out.json --binding DB --remote
// Sessions are dropped. The output holds customer data: do not commit it.
import { readFileSync, writeFileSync } from "node:fs";

const [inPath, outPath = "kv-bulk.json"] = process.argv.slice(2);
if (!inPath) {
  console.error("usage: node scripts/import.mjs <shops.json> [out.json]");
  process.exit(1);
}
const db = JSON.parse(readFileSync(inPath, "utf8"));
const shops = db.shops || {}, orders = db.orders || {};
const owners = { ...(db.owners || {}) };
const out = [];
const put = (key, v) => out.push({ key, value: JSON.stringify(v) });

for (const [sid, sh] of Object.entries(shops)) {
  put(`shop:${sid}`, sh);
  owners[String(sh.owner)] ??= sid;
}
for (const [oid, o] of Object.entries(orders)) put(`order:${oid}`, o);
for (const [chat, sid] of Object.entries(owners)) if (shops[sid]) put(`owner:${chat}`, sid);
put("index:shops", Object.keys(shops));
put("index:orders", Object.keys(orders));

writeFileSync(outPath, JSON.stringify(out));
console.log(`${Object.keys(shops).length} shops, ${Object.keys(orders).length} orders, ${out.length} keys -> ${outPath}`);
console.log(`next: npx wrangler kv bulk put ${outPath} --binding DB --remote`);
