import { and, eq, inArray, isNull } from "drizzle-orm";
import { formatMoney, type ActivityItem, type Page } from "@splitty/shared";
import { cursorTimestamp, newestFirst, toPage, type ListQuery } from "../routes/paging.js";
import type { Executor } from "../db/client.js";
import { activityFeed, expenseParticipants, expensePayers, expenses, groupMembers, groups, settlements, users } from "../db/schema.js";

/** A user's own feed, newest first, optionally for one group. An entry is
 * named only while the reader can still open it: the row itself outlives
 * their access, and the current description may be newer than it. */
export async function readActivity(db: Executor, userId: string, query: ListQuery, groupId?: string): Promise<Page<ActivityItem>> {
  const paging = newestFirst(activityFeed.createdAt, activityFeed.id, query);
  const found = await db
    .select({ feed: activityFeed, cursorAt: cursorTimestamp(activityFeed.createdAt), actorName: users.displayName, groupName: groups.name, groupDeletedAt: groups.deletedAt, myRole: groupMembers.role })
    .from(activityFeed)
    .innerJoin(users, eq(users.id, activityFeed.actorId))
    .leftJoin(groups, eq(groups.id, activityFeed.groupId))
    .leftJoin(
      groupMembers,
      and(eq(groupMembers.groupId, activityFeed.groupId), eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)),
    )
    .where(and(eq(activityFeed.recipientId, userId), groupId ? eq(activityFeed.groupId, groupId) : undefined, paging.where))
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  const { rows, nextCursor } = toPage(found, query, (r) => `${r.cursorAt}_${r.feed.id}`);

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

  const settlementIds = [...new Set(rows.filter((r) => r.feed.entityType === "settlement").map((r) => r.feed.entityId))];
  if (settlementIds.length > 0) {
    for (const s of await db.select().from(settlements).where(inArray(settlements.id, settlementIds))) {
      labels.set(s.id, formatMoney(s.amountMinor, s.currency));
      if (s.fromUserId === userId || s.toUserId === userId) partyTo.add(s.id);
    }
  }

  const memberIds = [...new Set(rows.filter((r) => r.feed.entityType === "member").map((r) => r.feed.entityId))];
  if (memberIds.length > 0) {
    for (const u of await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, memberIds))) {
      labels.set(u.id, u.displayName);
    }
  }
  for (const r of rows) if (r.feed.entityType === "group" && r.groupName !== null) labels.set(r.feed.entityId, r.groupName);

  const items = rows.map(({ feed, actorName, groupName, groupDeletedAt, myRole }) => {
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
      // The current name, so only for current members.
      groupName: myRole === null ? null : groupName,
      createdAt: feed.createdAt.toISOString(),
    };
  });
  return { items, nextCursor };
}
