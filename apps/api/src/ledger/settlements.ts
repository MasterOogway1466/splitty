import { uuidv7 } from "uuidv7";
import type { SettlementSnapshot } from "@splitty/shared";
import { writeActivity } from "../activity/write.js";
import type { Executor } from "../db/client.js";
import { settlementEditHistory, settlements } from "../db/schema.js";

/** What settlement_edit_history.diff holds: complete versions of what can
 * change (docs/PLAN-PUBLIC.md §8). */
export interface SettlementDiff {
  before?: SettlementSnapshot | null;
  after?: SettlementSnapshot | null;
}

export function snapshotSettlement(row: typeof settlements.$inferSelect): SettlementSnapshot {
  return { amountMinor: row.amountMinor, method: row.method, note: row.note, settledAt: row.settledAt };
}

export interface CreateSettlementInput {
  id?: string | undefined;
  requestHash?: string | undefined;
  groupId: string | null;
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
  currency: string;
  method: "cash" | "bank_transfer" | "upi" | "other";
  note: string | null;
  settledAt: string;
  createdBy: string;
}

export async function createSettlement(db: Executor, input: CreateSettlementInput): Promise<{ id: string }> {
  const id = input.id ?? uuidv7();

  await db.transaction(async (tx) => {
    const [row] = await tx.insert(settlements).values({
      id,
      groupId: input.groupId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      currency: input.currency,
      amountMinor: input.amountMinor,
      baseCurrency: input.currency,
      baseAmountMinor: input.amountMinor,
      fxRate: "1",
      method: input.method,
      note: input.note,
      settledAt: input.settledAt,
      createdBy: input.createdBy,
      requestHash: input.requestHash ?? null,
      version: 1,
    }).returning();

    await tx.insert(settlementEditHistory).values({
      settlementId: id,
      editedBy: input.createdBy,
      changeType: "create",
      diff: { before: null, after: snapshotSettlement(row!) } satisfies SettlementDiff,
    });

    await writeActivity(tx, {
      actorId: input.createdBy,
      type: "settlement_created",
      entityType: "settlement",
      entityId: id,
      groupId: input.groupId,
      involved: [input.fromUserId, input.toUserId],
    });
  });

  return { id };
}
