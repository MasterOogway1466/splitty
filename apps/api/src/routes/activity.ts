import type { FastifyInstance } from "fastify";
import { readActivity } from "../activity/read.js";
import { authenticateVerified } from "../plugins/authenticate.js";

/** Global activity feed — every group-scoped and direct event where the
 * current user is a recipient (docs/PLAN-PUBLIC.md §6/§9). */
export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (request) => readActivity(app.db, request.currentUser!.id));
}
