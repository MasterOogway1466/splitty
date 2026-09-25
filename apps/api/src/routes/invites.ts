import type { FastifyInstance } from "fastify";
import { acceptInviteRequestSchema } from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { RateLimitedError } from "../auth/errors.js";
import { toUserProfile } from "../auth/service.js";
import { setRefreshCookie } from "../auth/cookies.js";

/** Unauthenticated by design — the person accepting has no session yet.
 * Rate-limited per-IP like the equivalent auth endpoints (docs/PLAN-PUBLIC.md
 * §5), even though the token itself is high-entropy. */
export async function registerInviteRoutes(app: FastifyInstance): Promise<void> {
  const { db, env, inviteService } = app;

  app.get("/:token", async (request) => {
    const rl = await checkAndRecordRateLimit(db, "invite_info_ip", request.ip, { windowSeconds: 3600, maxEvents: 60 });
    if (!rl.allowed) throw new RateLimitedError(3600);

    const { token } = request.params as { token: string };
    return inviteService.getInfo(token);
  });

  app.post("/:token/accept", async (request, reply) => {
    const rl = await checkAndRecordRateLimit(db, "invite_accept_ip", request.ip, { windowSeconds: 3600, maxEvents: 20 });
    if (!rl.allowed) throw new RateLimitedError(3600);

    const { token } = request.params as { token: string };
    const body = acceptInviteRequestSchema.parse(request.body);
    const { user, accessToken, refreshTokenRaw } = await inviteService.accept(token, body);
    setRefreshCookie(reply, env, refreshTokenRaw);
    reply.status(201);
    return { accessToken, user: toUserProfile(user) };
  });
}
