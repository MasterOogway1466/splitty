import { desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { activityFeed, groups, users } from "../db/schema.js";
import { authenticate } from "../plugins/authenticate.js";

/** Global activity feed — every group-scoped and direct event where the
 * current user is a recipient (docs/PLAN-PUBLIC.md §6/§9: one shared
 * timeline per group and globally, no email fan-out in this design). */
export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook("preHandler", (request, reply) => authenticate(app, request, reply));

  app.get("/", async (request) => {
    const userId = request.currentUser!.id;
    const rows = await db.select().from(activityFeed).where(eq(activityFeed.recipientId, userId)).orderBy(desc(activityFeed.createdAt)).limit(50);

    const actorIds = [...new Set(rows.map((r) => r.actorId))];
    const actorRows = actorIds.length
      ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, actorIds))
      : [];
    const actorMap = new Map(actorRows.map((a) => [a.id, a.displayName]));

    const groupIds = [...new Set(rows.map((r) => r.groupId).filter((id): id is string => id !== null))];
    const groupRows = groupIds.length ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds)) : [];
    const groupMap = new Map(groupRows.map((g) => [g.id, g.name]));

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      actorId: row.actorId,
      actorDisplayName: actorMap.get(row.actorId) ?? "Someone",
      entityType: row.entityType,
      entityId: row.entityId,
      groupId: row.groupId,
      groupName: row.groupId ? (groupMap.get(row.groupId) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}
