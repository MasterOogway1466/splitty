import "fastify";
import type { AuthService } from "../auth/service.js";
import type { Database } from "../db/client.js";
import type { users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { GroupService } from "../groups/service.js";
import type { InviteService } from "../invites/service.js";

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    groupService: GroupService;
    inviteService: InviteService;
    db: Database;
    env: Env;
  }
  interface FastifyRequest {
    currentUser?: typeof users.$inferSelect;
  }
}
