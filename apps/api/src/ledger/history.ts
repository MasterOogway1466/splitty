import type { ExpenseSnapshot } from "@splitty/shared";
import { eq } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { expenseParticipants, expensePayers, expenses } from "../db/schema.js";

type ExpenseRow = typeof expenses.$inferSelect;
type StoredSnapshot = Omit<ExpenseSnapshot, "payers" | "participants"> & {
  payers: { userId: string; amountMinor: number }[];
  participants: { userId: string; owedAmountMinor: number; shareInput: unknown }[];
};

/** What expense_edit_history.diff holds: complete versions, not deltas, so
 * any version can be read back on its own (docs/PLAN-PUBLIC.md §8). Rows
 * written before this shape existed have neither key. */
export interface HistoryDiff {
  before?: StoredSnapshot | null;
  after?: StoredSnapshot | null;
}

export async function snapshotExpense(tx: Executor, row: ExpenseRow): Promise<StoredSnapshot> {
  const payers = await tx.select().from(expensePayers).where(eq(expensePayers.expenseId, row.id)).orderBy(expensePayers.userId);
  const participants = await tx
    .select()
    .from(expenseParticipants)
    .where(eq(expenseParticipants.expenseId, row.id))
    .orderBy(expenseParticipants.userId);
  return {
    description: row.description,
    notes: row.notes,
    categoryId: row.categoryId,
    currency: row.currency,
    amountMinor: row.amountMinor,
    splitMethod: row.splitMethod,
    expenseDate: row.expenseDate,
    payers: payers.map((p) => ({ userId: p.userId, amountMinor: p.amountMinor })),
    participants: participants.map((p) => ({ userId: p.userId, owedAmountMinor: p.owedAmountMinor, shareInput: p.shareInput })),
  };
}

/** paid − owed per person. */
export function netsOf(snapshot: StoredSnapshot): Map<string, number> {
  const nets = new Map<string, number>();
  for (const p of snapshot.payers) nets.set(p.userId, (nets.get(p.userId) ?? 0) + p.amountMinor);
  for (const p of snapshot.participants) nets.set(p.userId, (nets.get(p.userId) ?? 0) - p.owedAmountMinor);
  return nets;
}
