import { and, eq, exists, isNotNull, isNull, or, sql, type AnyColumn } from "drizzle-orm";
import type { Expense, Page, Settlement } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { expenseParticipants, expensePayers, expenses, settlements } from "../db/schema.js";
import { newestFirst, toPage, type ListQuery } from "../routes/paging.js";
import { serializeExpenses, serializeSettlements } from "../routes/serializers.js";

const deletedIs = (column: AnyColumn, deleted: boolean) => (deleted ? isNotNull(column) : isNull(column));

/** A group's expenses, or a user's direct ones. The caller has already
 * checked membership for the former. */
export async function listExpenses(db: Database, scope: { groupId: string } | { directFor: string }, query: ListQuery): Promise<Page<Expense>> {
  const involves = (userId: string) =>
    or(
      exists(db.select({ one: sql`1` }).from(expensePayers).where(and(eq(expensePayers.expenseId, expenses.id), eq(expensePayers.userId, userId)))),
      exists(
        db
          .select({ one: sql`1` })
          .from(expenseParticipants)
          .where(and(eq(expenseParticipants.expenseId, expenses.id), eq(expenseParticipants.userId, userId))),
      ),
    );
  const paging = newestFirst(expenses.expenseDate, expenses.id, query);
  const rows = await db
    .select()
    .from(expenses)
    .where(
      and(
        "groupId" in scope ? eq(expenses.groupId, scope.groupId) : and(isNull(expenses.groupId), involves(scope.directFor)),
        query.with ? involves(query.with) : undefined,
        deletedIs(expenses.deletedAt, query.deleted),
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  const page = toPage(rows, query, (r) => `${r.expenseDate}_${r.id}`);
  return { items: await serializeExpenses(db, page.rows), nextCursor: page.nextCursor };
}

/** A group's settlements, or a user's direct ones. */
export async function listSettlements(db: Database, scope: { groupId: string } | { directFor: string }, query: ListQuery): Promise<Page<Settlement>> {
  const involves = (userId: string) => or(eq(settlements.fromUserId, userId), eq(settlements.toUserId, userId));
  const paging = newestFirst(settlements.settledAt, settlements.id, query);
  const rows = await db
    .select()
    .from(settlements)
    .where(
      and(
        "groupId" in scope ? eq(settlements.groupId, scope.groupId) : and(isNull(settlements.groupId), involves(scope.directFor)),
        query.with ? involves(query.with) : undefined,
        deletedIs(settlements.deletedAt, query.deleted),
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  const page = toPage(rows, query, (r) => `${r.settledAt}_${r.id}`);
  return { items: await serializeSettlements(db, page.rows), nextCursor: page.nextCursor };
}
