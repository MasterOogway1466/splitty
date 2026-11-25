import { desc, eq } from "drizzle-orm";
import { attributeDebts, type UpdateExpenseRequest } from "@splitty/shared";
import { writeActivity } from "../activity/write.js";
import type { Database, Executor } from "../db/client.js";
import { lockGroup } from "../db/locks.js";
import { expenseEditHistory, expenseParticipants, expensePayers, expenses, users } from "../db/schema.js";
import {
  AffectsFormerMemberError,
  ExpenseNotFoundError,
  NotExpenseParticipantError,
  NotGroupMemberError,
  VersionConflictError,
  WrongStateError,
} from "../groups/errors.js";
import type { GroupService } from "../groups/service.js";
import { resolveSplit } from "./expenses.js";
import { netsOf, snapshotExpense, type HistoryDiff } from "./history.js";
import { requireCategory } from "./record.js";
import { requireConnected } from "./relationships.js";

type ExpenseRow = typeof expenses.$inferSelect;
type Snapshot = Awaited<ReturnType<typeof snapshotExpense>>;

const involvedIn = (s: Snapshot) => new Set([...s.payers.map((p) => p.userId), ...s.participants.map((p) => p.userId)]);

/** A group expense is open to its current members, a direct one to the
 * people on it. Deleted expenses stay readable, so they can be restored. */
export async function requireExpenseAccess(db: Executor, groupService: GroupService, expenseId: string, userId: string): Promise<ExpenseRow> {
  const [row] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
  if (!row) throw new ExpenseNotFoundError();
  const allowed =
    row.groupId !== null
      ? await groupService.isMember(row.groupId, userId, db)
      : involvedIn(await snapshotExpense(db, row)).has(userId);
  if (!allowed) throw new ExpenseNotFoundError();
  return row;
}

/** The change must not move anyone who can't currently be part of it: in a
 * group, a former member (docs/PLAN-PUBLIC.md §7); on a direct expense,
 * someone the editor isn't connected to. */
export async function requireMayAffect(
  tx: Executor,
  groupService: GroupService,
  groupId: string | null,
  userId: string,
  affected: string[],
): Promise<void> {
  if (groupId === null) {
    await requireConnected(tx, userId, affected);
    return;
  }
  for (const id of affected) {
    if (!(await groupService.isMember(groupId, id, tx))) throw new AffectsFormerMemberError();
  }
}

/** Everyone who ends up owing, or owed by, anyone a different amount. Equal
 * totals aren't enough: a debtor's total can stay put while the people it
 * is owed to change. */
function peopleAffected(before: Map<string, number>, after: Map<string, number>, currencyChanged: boolean): string[] {
  const pairs = (nets: Map<string, number>) => new Map(attributeDebts(nets).map((d) => [`${d.fromId}:${d.toId}`, d.amountMinor]));
  const was = pairs(before);
  const now = pairs(after);
  const changed = [...new Set([...was.keys(), ...now.keys()])].filter((key) => currencyChanged || was.get(key) !== now.get(key));
  return [...new Set(changed.flatMap((key) => key.split(":")))];
}

/** Locks and authorizes, runs `change`, then records history and activity. */
async function mutateExpense(
  db: Database,
  groupService: GroupService,
  input: { expenseId: string; userId: string; version: number; kind: "update" | "delete" | "restore" },
  change: (tx: Executor, row: ExpenseRow, before: Snapshot) => Promise<void>,
): Promise<ExpenseRow> {
  const { expenseId, userId, kind } = input;
  return db.transaction(async (tx) => {
    // Group before expense, the same order every ledger write uses.
    const { groupId } = await requireExpenseAccess(tx, groupService, expenseId, userId);
    if (groupId !== null) await lockGroup(tx, groupId);
    await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.id, expenseId)).for("update");
    const row = await requireExpenseAccess(tx, groupService, expenseId, userId);

    if (row.version !== input.version) throw new VersionConflictError({ expense: row });
    if (kind === "restore" ? row.deletedAt === null : row.deletedAt !== null) {
      throw new WrongStateError(kind === "restore" ? "This expense isn't deleted" : "This expense is deleted");
    }

    const before = await snapshotExpense(tx, row);
    await change(tx, row, before);
    const [updated] = await tx
      .update(expenses)
      .set({ version: row.version + 1, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId))
      .returning();
    const after = await snapshotExpense(tx, updated!);

    await tx.insert(expenseEditHistory).values({
      expenseId,
      editedBy: userId,
      changeType: kind,
      diff: { before, after } satisfies HistoryDiff,
    });
    await writeActivity(tx, {
      actorId: userId,
      type: kind === "update" ? "expense_updated" : kind === "delete" ? "expense_deleted" : "expense_restored",
      entityType: "expense",
      entityId: expenseId,
      groupId,
      involved: [...involvedIn(before), ...involvedIn(after)],
    });
    return updated!;
  });
}

export async function updateExpense(
  db: Database,
  groupService: GroupService,
  input: { expenseId: string; userId: string; body: UpdateExpenseRequest },
): Promise<ExpenseRow> {
  const { expenseId, userId, body } = input;
  return mutateExpense(db, groupService, { expenseId, userId, version: body.version, kind: "update" }, async (tx, row, before) => {
    const { payers, participants } = resolveSplit({ amountMinor: body.amountMinor, payers: body.payers, split: body });
    await requireCategory(tx, body.categoryId);

    const wasInvolved = involvedIn(before);
    const nowInvolved = new Set([...payers, ...participants].map((p) => p.userId));
    if (row.groupId !== null) {
      await groupService.requireGroupCurrency(row.groupId, body.currency, tx);
      for (const id of nowInvolved) {
        if (!wasInvolved.has(id) && !(await groupService.isMember(row.groupId, id, tx))) throw new NotGroupMemberError();
      }
    } else if (!nowInvolved.has(userId)) {
      throw new NotExpenseParticipantError();
    }

    const oldNets = netsOf(before);
    const newNets = netsOf({ ...before, payers, participants });
    const affected = peopleAffected(oldNets, newNets, body.currency !== before.currency);
    const added = [...nowInvolved].filter((id) => !wasInvolved.has(id));
    await requireMayAffect(tx, groupService, row.groupId, userId, [...affected, ...added]);
    // Being on an expense the creator recorded counts as having split with
    // them (pastSplitIds), so an editor must not bring in their strangers.
    if (row.groupId === null) await requireConnected(tx, row.createdBy, added);

    await tx
      .update(expenses)
      .set({
        description: body.description,
        notes: body.notes ?? null,
        categoryId: body.categoryId ?? null,
        currency: body.currency,
        amountMinor: body.amountMinor,
        baseCurrency: body.currency,
        baseAmountMinor: body.amountMinor,
        expenseDate: body.expenseDate ?? before.expenseDate,
        splitMethod: body.splitMethod,
      })
      .where(eq(expenses.id, expenseId));
    await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
    await tx.delete(expenseParticipants).where(eq(expenseParticipants.expenseId, expenseId));
    await tx.insert(expensePayers).values(payers.map((p) => ({ ...p, expenseId })));
    await tx.insert(expenseParticipants).values(participants.map((p) => ({ ...p, expenseId })));
  });
}

export async function setExpenseDeleted(
  db: Database,
  groupService: GroupService,
  input: { expenseId: string; userId: string; version: number; deleted: boolean },
): Promise<ExpenseRow> {
  const { expenseId, userId, version, deleted } = input;
  return mutateExpense(db, groupService, { expenseId, userId, version, kind: deleted ? "delete" : "restore" }, async (tx, row, before) => {
    const affected = [...netsOf(before)].filter(([, net]) => net !== 0).map(([id]) => id);
    await requireMayAffect(tx, groupService, row.groupId, userId, affected);
    await tx
      .update(expenses)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(eq(expenses.id, expenseId));
  });
}

/** Newest first. On a direct expense, versions the reader wasn't part of are
 * left out: being added later doesn't open up what came before. */
export async function readHistory(db: Executor, row: ExpenseRow, readerId: string) {
  const visible = (s: Snapshot | null | undefined) => (s && (row.groupId !== null || involvedIn(s).has(readerId)) ? s : null);
  const rows = await db
    .select({ entry: expenseEditHistory, editedByName: users.displayName })
    .from(expenseEditHistory)
    .innerJoin(users, eq(users.id, expenseEditHistory.editedBy))
    .where(eq(expenseEditHistory.expenseId, row.id))
    .orderBy(desc(expenseEditHistory.editedAt));
  return rows.map(({ entry, editedByName }) => {
    const { before, after } = (entry.diff ?? {}) as HistoryDiff;
    return { entry, editedByName, diff: { before: visible(before), after: visible(after) } };
  });
}
