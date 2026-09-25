import { and, eq, isNull } from "drizzle-orm";
import type { UserProfile } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { emailTokens, refreshTokens, users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Mailer, MailMessage } from "../mail/mailer.js";
import { getLockoutState, recordFailedLogin, resetLockout } from "./lockout.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { peekRateLimit, recordRateLimitEvent } from "./rateLimit.js";
import { generateOpaqueToken, hashOpaqueToken, signAccessToken } from "./tokens.js";
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
// docs/PLAN-PUBLIC.md §5: per-account cap on outbound email sends — a
// spend/abuse cap on the mail provider's quota, not a UX limit a real
// user should ever brush up against.
const EMAIL_SEND_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 20 };

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

  async #sendCappedEmail(userId: string, message: MailMessage): Promise<void> {
    const cap = await peekRateLimit(this.#db, "email_send", userId, EMAIL_SEND_CAP);
    if (!cap.allowed) {
      console.warn(`[auth] email-send cap exceeded for user ${userId}; suppressing send`);
      return;
    }
    await this.#mailer.send(message);
    await recordRateLimitEvent(this.#db, "email_send", userId);
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
    await this.#sendCappedEmail(userId, {
      to: email,
      subject: "Verify your email",
      text: `Welcome to Splitty! Verify your email:\n\n${link}\n\nThis link expires in 24 hours.`,
    });
  }

  async #issueRefreshToken(userId: string): Promise<string> {
    const raw = generateOpaqueToken();
    await this.#db.insert(refreshTokens).values({
      userId,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + this.#env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    });
    return raw;
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
      if (isUniqueViolation(err)) throw new EmailAlreadyRegisteredError();
      throw err;
    }
    if (!inserted) throw new Error("Insert returned no row");
    await this.#sendVerificationEmail(inserted.id, input.email);
    return { user: inserted };
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = hashOpaqueToken(rawToken);
    const [tokenRow] = await this.#db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, tokenHash), eq(emailTokens.purpose, "verify")));
    if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
      throw new InvalidOrExpiredTokenError();
    }
    await this.#db.transaction(async (tx) => {
      await tx.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, tokenRow.id));
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, tokenRow.userId));
    });
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

    const accessToken = signAccessToken(user.id, this.#env.JWT_SECRET, this.#env.ACCESS_TOKEN_TTL_MINUTES);
    const refreshTokenRaw = await this.#issueRefreshToken(user.id);
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
    await this.#db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, tokenRow.id));

    const refreshTokenRaw = await this.#issueRefreshToken(user.id);
    const accessToken = signAccessToken(user.id, this.#env.JWT_SECRET, this.#env.ACCESS_TOKEN_TTL_MINUTES);
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
    const rawToken = generateOpaqueToken();
    await this.#db.insert(emailTokens).values({
      userId: user.id,
      purpose: "reset",
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    const link = `${this.#env.APP_ORIGIN}/reset-password?token=${rawToken}`;
    await this.#sendCappedEmail(user.id, {
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
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, tokenRow.userId));
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
}
