import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { rateLimitEvents } from "../db/schema.js";

export interface RateLimitOptions {
  windowSeconds: number;
  maxEvents: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

// docs/PLAN-PUBLIC.md §4/§5: Postgres-backed rate limiting so counters
// survive a container restart, not an in-process counter or Redis.
// `scope` distinguishes what's being limited (e.g. "login", "signup",
// "password_reset_request", "email_send"); `key` is what it's limited by
// (an IP address, a user id, an email address) — the same primitive
// serves both per-IP and per-account limits.
export async function checkAndRecordRateLimit(
  db: Database,
  scope: string,
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - opts.windowSeconds * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateLimitEvents)
    .where(and(eq(rateLimitEvents.scope, scope), eq(rateLimitEvents.key, key), gte(rateLimitEvents.createdAt, windowStart)));
  const count = row?.count ?? 0;

  if (count >= opts.maxEvents) {
    return { allowed: false, remaining: 0 };
  }

  await db.insert(rateLimitEvents).values({ scope, key });

  // Opportunistic cleanup (~1% of calls) instead of a separate cron job:
  // keeps the table from growing unbounded without adding an operational
  // dependency for something this low-stakes.
  if (Math.random() < 0.01) {
    await db
      .delete(rateLimitEvents)
      .where(and(eq(rateLimitEvents.scope, scope), lt(rateLimitEvents.createdAt, new Date(Date.now() - 24 * 3600 * 1000))));
  }

  return { allowed: true, remaining: Math.max(0, opts.maxEvents - count - 1) };
}

/** For read-only checks (e.g. the per-account email-send cap queried
 * before deciding whether to even attempt a send) without recording a
 * new event. */
export async function peekRateLimit(db: Database, scope: string, key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - opts.windowSeconds * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateLimitEvents)
    .where(and(eq(rateLimitEvents.scope, scope), eq(rateLimitEvents.key, key), gte(rateLimitEvents.createdAt, windowStart)));
  const count = row?.count ?? 0;
  return { allowed: count < opts.maxEvents, remaining: Math.max(0, opts.maxEvents - count) };
}

export async function recordRateLimitEvent(db: Database, scope: string, key: string): Promise<void> {
  await db.insert(rateLimitEvents).values({ scope, key });
}
