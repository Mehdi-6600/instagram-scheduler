/**
 * Optional local development database (no system PostgreSQL required).
 * Starts an embedded PostgreSQL instance on port 5433 with database `mis_dev`.
 *
 * Usage:
 *   npm i -D embedded-postgres     # optional, one-time
 *   node scripts/dev-db.mjs        # start (Ctrl+C to stop)
 *
 * DATABASE_URL: postgresql://postgres:password@localhost:5433/mis_dev
 */
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.DEV_DB_PORT || 5433);
const DB_DIR = path.resolve(process.cwd(), "pgdata");
const USER = "postgres";
const PASSWORD = "password";
const DATABASE = "mis_dev";

async function main() {
  let EmbeddedPostgres;
  try {
    EmbeddedPostgres = (await import("embedded-postgres")).default;
  } catch {
    console.error(
      "embedded-postgres is not installed. Run: npm i -D embedded-postgres\n" +
        "(Or point DATABASE_URL at any PostgreSQL / Neon / Supabase instance.)"
    );
    process.exit(1);
  }

  const pg = new EmbeddedPostgres({
    databaseDir: DB_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  if (!fs.existsSync(path.join(DB_DIR, "PG_VERSION"))) {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(DATABASE);
  } else {
    await pg.start();
  }

  console.log(`Embedded PostgreSQL running on port ${PORT}`);
  console.log(`DATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`);
  console.log("Press Ctrl+C to stop.");

  process.on("SIGINT", async () => {
    await pg.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await pg.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
