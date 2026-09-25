import { uuidv7 } from "uuidv7";
import type { Database } from "../db/client.js";
import { activityFeed, settlements } from "../db/schema.js";

export interface CreateSettlementInput {
  groupId: string | null;
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
  currency: string;
  method: "cash" | "bank_transfer" | "upi" | "other";
  note: string | null;
  settledAt: Date;
  createdBy: string;
}

export async function createSettlement(db: Database, input: CreateSettlementInput): Promise<{ id: string }> {
  const id = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(settlements).values({
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
      version: 1,
    });

    await tx.insert(activityFeed).values(
      [input.fromUserId, input.toUserId].map((recipientId) => ({
        recipientId,
        actorId: input.createdBy,
        type: "settlement_created" as const,
        entityType: "settlement",
        entityId: id,
        groupId: input.groupId,
      })),
    );
  });

  return { id };
}
