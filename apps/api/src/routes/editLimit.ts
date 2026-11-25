import { RateLimitedError } from "../auth/errors.js";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import type { Database } from "../db/client.js";

const EDIT_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 500 };

/** One per-account cap across every ledger edit, delete and restore. */
export async function limitLedgerEdits(db: Database, userId: string): Promise<void> {
  const rl = await checkAndRecordRateLimit(db, "ledger_edit", userId, EDIT_CAP);
  if (!rl.allowed) throw new RateLimitedError(EDIT_CAP.windowSeconds);
}
