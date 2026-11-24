import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { friendLinks, groupMembers, groups } from "../db/schema.js";
import { NotConnectedError } from "../groups/errors.js";
import { computeAllPairwiseBalances } from "./balances.js";

/** docs/PLAN-PUBLIC.md §5: a direct entry may only name people the
 * requester shares an active group with, is linked to, or has already
 * split with. An unknown id gets the same response as a stranger's. */
export async function requireConnected(db: Database, userId: string, otherUserIds: Iterable<string>): Promise<void> {
  const remaining = new Set(otherUserIds);
  remaining.delete(userId);
  const settle = (ids: Iterable<string>) => {
    for (const id of ids) remaining.delete(id);
    return remaining.size === 0;
  };
  if (settle([])) return;

  const links = await db
    .select()
    .from(friendLinks)
    .where(or(eq(friendLinks.userAId, userId), eq(friendLinks.userBId, userId)));
  if (settle(links.map((l) => (l.userAId === userId ? l.userBId : l.userAId)))) return;

  if (settle(await activeCoMemberIds(db, userId))) return;
  if (settle((await computeAllPairwiseBalances(db, userId)).keys())) return;
  throw new NotConnectedError();
}

/** Current co-members across every non-deleted group; includes `userId`
 * itself when they belong to any. */
export async function activeCoMemberIds(db: Database, userId: string): Promise<string[]> {
  const myGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), isNull(groupMembers.removedAt), isNull(groups.deletedAt)));
  if (myGroups.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(inArray(groupMembers.groupId, myGroups.map((g) => g.groupId)), isNull(groupMembers.removedAt)));
  return rows.map((r) => r.userId);
}
