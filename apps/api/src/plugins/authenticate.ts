import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../auth/tokens.js";
import { AccountSuspendedError, UnauthenticatedError } from "../auth/errors.js";

/**
 * docs/PLAN-PUBLIC.md §5: a `suspended` account is rejected outright at
 * the auth layer — every authenticated request checks current `status`
 * against the database, not just the claims embedded in the access token
 * at issuance time. This trades a bit of the usual "stateless JWT"
 * performance for correctness: suspension takes effect on the very next
 * request, not after the access token happens to expire (~15 min).
 */
export async function authenticate(app: FastifyInstance, request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthenticatedError();
  }
  const token = header.slice("Bearer ".length);

  let userId: string;
  try {
    userId = verifyAccessToken(token, app.env.JWT_SECRET).sub;
  } catch {
    throw new UnauthenticatedError();
  }

  const user = await app.authService.getUserById(userId);
  if (!user) {
    throw new UnauthenticatedError();
  }
  if (user.status === "suspended" || user.status === "deleted") {
    throw new AccountSuspendedError();
  }

  request.currentUser = user;
}
