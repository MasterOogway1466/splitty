import { eq } from "drizzle-orm";
import type { InviteInfo } from "@splitty/shared";
import { hashPassword } from "../auth/passwords.js";
import { hashOpaqueToken, issueRefreshToken, signAccessToken } from "../auth/tokens.js";
import { InvalidOrExpiredTokenError } from "../auth/errors.js";
import type { Database } from "../db/client.js";
import { groups, invites, users } from "../db/schema.js";
import type { Env } from "../env.js";

type UserRow = typeof users.$inferSelect;

export class InviteService {
  #db: Database;
  #env: Env;

  constructor(db: Database, env: Env) {
    this.#db = db;
    this.#env = env;
  }

  async getInfo(rawToken: string): Promise<InviteInfo> {
    const tokenHash = hashOpaqueToken(rawToken);
    const [invite] = await this.#db.select().from(invites).where(eq(invites.tokenHash, tokenHash));
    if (!invite) throw new InvalidOrExpiredTokenError();

    const [inviter] = await this.#db.select().from(users).where(eq(users.id, invite.inviterId));
    let groupName: string | null = null;
    if (invite.groupId) {
      const [group] = await this.#db.select().from(groups).where(eq(groups.id, invite.groupId));
      groupName = group?.name ?? null;
    }

    return {
      inviteeEmail: invite.inviteeEmail,
      inviterDisplayName: inviter?.displayName ?? "Someone",
      groupName,
      expired: invite.expiresAt < new Date(),
      alreadyAccepted: invite.acceptedAt !== null,
    };
  }

  /** Claims the placeholder account created when the invite was sent:
   * sets a real password and display name, flips status to active, and
   * treats clicking this emailed link as email verification (§5) — the
   * same session-issuing shape as a normal login. */
  async accept(
    rawToken: string,
    input: { displayName: string; password: string },
  ): Promise<{ user: UserRow; accessToken: string; refreshTokenRaw: string }> {
    const tokenHash = hashOpaqueToken(rawToken);
    const [invite] = await this.#db.select().from(invites).where(eq(invites.tokenHash, tokenHash));
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new InvalidOrExpiredTokenError();
    }

    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    await this.#db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ displayName: input.displayName, passwordHash, status: "active", emailVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, invite.placeholderUserId));
      await tx.update(invites).set({ acceptedAt: now }).where(eq(invites.id, invite.id));
    });

    const [user] = await this.#db.select().from(users).where(eq(users.id, invite.placeholderUserId));
    if (!user) throw new Error("Placeholder user missing after accept");

    const accessToken = signAccessToken(user.id, this.#env.JWT_SECRET, this.#env.ACCESS_TOKEN_TTL_MINUTES);
    const refreshTokenRaw = await issueRefreshToken(this.#db, user.id, this.#env.REFRESH_TOKEN_TTL_DAYS);
    return { user, accessToken, refreshTokenRaw };
  }
}
