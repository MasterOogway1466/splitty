import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CreateExpenseRequest, CreateSettlementRequest } from "@splitty/shared";
import type { Database, Executor } from "../db/client.js";
import { lockGroup, lockKey } from "../db/locks.js";
import { categories, expenses, settlements } from "../db/schema.js";
import { DomainError, IdConflictError, NotExpenseParticipantError, NotGroupMemberError } from "../groups/errors.js";
import type { GroupService } from "../groups/service.js";
import { createExpense, participantUserIdsOf } from "./expenses.js";
import { requireConnected, requireSettleable } from "./relationships.js";
import { createSettlement } from "./settlements.js";

interface Recorded<Row> {
  row: Row;
  created: boolean;
}

type RecordedRow = { createdBy: string; requestHash: string | null };

function hashRequest(groupId: string | null, body: { id?: string | undefined }): string {
  const { id: _id, ...content } = body;
  return createHash("sha256").update(JSON.stringify({ groupId, ...content })).digest("hex");
}

/** docs/PLAN-PUBLIC.md §8: a client-supplied id is the idempotency key. The
 * same person resending the same request gets the original back; anything
 * else reusing the id is refused. Checked before any other rule, so a
 * retry still succeeds if, say, a participant has left since. */
async function recordOnce<Row extends RecordedRow>(
  db: Database,
  input: { id: string | undefined; userId: string; requestHash: string },
  find: (tx: Executor, id: string) => Promise<Row | undefined>,
  create: (tx: Executor) => Promise<{ id: string }>,
): Promise<Recorded<Row>> {
  return db.transaction(async (tx) => {
    if (input.id) {
      await lockKey(tx, `ledger-id:${input.id}`);
      const existing = await find(tx, input.id);
      if (existing) {
        if (existing.createdBy !== input.userId || existing.requestHash !== input.requestHash) throw new IdConflictError();
        return { row: existing, created: false };
      }
    }
    const { id } = await create(tx);
    const row = await find(tx, id);
    if (!row) throw new Error("Recorded row missing");
    return { row, created: true };
  });
}

async function findExpense(tx: Executor, id: string) {
  return (await tx.select().from(expenses).where(eq(expenses.id, id)))[0];
}

async function findSettlement(tx: Executor, id: string) {
  return (await tx.select().from(settlements).where(eq(settlements.id, id)))[0];
}

async function requireMembers(tx: Executor, groupService: GroupService, groupId: string, userIds: string[]): Promise<void> {
  for (const userId of new Set(userIds)) {
    if (!(await groupService.isMember(groupId, userId, tx))) throw new NotGroupMemberError();
  }
}

/** `groupId: null` records a direct expense. */
export async function recordExpense(
  db: Database,
  groupService: GroupService,
  input: { groupId: string | null; userId: string; body: CreateExpenseRequest },
): Promise<Recorded<typeof expenses.$inferSelect>> {
  const { groupId, userId, body } = input;
  const requestHash = hashRequest(groupId, body);

  return recordOnce(db, { id: body.id, userId, requestHash }, findExpense, async (tx) => {
    const involved = [...body.payers.map((p) => p.userId), ...participantUserIdsOf(body)];
    if (groupId !== null) {
      await lockGroup(tx, groupId);
      await groupService.requireGroupCurrency(groupId, body.currency, tx);
      // Every payer and participant must be a current member — the
      // isolation boundary applies to who an expense can involve, not
      // just who can create one.
      await requireMembers(tx, groupService, groupId, [userId, ...involved]);
    } else {
      // No group membership to lean on here — the requester has to be one
      // of the people actually involved in the expense they're recording.
      if (!involved.includes(userId)) throw new NotExpenseParticipantError();
      await requireConnected(tx, userId, involved);
    }
    if (body.categoryId) {
      const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, body.categoryId));
      if (!category) throw new DomainError("Unknown category", "unknown_category");
    }
    return createExpense(tx, {
      id: body.id,
      requestHash,
      groupId,
      description: body.description,
      notes: body.notes ?? null,
      amountMinor: body.amountMinor,
      currency: body.currency,
      categoryId: body.categoryId ?? null,
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      payers: body.payers,
      split: body,
      createdBy: userId,
    });
  });
}

/** `groupId: null` records a direct settlement. */
export async function recordSettlement(
  db: Database,
  groupService: GroupService,
  input: { groupId: string | null; userId: string; body: CreateSettlementRequest },
): Promise<Recorded<typeof settlements.$inferSelect>> {
  const { groupId, userId, body } = input;
  const requestHash = hashRequest(groupId, body);

  return recordOnce(db, { id: body.id, userId, requestHash }, findSettlement, async (tx) => {
    const parties = [body.fromUserId, body.toUserId];
    if (groupId !== null) {
      await lockGroup(tx, groupId);
      await groupService.requireGroupCurrency(groupId, body.currency, tx);
      await requireMembers(tx, groupService, groupId, [userId, ...parties]);
    } else {
      if (!parties.includes(userId)) throw new NotExpenseParticipantError();
      // The outstanding debt read below must not be paid down twice.
      await lockKey(tx, `settle:${[...parties].sort().join(":")}`);
      await requireSettleable(tx, userId, body);
    }
    return createSettlement(tx, {
      id: body.id,
      requestHash,
      groupId,
      fromUserId: body.fromUserId,
      toUserId: body.toUserId,
      amountMinor: body.amountMinor,
      currency: body.currency,
      method: body.method,
      note: body.note ?? null,
      settledAt: body.settledAt ? new Date(body.settledAt) : new Date(),
      createdBy: userId,
    });
  });
}
