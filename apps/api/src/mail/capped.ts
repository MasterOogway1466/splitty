import type { Database } from "../db/client.js";
import { peekRateLimit, recordRateLimitEvent } from "../auth/rateLimit.js";
import type { Mailer, MailMessage } from "./mailer.js";

// docs/PLAN-PUBLIC.md §5: per-account cap on outbound email sends — a
// spend/abuse cap on the mail provider's quota, not a UX limit a real
// user should ever brush up against. Shared by every mail call site
// (auth verification/reset, group invites) rather than duplicated per
// caller, so the cap is actually total per account, not per feature.
const EMAIL_SEND_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 20 };

export async function sendCappedEmail(db: Database, mailer: Mailer, userId: string, message: MailMessage): Promise<void> {
  const cap = await peekRateLimit(db, "email_send", userId, EMAIL_SEND_CAP);
  if (!cap.allowed) {
    console.warn(`[mail] email-send cap exceeded for user ${userId}; suppressing send`);
    return;
  }
  await mailer.send(message);
  await recordRateLimitEvent(db, "email_send", userId);
}
