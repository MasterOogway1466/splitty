import { inArray } from "drizzle-orm";
import type { Expense, ExpenseHistoryEntry, ExpenseSnapshot, Settlement, SettlementHistoryEntry, ShareInput } from "@splitty/shared";
import type { Database } from "../db/client.js";
import type { readSettlementHistory } from "../ledger/settlementLifecycle.js";
import type { readHistory } from "../ledger/lifecycle.js";
import { expenseParticipants, expensePayers, expenses, settlements, users } from "../db/schema.js";

type ExpenseRow = typeof expenses.$inferSelect;
type SettlementRow = typeof settlements.$inferSelect;

async function displayNames(db: Database, userIds: Iterable<string>): Promise<(id: string) => string> {
  const ids = [...new Set(userIds)];
  const rows = ids.length ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
  const names = new Map(rows.map((u) => [u.id, u.displayName]));
  return (id) => names.get(id) ?? "Unknown";
}

function byExpense<Row extends { expenseId: string }>(rows: Row[]): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  for (const row of rows) result.set(row.expenseId, [...(result.get(row.expenseId) ?? []), row]);
  return result;
}

export async function serializeExpenses(db: Database, rows: ExpenseRow[]): Promise<Expense[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const payerRows = await db.select().from(expensePayers).where(inArray(expensePayers.expenseId, ids)).orderBy(expensePayers.userId);
  const participantRows = await db
    .select()
    .from(expenseParticipants)
    .where(inArray(expenseParticipants.expenseId, ids))
    .orderBy(expenseParticipants.userId);
  const nameOf = await displayNames(db, [...payerRows, ...participantRows].map((p) => p.userId));
  const payersOf = byExpense(payerRows);
  const participantsOf = byExpense(participantRows);

  return rows.map((row) => ({
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
    payers: (payersOf.get(row.id) ?? []).map((p) => ({ userId: p.userId, displayName: nameOf(p.userId), amountMinor: p.amountMinor })),
    participants: (participantsOf.get(row.id) ?? []).map((p) => ({
      userId: p.userId,
      displayName: nameOf(p.userId),
      owedAmountMinor: p.owedAmountMinor,
      shareInput: (p.shareInput ?? null) as ShareInput | null,
    })),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}

export async function serializeExpense(db: Database, row: ExpenseRow): Promise<Expense> {
  return (await serializeExpenses(db, [row]))[0]!;
}

export async function serializeSettlements(db: Database, rows: SettlementRow[]): Promise<Settlement[]> {
  const nameOf = await displayNames(db, rows.flatMap((r) => [r.fromUserId, r.toUserId]));
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    fromUserId: row.fromUserId,
    fromDisplayName: nameOf(row.fromUserId),
    toUserId: row.toUserId,
    toDisplayName: nameOf(row.toUserId),
    currency: row.currency,
    amountMinor: row.amountMinor,
    method: row.method,
    note: row.note,
    settledAt: row.settledAt,
    createdBy: row.createdBy,
    version: row.version,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
}

export async function serializeSettlement(db: Database, row: SettlementRow): Promise<Settlement> {
  return (await serializeSettlements(db, [row]))[0]!;
}

export async function serializeHistory(db: Database, entries: Awaited<ReturnType<typeof readHistory>>): Promise<ExpenseHistoryEntry[]> {
  const snapshots = entries.flatMap(({ diff }) => [diff.before, diff.after]).filter((s) => !!s);
  const nameOf = await displayNames(db, snapshots.flatMap((s) => [...s.payers, ...s.participants].map((p) => p.userId)));

  const named = (snapshot: (typeof snapshots)[number] | null | undefined): ExpenseSnapshot | null =>
    snapshot
      ? {
          ...snapshot,
          payers: snapshot.payers.map((p) => ({ ...p, displayName: nameOf(p.userId) })),
          participants: snapshot.participants.map((p) => ({
            ...p,
            shareInput: (p.shareInput ?? null) as ShareInput | null,
            displayName: nameOf(p.userId),
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

export function serializeSettlementHistory(entries: Awaited<ReturnType<typeof readSettlementHistory>>): SettlementHistoryEntry[] {
  return entries.map(({ entry, editedByName, diff }) => ({
    id: entry.id,
    changeType: entry.changeType,
    editedBy: entry.editedBy,
    editedByName,
    editedAt: entry.editedAt.toISOString(),
    before: diff.before ?? null,
    after: diff.after ?? null,
  }));
}
