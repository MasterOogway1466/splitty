import { uuidv7 } from "uuidv7";
import { splitByLargestRemainder, sumMinor, type ExpenseSplit } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { activityFeed, expenseEditHistory, expenseParticipants, expensePayers, expenses, friendLinks } from "../db/schema.js";
import { InvalidSplitError } from "../groups/errors.js";

export interface CreateExpenseInput {
  groupId: string | null;
  description: string;
  notes: string | null;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  expenseDate: Date;
  payers: { userId: string; amountMinor: number }[];
  split: ExpenseSplit;
  createdBy: string;
}

/** Every userId who participates in the split, regardless of method —
 * used by route handlers to run the group-membership check uniformly
 * without needing to know the split's shape. */
export function participantUserIdsOf(split: ExpenseSplit): string[] {
  if (split.splitMethod === "equal") return split.participantUserIds;
  return split.participants.map((p) => p.userId);
}

/** Computes each participant's owedAmountMinor and the shareInput to
 * record for it, dispatched by split method. `shareInput` records what
 * was actually entered (not just the computed amount) so a future
 * edit/display UI can show "Bob: 30%" instead of just a dollar figure.
 * Throws InvalidSplitError if the method's own constraint isn't met. */
export function computeParticipantShares(
  amountMinor: number,
  split: ExpenseSplit,
): { userId: string; owedAmountMinor: number; shareInput: Record<string, unknown> | null }[] {
  const ids = participantUserIdsOf(split);
  if (new Set(ids).size !== ids.length) {
    throw new InvalidSplitError("participants must not contain duplicates");
  }

  switch (split.splitMethod) {
    case "equal": {
      const shares = splitByLargestRemainder(amountMinor, ids.map((id) => ({ id, weight: 1 })));
      return ids.map((userId) => ({ userId, owedAmountMinor: shares.get(userId) ?? 0, shareInput: null }));
    }
    case "exact": {
      const sum = sumMinor(split.participants.map((p) => p.amountMinor));
      if (sum !== amountMinor) {
        throw new InvalidSplitError(`exact amounts sum to ${sum}, expected ${amountMinor}`);
      }
      return split.participants.map((p) => ({
        userId: p.userId,
        owedAmountMinor: p.amountMinor,
        shareInput: { type: "exact" as const, amountMinor: p.amountMinor },
      }));
    }
    case "percentage": {
      const hundredths = split.participants.map((p) => Math.round(p.percentage * 100));
      const sum = hundredths.reduce((a, b) => a + b, 0);
      if (sum !== 10000) {
        throw new InvalidSplitError(`percentages sum to ${sum / 100}, expected 100`);
      }
      const shares = splitByLargestRemainder(amountMinor, split.participants.map((p) => ({ id: p.userId, weight: p.percentage })));
      return split.participants.map((p) => ({
        userId: p.userId,
        owedAmountMinor: shares.get(p.userId) ?? 0,
        shareInput: { type: "percentage" as const, percentage: p.percentage },
      }));
    }
    case "shares": {
      const shares = splitByLargestRemainder(amountMinor, split.participants.map((p) => ({ id: p.userId, weight: p.shares })));
      return split.participants.map((p) => ({
        userId: p.userId,
        owedAmountMinor: shares.get(p.userId) ?? 0,
        shareInput: { type: "shares" as const, shares: p.shares },
      }));
    }
    case "adjustment": {
      const adjustmentTotal = sumMinor(split.participants.map((p) => p.adjustmentMinor));
      const remainder = amountMinor - adjustmentTotal;
      if (remainder < 0) {
        throw new InvalidSplitError("adjustments exceed the total amount");
      }
      const baseShares = splitByLargestRemainder(remainder, ids.map((id) => ({ id, weight: 1 })));
      return split.participants.map((p) => ({
        userId: p.userId,
        owedAmountMinor: (baseShares.get(p.userId) ?? 0) + p.adjustmentMinor,
        shareInput: { type: "adjustment" as const, adjustmentMinor: p.adjustmentMinor },
      }));
    }
  }
}

/** docs/PLAN-PUBLIC.md §8: `id` is client-generated UUIDv7 — generated
 * here (server-side) for now since Phase 1 has no offline-capable client
 * yet (that's Phase 5); when it exists, the client generates this
 * instead and the rest of this shape is unchanged. */
export async function createExpense(db: Database, input: CreateExpenseInput): Promise<{ id: string }> {
  const id = uuidv7();
  const now = new Date();

  const payersTotal = sumMinor(input.payers.map((p) => p.amountMinor));
  if (payersTotal !== input.amountMinor) {
    throw new InvalidSplitError(`payer amounts sum to ${payersTotal}, expected ${input.amountMinor}`);
  }
  const payerIds = input.payers.map((p) => p.userId);
  if (new Set(payerIds).size !== payerIds.length) {
    throw new InvalidSplitError("payers must not contain duplicates");
  }

  const participantShares = computeParticipantShares(input.amountMinor, input.split);
  const participantsTotal = sumMinor(participantShares.map((p) => p.owedAmountMinor));
  if (participantsTotal !== input.amountMinor) {
    // Should be unreachable if computeParticipantShares is correct for
    // every method — kept as a hard invariant check rather than
    // trusted silently, since a mismatch here would corrupt every
    // balance downstream.
    throw new Error(`participant shares sum to ${participantsTotal}, expected ${input.amountMinor}`);
  }

  // Phase 1 has no real FX conversion yet (§10 is Phase 3) — base
  // currency/amount are the identity mapping, fx_rate=1 (§2's placeholder).
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
      splitMethod: input.split.splitMethod,
      createdBy: input.createdBy,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(expensePayers).values(input.payers.map((p) => ({ expenseId: id, userId: p.userId, amountMinor: p.amountMinor })));

    await tx.insert(expenseParticipants).values(
      participantShares.map((p) => ({
        expenseId: id,
        userId: p.userId,
        owedAmountMinor: p.owedAmountMinor,
        shareInput: p.shareInput,
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
    const recipientIds = new Set([...payerIds, ...participantShares.map((p) => p.userId)]);
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
      // expense/IOU between two users — one link per (payer,
      // participant) pair, generalized from the single-payer version
      // to loop over every payer now that there can be more than one.
      const participantIds = participantShares.map((p) => p.userId);
      for (const payerId of payerIds) {
        for (const participantId of participantIds) {
          if (participantId === payerId) continue;
          const [a, b] = [payerId, participantId].sort();
          await tx.insert(friendLinks).values({ userAId: a!, userBId: b! }).onConflictDoNothing();
        }
      }
    }
  });

  return { id };
}
