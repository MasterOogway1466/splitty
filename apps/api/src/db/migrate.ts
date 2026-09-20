import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";
import { loadEnv } from "../env.js";

async function main() {
  const env = loadEnv();
  const { db, close } = createDb(env.DATABASE_URL);
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
