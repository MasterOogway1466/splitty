import { desc, eq } from "drizzle-orm";
import type { UpdateSettlementRequest } from "@splitty/shared";
import { writeActivity } from "../activity/write.js";
import type { Database, Executor } from "../db/client.js";
import { lockGroup, lockKey } from "../db/locks.js";
import { settlementEditHistory, settlements, users } from "../db/schema.js";
import { SettlementNotFoundError, VersionConflictError, WrongStateError } from "../groups/errors.js";
import type { GroupService } from "../groups/service.js";
import { requireMayAffect } from "./lifecycle.js";
import { requireSettleable, settlementPairKey } from "./relationships.js";
import { snapshotSettlement, type SettlementDiff } from "./settlements.js";

type SettlementRow = typeof settlements.$inferSelect;

/** A group settlement is open to its current members, a direct one to its
 * two parties. Deleted ones stay readable, so they can be restored. */
export async function requireSettlementAccess(
  db: Executor,
  groupService: GroupService,
  settlementId: string,
  userId: string,
): Promise<SettlementRow> {
  const [row] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
  if (!row) throw new SettlementNotFoundError();
  const allowed =
    row.groupId !== null ? await groupService.isMember(row.groupId, userId, db) : row.fromUserId === userId || row.toUserId === userId;
  if (!allowed) throw new SettlementNotFoundError();
  return row;
}

/** Locks and authorizes, applies `changes`, then records history and
 * activity. `deltaMinor` is how much more the payer will have paid. */
async function mutateSettlement(
  db: Database,
  groupService: GroupService,
  input: { settlementId: string; userId: string; version: number; kind: "update" | "delete" | "restore" },
  plan: (row: SettlementRow) => { changes: Partial<SettlementRow>; deltaMinor: number },
): Promise<SettlementRow> {
  const { settlementId, userId, kind } = input;
  return db.transaction(async (tx) => {
    // Group (or pair) before settlement, the same order every write uses.
    const seen = await requireSettlementAccess(tx, groupService, settlementId, userId);
    if (seen.groupId !== null) await lockGroup(tx, seen.groupId);
    else await lockKey(tx, settlementPairKey(seen.fromUserId, seen.toUserId));
    await tx.select({ id: settlements.id }).from(settlements).where(eq(settlements.id, settlementId)).for("update");
    const row = await requireSettlementAccess(tx, groupService, settlementId, userId);

    if (row.version !== input.version) throw new VersionConflictError({ settlement: row });
    if (kind === "restore" ? row.deletedAt === null : row.deletedAt !== null) {
      throw new WrongStateError(kind === "restore" ? "This payment isn't deleted" : "This payment is deleted");
    }

    const { changes, deltaMinor } = plan(row);
    if (row.groupId !== null) {
      if (deltaMinor !== 0) await requireMayAffect(tx, groupService, row.groupId, userId, [row.fromUserId, row.toUserId]);
    } else if (deltaMinor > 0) {
      // Paying less only undoes what one of the two recorded.
      await requireSettleable(tx, userId, { ...row, amountMinor: deltaMinor });
    }

    const [updated] = await tx
      .update(settlements)
      .set({ ...changes, version: row.version + 1, updatedAt: new Date() })
      .where(eq(settlements.id, settlementId))
      .returning();
    await tx.insert(settlementEditHistory).values({
      settlementId,
      editedBy: userId,
      changeType: kind,
      diff: { before: snapshotSettlement(row), after: snapshotSettlement(updated!) } satisfies SettlementDiff,
    });
    await writeActivity(tx, {
      actorId: userId,
      type: kind === "update" ? "settlement_updated" : kind === "delete" ? "settlement_deleted" : "settlement_restored",
      entityType: "settlement",
      entityId: settlementId,
      groupId: row.groupId,
      involved: [row.fromUserId, row.toUserId],
    });
    return updated!;
  });
}

/** The parties and currency are fixed; a payment recorded against the wrong
 * person is deleted and recorded again. */
export async function updateSettlement(
  db: Database,
  groupService: GroupService,
  input: { settlementId: string; userId: string; body: UpdateSettlementRequest },
): Promise<SettlementRow> {
  const { body } = input;
  return mutateSettlement(db, groupService, { ...input, version: body.version, kind: "update" }, (row) => ({
    changes: {
      amountMinor: body.amountMinor,
      baseAmountMinor: body.amountMinor,
      method: body.method,
      note: body.note ?? null,
      settledAt: body.settledAt,
    },
    deltaMinor: body.amountMinor - row.amountMinor,
  }));
}

export async function setSettlementDeleted(
  db: Database,
  groupService: GroupService,
  input: { settlementId: string; userId: string; version: number; deleted: boolean },
): Promise<SettlementRow> {
  const { deleted } = input;
  return mutateSettlement(db, groupService, { ...input, kind: deleted ? "delete" : "restore" }, (row) => ({
    changes: { deletedAt: deleted ? new Date() : null },
    deltaMinor: deleted ? -row.amountMinor : row.amountMinor,
  }));
}

/** Newest first. */
export async function readSettlementHistory(db: Executor, settlementId: string) {
  const rows = await db
    .select({ entry: settlementEditHistory, editedByName: users.displayName })
    .from(settlementEditHistory)
    .innerJoin(users, eq(users.id, settlementEditHistory.editedBy))
    .where(eq(settlementEditHistory.settlementId, settlementId))
    .orderBy(desc(settlementEditHistory.editedAt));
  return rows.map(({ entry, editedByName }) => ({ entry, editedByName, diff: (entry.diff ?? {}) as SettlementDiff }));
}
