import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { InvalidRefreshTokenError } from "./errors.js";
import type { Executor } from "../db/client.js";
import { refreshTokens, users } from "../db/schema.js";

// Opaque tokens (refresh tokens, email-verify/reset tokens, §5): the raw
// token is only ever shown to the client once (in a cookie or an email
// link) and is never stored — only its hash is, so a database read alone
// can't be used to forge a session or reset link.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AccessTokenPayload {
  sub: string;
  ver: number;
}

export function signAccessToken(user: { id: string; tokenVersion: number }, secret: string, ttlMinutes: number): string {
  return jwt.sign({ sub: user.id, ver: user.tokenVersion }, secret, { expiresIn: `${ttlMinutes}m` });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Invalid access token payload");
  }
  // Tokens issued before versions existed count as version 0.
  return { sub: decoded.sub, ver: typeof decoded.ver === "number" ? decoded.ver : 0 };
}

/** Shared by every call site that needs to start a session (login,
 * refresh rotation, invite acceptance) so token issuance stays in one
 * place rather than duplicated per caller. */
export async function issueRefreshToken(
  db: Executor,
  user: { id: string; tokenVersion: number },
  ttlDays: number,
): Promise<string> {
  const raw = generateOpaqueToken();
  await db.transaction(async (tx) => {
    // Locked and rechecked: a password reset since `user` was read must not
    // be outlived by a session issued against the old credentials.
    const [current] = await tx.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, user.id)).for("update");
    if (current?.tokenVersion !== user.tokenVersion) throw new InvalidRefreshTokenError();
    await tx.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    });
  });
  return raw;
}
