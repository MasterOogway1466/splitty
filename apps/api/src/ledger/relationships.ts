import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { expenseParticipants, expensePayers, expenses, friendLinks, groupMembers, groups } from "../db/schema.js";
import { NotConnectedError } from "../groups/errors.js";
import { computePairwiseBalances } from "./balances.js";

/** docs/PLAN-PUBLIC.md §5: a direct entry may only name people the
 * requester shares an active group with, is linked to, or has already
 * split with. An unknown id gets the same response as a stranger's. */
export async function requireConnected(db: Executor, userId: string, otherUserIds: Iterable<string>): Promise<void> {
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
  if (settle(await pastSplitIds(db, userId))) return;
  throw new NotConnectedError();
}

/** Lock key for writes that depend on what is outstanding between two people. */
export function settlementPairKey(a: string, b: string): string {
  return `settle:${[a, b].sort().join(":")}`;
}

export async function isConnected(db: Executor, userId: string, otherUserId: string): Promise<boolean> {
  try {
    await requireConnected(db, userId, [otherUserId]);
    return true;
  } catch (err) {
    if (err instanceof NotConnectedError) return false;
    throw err;
  }
}

/** Direct settlements additionally allow paying down an outstanding debt —
 * never past zero — with someone the requester isn't otherwise connected
 * to, since a mutual contact may have recorded that debt. */
export async function requireSettleable(
  db: Executor,
  userId: string,
  input: { fromUserId: string; toUserId: string; amountMinor: number; currency: string },
): Promise<void> {
  const other = input.fromUserId === userId ? input.toUserId : input.fromUserId;
  if (await isConnected(db, userId, other)) return;
  const owedToPayee = (await computePairwiseBalances(db, input.toUserId, input.fromUserId)).get(input.currency) ?? 0;
  if (input.amountMinor > owedToPayee) throw new NotConnectedError();
}

/** People the user has split with: in a group, or in a direct expense one
 * of the two recorded. A direct expense recorded by a third person is
 * excluded — it must not connect strangers to each other. */
async function pastSplitIds(db: Executor, userId: string): Promise<string[]> {
  const involved = async (filter: SQL | undefined) => {
    const columns = { expenseId: expenses.id, groupId: expenses.groupId, createdBy: expenses.createdBy };
    const paid = await db
      .select({ ...columns, userId: expensePayers.userId })
      .from(expensePayers)
      .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
      .where(and(isNull(expenses.deletedAt), filter ?? eq(expensePayers.userId, userId)));
    const owed = await db
      .select({ ...columns, userId: expenseParticipants.userId })
      .from(expenseParticipants)
      .innerJoin(expenses, eq(expenses.id, expenseParticipants.expenseId))
      .where(and(isNull(expenses.deletedAt), filter ?? eq(expenseParticipants.userId, userId)));
    return [...paid, ...owed];
  };
  const mine = await involved(undefined);
  if (mine.length === 0) return [];
  const everyone = await involved(inArray(expenses.id, [...new Set(mine.map((r) => r.expenseId))]));
  return everyone
    .filter((r) => r.groupId !== null || r.createdBy === userId || r.createdBy === r.userId)
    .map((r) => r.userId);
}

/** Current co-members across every non-deleted group; includes `userId`
 * itself when they belong to any. */
export async function activeCoMemberIds(db: Executor, userId: string): Promise<string[]> {
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

/** Non-deleted groups both people currently belong to. */
export async function sharedGroups(db: Executor, userId: string, otherUserId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: groups.id, name: groups.name, userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(inArray(groupMembers.userId, [userId, otherUserId]), isNull(groupMembers.removedAt), isNull(groups.deletedAt)));
  const mine = new Set(rows.filter((r) => r.userId === userId).map((r) => r.id));
  return rows.filter((r) => r.userId === otherUserId && mine.has(r.id)).map(({ id, name }) => ({ id, name }));
}
