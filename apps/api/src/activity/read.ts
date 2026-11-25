import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { ActivityItem } from "@splitty/shared";
import type { Executor } from "../db/client.js";
import { activityFeed, expenseParticipants, expensePayers, expenses, groupMembers, groups, users } from "../db/schema.js";

/** A user's own feed, newest first, optionally for one group. An expense is
 * named only while the reader can still open it: the row itself outlives
 * their access, and the current description may be newer than it. */
export async function readActivity(db: Executor, userId: string, groupId?: string): Promise<ActivityItem[]> {
  const rows = await db
    .select({ feed: activityFeed, actorName: users.displayName, groupName: groups.name, groupDeletedAt: groups.deletedAt, myRole: groupMembers.role })
    .from(activityFeed)
    .innerJoin(users, eq(users.id, activityFeed.actorId))
    .leftJoin(groups, eq(groups.id, activityFeed.groupId))
    .leftJoin(
      groupMembers,
      and(eq(groupMembers.groupId, activityFeed.groupId), eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)),
    )
    .where(and(eq(activityFeed.recipientId, userId), groupId ? eq(activityFeed.groupId, groupId) : undefined))
    .orderBy(desc(activityFeed.createdAt))
    .limit(50);

  const expenseIds = [...new Set(rows.filter((r) => r.feed.entityType === "expense").map((r) => r.feed.entityId))];
  const labels = new Map<string, string>();
  const partyTo = new Set<string>();
  if (expenseIds.length > 0) {
    for (const e of await db.select({ id: expenses.id, description: expenses.description }).from(expenses).where(inArray(expenses.id, expenseIds))) {
      labels.set(e.id, e.description);
    }
    for (const table of [expensePayers, expenseParticipants]) {
      const mine = await db
        .select({ id: table.expenseId })
        .from(table)
        .where(and(inArray(table.expenseId, expenseIds), eq(table.userId, userId)));
      for (const m of mine) partyTo.add(m.id);
    }
  }

  return rows.map(({ feed, actorName, groupName, groupDeletedAt, myRole }) => {
    const canOpen = feed.groupId === null ? partyTo.has(feed.entityId) : myRole !== null && groupDeletedAt === null;
    return {
      id: feed.id,
      type: feed.type,
      actorId: feed.actorId,
      actorDisplayName: actorName,
      entityType: feed.entityType,
      entityId: feed.entityId,
      entityLabel: canOpen ? (labels.get(feed.entityId) ?? null) : null,
      groupId: feed.groupId,
      groupName,
      createdAt: feed.createdAt.toISOString(),
    };
  });
}
