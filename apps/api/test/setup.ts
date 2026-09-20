import "dotenv/config";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createDb, type Database } from "../src/db/client.js";
import { loadEnv } from "../src/env.js";
import { LogMailer } from "../src/mail/mailer.js";

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  mailer: LogMailer;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const env = loadEnv({ ...process.env, NODE_ENV: "test" });
  const { db, close } = createDb(env.DATABASE_URL);
  const mailer = new LogMailer();
  const app = await buildApp({ db, mailer, env });
  await app.ready();
  return {
    app,
    db,
    mailer,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

// Everything except currencies/categories (seeded reference data these
// tests don't touch and don't want to have to re-seed every test).
export async function truncateAuthTables(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      rate_limit_events, account_lockouts, refresh_tokens, email_tokens, invites, users
    RESTART IDENTITY CASCADE
  `);
}
