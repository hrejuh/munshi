// Local Postgres for development without Docker or a system install.
// Usage: npm run db:local  (leave it running), then in .env:
//   DATABASE_URL=postgresql://munshi:munshi@localhost:5433/munshi
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), ".local-db");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "munshi",
  password: "munshi",
  port: 5433,
  persistent: true,
  // Windows defaults to WIN1252, which cannot store Kannada/Hindi/Tamil text.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

async function main() {
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("munshi");
  console.log("Local Postgres ready: postgresql://munshi:munshi@localhost:5433/munshi");
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
