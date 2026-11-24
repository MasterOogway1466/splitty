import { desc, eq } from "drizzle-orm";
import { RateLimitedError } from "../auth/errors.js";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { generateOpaqueToken, hashOpaqueToken } from "../auth/tokens.js";
import type { Database } from "../db/client.js";
import { invites } from "../db/schema.js";
import type { Env } from "../env.js";
import { sendCappedEmail } from "../mail/capped.js";
import type { Mailer } from "../mail/mailer.js";

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

/** docs/PLAN-PUBLIC.md §5: invites count against whoever sends them, plus
 * a cap per address so several senders can't pile onto one person. Called
 * before anything is created, so a capped invite leaves nothing behind. */
export async function reserveInviteSend(db: Database, inviterId: string, email: string): Promise<void> {
  for (const [scope, key, maxEvents] of [
    ["invite_send", inviterId, 20],
    ["invite_recipient", email, 5],
  ] as const) {
    const rl = await checkAndRecordRateLimit(db, scope, key, { windowSeconds: DAY_SECONDS, maxEvents });
    if (!rl.allowed) throw new RateLimitedError(DAY_SECONDS);
  }
}

/** Records a fresh invite and returns its claim link. Earlier links stay
 * valid until they expire or any one of them is accepted. */
export async function createInviteLink(
  db: Pick<Database, "insert">,
  env: Env,
  input: { inviterId: string; email: string; placeholderUserId: string; groupId: string | null },
): Promise<string> {
  const rawToken = generateOpaqueToken();
  await db.insert(invites).values({
    inviterId: input.inviterId,
    inviteeEmail: input.email,
    placeholderUserId: input.placeholderUserId,
    groupId: input.groupId,
    tokenHash: hashOpaqueToken(rawToken),
    expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
  });
  return `${env.APP_ORIGIN}/accept-invite?token=${rawToken}`;
}

/** For an invited person who signs up or asks for a password reset instead
 * of using their invite: emails a fresh claim link. The account is only
 * ever claimed through that link, which proves they own the address. */
export async function sendClaimEmail(db: Database, mailer: Mailer, env: Env, placeholder: { id: string; email: string }): Promise<void> {
  const [latest] = await db
    .select({ inviterId: invites.inviterId, groupId: invites.groupId })
    .from(invites)
    .where(eq(invites.placeholderUserId, placeholder.id))
    .orderBy(desc(invites.createdAt))
    .limit(1);
  if (!latest) return;
  const link = await createInviteLink(db, env, { ...latest, email: placeholder.email, placeholderUserId: placeholder.id });
  await sendCappedEmail(db, mailer, placeholder.id, {
    to: placeholder.email,
    subject: "Finish setting up your Splitty account",
    text: `You've been invited to Splitty. Finish setting up your account:\n\n${link}\n\nThis link expires in 7 days. If you didn't ask for this, you can ignore this email.`,
  });
}
