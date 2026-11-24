import { eq, inArray } from "drizzle-orm";
import type { Expense, ExpenseHistoryEntry, ExpenseSnapshot, Settlement, ShareInput } from "@splitty/shared";
import type { Database } from "../db/client.js";
import type { readHistory } from "../ledger/lifecycle.js";
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
    expenseDate: row.expenseDate,
    createdBy: row.createdBy,
    payers: payerRows.map((p) => ({ userId: p.userId, displayName: nameMap.get(p.userId) ?? "Unknown", amountMinor: p.amountMinor })),
    participants: participantRows.map((p) => ({
      userId: p.userId,
      displayName: nameMap.get(p.userId) ?? "Unknown",
      owedAmountMinor: p.owedAmountMinor,
      shareInput: (p.shareInput ?? null) as ShareInput | null,
    })),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    deletedAt: row.deletedAt?.toISOString() ?? null,
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

export async function serializeHistory(db: Database, entries: Awaited<ReturnType<typeof readHistory>>): Promise<ExpenseHistoryEntry[]> {
  const snapshots = entries.flatMap(({ diff }) => [diff.before, diff.after]).filter((s) => !!s);
  const ids = [...new Set(snapshots.flatMap((s) => [...s.payers, ...s.participants].map((p) => p.userId)))];
  const userRows = ids.length ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
  const names = new Map(userRows.map((u) => [u.id, u.displayName]));

  const named = (snapshot: (typeof snapshots)[number] | null | undefined): ExpenseSnapshot | null =>
    snapshot
      ? {
          ...snapshot,
          payers: snapshot.payers.map((p) => ({ ...p, displayName: names.get(p.userId) ?? "Unknown" })),
          participants: snapshot.participants.map((p) => ({
            ...p,
            shareInput: (p.shareInput ?? null) as ShareInput | null,
            displayName: names.get(p.userId) ?? "Unknown",
          })),
        }
      : null;

  return entries.map(({ entry, editedByName, diff }) => ({
    id: entry.id,
    changeType: entry.changeType,
    editedBy: entry.editedBy,
    editedByName,
    editedAt: entry.editedAt.toISOString(),
    before: named(diff.before),
    after: named(diff.after),
  }));
}
