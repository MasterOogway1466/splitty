import { asc, inArray } from "drizzle-orm";
import { splitByLargestRemainder, type ExpenseSplit, type Itemization } from "@splitty/shared";
import type { Executor } from "../db/client.js";
import { expenseLineItemAssignments, expenseLineItems, type expenses } from "../db/schema.js";
import { groupBy } from "../groupBy.js";
import { InvalidSplitError } from "../groups/errors.js";

type ExpenseRow = typeof expenses.$inferSelect;
type ItemizedSplit = Extract<ExpenseSplit, { splitMethod: "itemized" }>;

/** Each item is divided by its own shares; tax and tip then follow what
 * everyone's items came to. Every step is a largest-remainder split, so the
 * parts always add back up exactly. */
export function splitItems(amountMinor: number, split: ItemizedSplit): { userId: string; owedAmountMinor: number; subtotalMinor: number }[] {
  const itemsTotal = split.items.reduce((sum, item) => sum + item.amountMinor, 0);
  const total = itemsTotal + split.taxMinor + split.tipMinor;
  if (total !== amountMinor) {
    throw new InvalidSplitError(`items, tax and tip sum to ${total}, expected ${amountMinor}`);
  }

  const subtotals = new Map<string, number>();
  for (const item of split.items) {
    if (new Set(item.assignments.map((a) => a.userId)).size !== item.assignments.length) {
      throw new InvalidSplitError("an item cannot be assigned to the same person twice");
    }
    const parts = splitByLargestRemainder(
      item.amountMinor,
      item.assignments.map((a) => ({ id: a.userId, weight: Math.round(a.shares * 100) })),
    );
    for (const [userId, part] of parts) subtotals.set(userId, (subtotals.get(userId) ?? 0) + part);
  }

  const weights = [...subtotals].map(([id, weight]) => ({ id, weight }));
  const tax = splitByLargestRemainder(split.taxMinor, weights);
  const tip = splitByLargestRemainder(split.tipMinor, weights);
  return weights.map(({ id, weight }) => ({ userId: id, owedAmountMinor: weight + tax.get(id)! + tip.get(id)!, subtotalMinor: weight }));
}

export async function writeItems(tx: Executor, expenseId: string, split: ExpenseSplit): Promise<void> {
  if (split.splitMethod !== "itemized") return;
  const rows = await tx
    .insert(expenseLineItems)
    .values(split.items.map(({ description, amountMinor }, position) => ({ expenseId, description, amountMinor, position })))
    .returning({ id: expenseLineItems.id, position: expenseLineItems.position });
  const idAt = new Map(rows.map((r) => [r.position, r.id]));
  await tx.insert(expenseLineItemAssignments).values(
    split.items.flatMap((item, position) =>
      item.assignments.map((a) => ({ lineItemId: idAt.get(position)!, userId: a.userId, share: String(a.shares) })),
    ),
  );
}

export async function deleteItems(tx: Executor, expenseId: string): Promise<void> {
  const rows = await tx.select({ id: expenseLineItems.id }).from(expenseLineItems).where(inArray(expenseLineItems.expenseId, [expenseId]));
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  await tx.delete(expenseLineItemAssignments).where(inArray(expenseLineItemAssignments.lineItemId, ids));
  await tx.delete(expenseLineItems).where(inArray(expenseLineItems.id, ids));
}

export async function readItemizations(db: Executor, rows: ExpenseRow[]): Promise<Map<string, Itemization>> {
  const itemized = rows.filter((r) => r.splitMethod === "itemized");
  if (itemized.length === 0) return new Map();
  const items = await db
    .select()
    .from(expenseLineItems)
    .where(inArray(expenseLineItems.expenseId, itemized.map((r) => r.id)))
    .orderBy(asc(expenseLineItems.position));
  const assignments = items.length
    ? await db
        .select()
        .from(expenseLineItemAssignments)
        .where(inArray(expenseLineItemAssignments.lineItemId, items.map((i) => i.id)))
        .orderBy(asc(expenseLineItemAssignments.userId))
    : [];
  const itemsOf = groupBy(items, (i) => i.expenseId);
  const assignmentsOf = groupBy(assignments, (a) => a.lineItemId);
  return new Map(
    itemized.map((row) => [
      row.id,
      {
        items: (itemsOf.get(row.id) ?? []).map((i) => ({
          description: i.description,
          amountMinor: i.amountMinor,
          assignments: (assignmentsOf.get(i.id) ?? []).map((a) => ({ userId: a.userId, shares: Number(a.share) })),
        })),
        taxMinor: row.taxMinor,
        tipMinor: row.tipMinor,
      },
    ]),
  );
}
