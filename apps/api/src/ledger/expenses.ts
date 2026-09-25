import { uuidv7 } from "uuidv7";
import { splitByLargestRemainder } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { activityFeed, expenseEditHistory, expenseParticipants, expensePayers, expenses, friendLinks } from "../db/schema.js";

export interface CreateExpenseInput {
  groupId: string | null;
  description: string;
  notes: string | null;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  expenseDate: Date;
  paidBy: string;
  participantUserIds: string[];
  createdBy: string;
}

/** docs/PLAN-PUBLIC.md §8: `id` is client-generated UUIDv7 — generated
 * here (server-side) for now since Phase 1 has no offline-capable client
 * yet (that's Phase 5); when it exists, the client generates this
 * instead and the rest of this shape is unchanged. */
export async function createExpense(db: Database, input: CreateExpenseInput): Promise<{ id: string }> {
  const id = uuidv7();
  const now = new Date();

  // Phase 1 has no real FX conversion yet (§10 is Phase 3) — base
  // currency/amount are the identity mapping, fx_rate=1 (§2's placeholder).
  const shares = splitByLargestRemainder(
    input.amountMinor,
    input.participantUserIds.map((userId) => ({ id: userId, weight: 1 })),
  );

  await db.transaction(async (tx) => {
    await tx.insert(expenses).values({
      id,
      groupId: input.groupId,
      description: input.description,
      notes: input.notes,
      categoryId: input.categoryId,
      currency: input.currency,
      amountMinor: input.amountMinor,
      baseCurrency: input.currency,
      baseAmountMinor: input.amountMinor,
      fxRate: "1",
      fxRateFetchedAt: now,
      expenseDate: input.expenseDate,
      splitMethod: "equal",
      createdBy: input.createdBy,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(expensePayers).values({ expenseId: id, userId: input.paidBy, amountMinor: input.amountMinor });

    await tx.insert(expenseParticipants).values(
      input.participantUserIds.map((userId) => ({
        expenseId: id,
        userId,
        owedAmountMinor: shares.get(userId) ?? 0,
        shareInput: { type: "equal" },
      })),
    );

    await tx.insert(expenseEditHistory).values({
      expenseId: id,
      editedBy: input.createdBy,
      changeType: "create",
      diff: { description: input.description, amountMinor: input.amountMinor, currency: input.currency },
    });

    // Every payer/participant gets their own activity-feed row so it
    // shows up in their own feed (§6: per-recipient, not a shared row).
    const recipientIds = new Set([input.paidBy, ...input.participantUserIds]);
    await tx.insert(activityFeed).values(
      [...recipientIds].map((recipientId) => ({
        recipientId,
        actorId: input.createdBy,
        type: "expense_created" as const,
        entityType: "expense",
        entityId: id,
        groupId: input.groupId,
      })),
    );

    if (input.groupId === null) {
      // §6: friend_links created implicitly on the first direct
      // expense/IOU between two users — one link per (payer, participant)
      // pair; canonical ordering enforced here since the DB doesn't.
      for (const participantId of input.participantUserIds) {
        if (participantId === input.paidBy) continue;
        const [a, b] = [input.paidBy, participantId].sort();
        await tx
          .insert(friendLinks)
          .values({ userAId: a!, userBId: b! })
          .onConflictDoNothing();
      }
    }
  });

  return { id };
}
