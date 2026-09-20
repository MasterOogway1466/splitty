import argon2 from "argon2";

// docs/PLAN-PUBLIC.md §5: argon2id hashing. Composition rules aren't
// enforced here — length (packages/shared's passwordSchema) plus
// argon2id plus rate limiting/lockout (§5) carry the security weight.
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed/foreign hash must fail closed, not throw past the caller.
    return false;
  }
}
