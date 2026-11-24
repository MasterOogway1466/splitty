import { and, eq, isNull, sql } from "drizzle-orm";
import type { UpdateProfileRequest, UserProfile } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { emailTokens, refreshTokens, users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Mailer } from "../mail/mailer.js";
import { sendClaimEmail } from "../invites/send.js";
import { sendCappedEmail } from "../mail/capped.js";
import { getLockoutState, recordFailedLogin, resetLockout } from "./lockout.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { generateOpaqueToken, hashOpaqueToken, issueRefreshToken, signAccessToken } from "./tokens.js";
import {
  AccountLockedError,
  AccountSuspendedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidOrExpiredTokenError,
  InvalidRefreshTokenError,
} from "./errors.js";

type UserRow = typeof users.$inferSelect;

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}

export function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    defaultCurrency: user.defaultCurrency,
    timezone: user.timezone,
    emailVerified: user.emailVerifiedAt !== null,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  #db: Database;
  #mailer: Mailer;
  #env: Env;
  #dummyHash: Promise<string> | null = null;

  constructor(db: Database, mailer: Mailer, env: Env) {
    this.#db = db;
    this.#mailer = mailer;
    this.#env = env;
  }

  // A fixed, precomputed argon2id hash to compare against when no user
  // matches — keeps a login attempt against a nonexistent email roughly
  // as slow as one against a real account, rather than returning
  // immediately and leaking which emails exist via response timing.
  #getDummyHash(): Promise<string> {
    this.#dummyHash ??= hashPassword("splitty-dummy-password-for-timing-safety");
    return this.#dummyHash;
  }

  async #sendVerificationEmail(userId: string, email: string): Promise<void> {
    const rawToken = generateOpaqueToken();
    await this.#db.insert(emailTokens).values({
      userId,
      purpose: "verify",
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    });
    const link = `${this.#env.APP_ORIGIN}/verify-email?token=${rawToken}`;
    await sendCappedEmail(this.#db, this.#mailer, userId, {
      to: email,
      subject: "Verify your email",
      text: `Welcome to Splitty! Verify your email:\n\n${link}\n\nThis link expires in 24 hours. If you didn't sign up for Splitty, ignore this email.`,
    });
  }


  async signup(input: { email: string; password: string; displayName: string }): Promise<{ user: UserRow }> {
    const passwordHash = await hashPassword(input.password);
    let inserted: UserRow | undefined;
    try {
      [inserted] = await this.#db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          status: "active",
        })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [existing] = await this.#db.select().from(users).where(eq(users.email, input.email));
      if (existing?.status !== "invited") throw new EmailAlreadyRegisteredError();
      // An invited placeholder: whoever is signing up hasn't proven they
      // own the address, so the password they typed is discarded and the
      // account can only be claimed through the emailed link.
      await sendClaimEmail(this.#db, this.#mailer, this.#env, { id: existing.id, email: input.email });
      return { user: existing };
    }
    if (!inserted) throw new Error("Insert returned no row");
    await this.#sendVerificationEmail(inserted.id, input.email);
    return { user: inserted };
  }

  async resendVerification(user: UserRow): Promise<void> {
    if (user.emailVerifiedAt || !user.email) return;
    await this.#sendVerificationEmail(user.id, user.email);
  }

  /** Needs both the emailed link and the signup password. Otherwise anyone
   * could sign up with someone else's address and have the real owner
   * verify it for them just by clicking the link. Starts a session. */
  async verifyEmail(rawToken: string, password: string): Promise<{ user: UserRow; accessToken: string; refreshTokenRaw: string }> {
    const tokenHash = hashOpaqueToken(rawToken);
    const [tokenRow] = await this.#db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, tokenHash), eq(emailTokens.purpose, "verify")));
    if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
      throw new InvalidOrExpiredTokenError();
    }
    const [account] = await this.#db.select().from(users).where(eq(users.id, tokenRow.userId));
    if (!account || account.status !== "active") throw new InvalidOrExpiredTokenError();
    if (!account.passwordHash || !(await verifyPassword(account.passwordHash, password))) {
      throw new InvalidCredentialsError();
    }

    const user = await this.#db.transaction(async (tx) => {
      const spent = await tx
        .update(emailTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(emailTokens.id, tokenRow.id), isNull(emailTokens.usedAt)))
        .returning({ id: emailTokens.id });
      // Pinned to the hash just checked: a reset landing in between wins.
      const [verified] = await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, account.id), eq(users.status, "active"), eq(users.passwordHash, account.passwordHash!)))
        .returning();
      if (spent.length === 0 || !verified) throw new InvalidOrExpiredTokenError();
      return verified;
    });
    const accessToken = signAccessToken(user, this.#env.JWT_SECRET, this.#env.ACCESS_TOKEN_TTL_MINUTES);
    const refreshTokenRaw = await issueRefreshToken(this.#db, user, this.#env.REFRESH_TOKEN_TTL_DAYS);
    return { user, accessToken, refreshTokenRaw };
  }

  async login(input: { email: string; password: string }): Promise<{ user: UserRow; accessToken: string; refreshTokenRaw: string }> {
    const [user] = await this.#db.select().from(users).where(eq(users.email, input.email));

    if (!user || !user.passwordHash) {
      await verifyPassword(await this.#getDummyHash(), input.password);
      throw new InvalidCredentialsError();
    }

    if (user.status === "suspended" || user.status === "deleted") {
      // Rejected outright, not merely scoped to no data (§5) — a
      // suspended account must not be able to log in at all.
      throw new AccountSuspendedError();
    }

    const lockout = await getLockoutState(this.#db, user.id);
    if (lockout.lockedUntil) {
      throw new AccountLockedError(lockout.lockedUntil);
    }

    const validPassword = await verifyPassword(user.passwordHash, input.password);
    if (!validPassword) {
      await recordFailedLogin(this.#db, user.id);
      throw new InvalidCredentialsError();
    }

    await resetLockout(this.#db, user.id);

    const accessToken = signAccessToken(user, this.#env.JWT_SECRET, this.#env.ACCESS_TOKEN_TTL_MINUTES);
    const refreshTokenRaw = await issueRefreshToken(this.#db, user, this.#env.REFRESH_TOKEN_TTL_DAYS);
    return { user, accessToken, refreshTokenRaw };
  }

  async refresh(rawRefreshToken: string): Promise<{ accessToken: string; refreshTokenRaw: string }> {
    const tokenHash = hashOpaqueToken(rawRefreshToken);
    const [tokenRow] = await this.#db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    if (!tokenRow || tokenRow.revokedAt || tokenRow.expiresAt < new Date()) {
      throw new InvalidRefreshTokenError();
    }

    const [user] = await this.#db.select().from(users).where(eq(users.id, tokenRow.userId));
    if (!user || user.status === "suspended" || user.status === "deleted") {
      throw new InvalidRefreshTokenError();
    }

    // Rotation: the presented token is single-use. Revoking it here means
    // a stolen-and-replayed refresh token stops working the moment the
    // legitimate client refreshes again.
    // One transaction, in the same user-then-token lock order as a reset.
    const refreshTokenRaw = await this.#db.transaction(async (tx) => {
      const next = await issueRefreshToken(tx, user, this.#env.REFRESH_TOKEN_TTL_DAYS);
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, tokenRow.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (revoked.length === 0) throw new InvalidRefreshTokenError();
      return next;
    });
    const accessToken = signAccessToken(user, this.#env.JWT_SECRET, this.#env.ACCESS_TOKEN_TTL_MINUTES);
    return { accessToken, refreshTokenRaw };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawRefreshToken);
    await this.#db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));
  }

  async requestPasswordReset(email: string): Promise<void> {
    const [user] = await this.#db.select().from(users).where(eq(users.email, email));
    if (!user || user.status === "deleted" || !user.email) {
      // Always a no-op-looking success from the caller's perspective —
      // confirming or denying an email's existence here is exactly the
      // enumeration this endpoint must not leak.
      return;
    }
    if (user.status === "invited") {
      await sendClaimEmail(this.#db, this.#mailer, this.#env, { id: user.id, email: user.email });
      return;
    }
    const rawToken = generateOpaqueToken();
    await this.#db.insert(emailTokens).values({
      userId: user.id,
      purpose: "reset",
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    const link = `${this.#env.APP_ORIGIN}/reset-password?token=${rawToken}`;
    await sendCappedEmail(this.#db, this.#mailer, user.id, {
      to: user.email,
      subject: "Reset your password",
      text: `Reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    });
  }

  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    const [tokenRow] = await this.#db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, tokenHash), eq(emailTokens.purpose, "reset")));
    if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
      throw new InvalidOrExpiredTokenError();
    }

    const passwordHash = await hashPassword(newPassword);
    await this.#db.transaction(async (tx) => {
      await tx.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, tokenRow.id));
      // Following the emailed link proves ownership of the address, so it
      // verifies the account too.
      await tx
        .update(users)
        .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1`, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: new Date() })
        .where(eq(users.id, tokenRow.userId));
      // A password reset invalidates every existing session — whatever
      // motivated the reset, nothing should still be logged in on the
      // old password afterward.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, tokenRow.userId), isNull(refreshTokens.revokedAt)));
    });
    await resetLockout(this.#db, tokenRow.userId);
  }

  async getUserById(userId: string): Promise<UserRow | null> {
    const [user] = await this.#db.select().from(users).where(eq(users.id, userId));
    return user ?? null;
  }

  async updateProfile(userId: string, input: UpdateProfileRequest): Promise<UserRow> {
    const patch: Partial<Pick<UserRow, "displayName" | "defaultCurrency" | "timezone">> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.defaultCurrency !== undefined) patch.defaultCurrency = input.defaultCurrency;
    if (input.timezone !== undefined) patch.timezone = input.timezone;

    const [updated] = await this.#db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new Error("Update returned no row");
    return updated;
  }
}
