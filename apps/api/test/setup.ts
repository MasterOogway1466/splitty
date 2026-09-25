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

function extractToken(text: string): string {
  const match = text.match(/token=([\w-]+)/);
  if (!match?.[1]) throw new Error(`No token found in mail text: ${text}`);
  return match[1];
}

/** Signs up, verifies, and logs in a fresh user in one call — the
 * boilerplate every Phase 1 test needs just to get a usable account,
 * without re-testing the auth flow itself (already covered by
 * test/auth.flows.test.ts). */
export async function createVerifiedUser(
  ctx: TestContext,
  input: { email: string; password: string; displayName: string },
): Promise<{ userId: string; accessToken: string }> {
  const signupRes = await ctx.app.inject({ method: "POST", url: "/api/auth/signup", payload: input });
  if (signupRes.statusCode !== 201) throw new Error(`Signup failed: ${signupRes.body}`);
  const { userId } = signupRes.json();

  const verifyToken = extractToken(ctx.mailer.sent[ctx.mailer.sent.length - 1]!.text);
  const verifyRes = await ctx.app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token: verifyToken } });
  if (verifyRes.statusCode !== 200) throw new Error(`Verify failed: ${verifyRes.body}`);

  const loginRes = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: input.email, password: input.password },
  });
  if (loginRes.statusCode !== 200) throw new Error(`Login failed: ${loginRes.body}`);
  const { accessToken } = loginRes.json();

  return { userId, accessToken };
}

export function authHeader(accessToken: string): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}

// Everything except currencies/categories (seeded reference data these
// tests don't touch and don't want to have to re-seed every test).
// `users` and `groups` are both listed explicitly (not just relied on via
// cascade from one another) since `groups` has no FK *to* `users` — only
// `group_members` sits between them — so truncating just `users` would
// cascade-clear memberships but leave orphaned, empty group rows behind.
export async function truncateAllTestTables(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      rate_limit_events, account_lockouts, refresh_tokens, email_tokens, invites, groups, users
    RESTART IDENTITY CASCADE
  `);
}
