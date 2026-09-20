import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

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
}

export function signAccessToken(userId: string, secret: string, ttlMinutes: number): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: `${ttlMinutes}m` });
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Invalid access token payload");
  }
  return { sub: decoded.sub };
}
