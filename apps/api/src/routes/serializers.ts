import { eq, inArray } from "drizzle-orm";
import type { Expense, Settlement } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { expenseParticipants, expensePayers, expenses, settlements, users } from "../db/schema.js";

type ExpenseRow = typeof expenses.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;

export async function serializeExpense(db: Database, row: ExpenseRow): Promise<Expense> {
  const payerRows = await db.select().from(expensePayers).where(eq(expensePayers.expenseId, row.id));
  const participantRows = await db.select().from(expenseParticipants).where(eq(expenseParticipants.expenseId, row.id));

  const userIds = [...new Set([...payerRows.map((p) => p.userId), ...participantRows.map((p) => p.userId)])];
  const userRows = userIds.length
    ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, userIds))
    : [];
  const nameMap = new Map(userRows.map((u) => [u.id, u.displayName]));

  return {
    id: row.id,
    groupId: row.groupId,
    description: row.description,
    notes: row.notes,
    categoryId: row.categoryId,
    currency: row.currency,
    amountMinor: row.amountMinor,
    splitMethod: row.splitMethod,
    expenseDate: row.expenseDate.toISOString(),
    createdBy: row.createdBy,
    payers: payerRows.map((p) => ({ userId: p.userId, displayName: nameMap.get(p.userId) ?? "Unknown", amountMinor: p.amountMinor })),
    participants: participantRows.map((p) => ({
      userId: p.userId,
      displayName: nameMap.get(p.userId) ?? "Unknown",
      owedAmountMinor: p.owedAmountMinor,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    groupId: row.groupId,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    currency: row.currency,
    amountMinor: row.amountMinor,
    method: row.method,
    note: row.note,
    settledAt: row.settledAt.toISOString(),
    createdBy: row.createdBy,
  };
}
