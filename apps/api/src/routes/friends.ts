import type { FastifyInstance } from "fastify";
import { addFriendRequestSchema } from "@splitty/shared";
import { RateLimitedError } from "../auth/errors.js";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { MEMBER_ADD_CAP } from "./groups.js";

export async function registerFriendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.post("/", async (request, reply) => {
    const userId = request.currentUser!.id;
    // The same cap as adding group members: both reach a person by email.
    const rl = await checkAndRecordRateLimit(app.db, "member_add", userId, MEMBER_ADD_CAP);
    if (!rl.allowed) throw new RateLimitedError(MEMBER_ADD_CAP.windowSeconds);

    const { email } = addFriendRequestSchema.parse(request.body);
    await app.groupService.addFriend(email, userId);
    return reply.status(204).send();
  });
}
