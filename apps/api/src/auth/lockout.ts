import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accountLockouts } from "../db/schema.js";

// docs/PLAN-PUBLIC.md §5: lockout/backoff after repeated failed logins on
// an account, escalating rather than a single fixed lockout — a handful
// of mistyped passwords is normal, a long unbroken streak is not.
const LOCKOUT_THRESHOLD = 5;
const BASE_LOCKOUT_SECONDS = 30;
const MAX_LOCKOUT_SECONDS = 15 * 60;

export async function getLockoutState(db: Database, userId: string): Promise<{ lockedUntil: Date | null }> {
  const [row] = await db.select().from(accountLockouts).where(eq(accountLockouts.userId, userId));
  if (!row?.lockedUntil || row.lockedUntil <= new Date()) {
    return { lockedUntil: null };
  }
  return { lockedUntil: row.lockedUntil };
}

export async function recordFailedLogin(db: Database, userId: string): Promise<void> {
  const [existing] = await db.select().from(accountLockouts).where(eq(accountLockouts.userId, userId));
  const failedAttempts = (existing?.failedAttempts ?? 0) + 1;

  let lockedUntil: Date | null = null;
  if (failedAttempts >= LOCKOUT_THRESHOLD) {
    const escalation = failedAttempts - LOCKOUT_THRESHOLD;
    const lockoutSeconds = Math.min(BASE_LOCKOUT_SECONDS * 2 ** escalation, MAX_LOCKOUT_SECONDS);
    lockedUntil = new Date(Date.now() + lockoutSeconds * 1000);
  }

  await db
    .insert(accountLockouts)
    .values({ userId, failedAttempts, lockedUntil, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountLockouts.userId,
      set: { failedAttempts, lockedUntil, updatedAt: new Date() },
    });
}

export async function resetLockout(db: Database, userId: string): Promise<void> {
  await db
    .insert(accountLockouts)
    .values({ userId, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountLockouts.userId,
      set: { failedAttempts: 0, lockedUntil: null, updatedAt: new Date() },
    });
}
