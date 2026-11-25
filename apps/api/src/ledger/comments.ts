import { and, asc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Comment, CreateCommentRequest } from "@splitty/shared";
import { writeActivity } from "../activity/write.js";
import type { Database, Executor } from "../db/client.js";
import { lockGroup, lockKey } from "../db/locks.js";
import { expenseComments, expenseEditHistory, expenses, users } from "../db/schema.js";
import { CommentNotFoundError, IdConflictError, WrongStateError } from "../groups/errors.js";
import type { GroupService } from "../groups/service.js";
import { snapshotExpense, type HistoryDiff } from "./history.js";
import { involvedIn, requireExpenseAccess } from "./lifecycle.js";

type ExpenseRow = typeof expenses.$inferSelect;

async function lockForComment(tx: Executor, groupService: GroupService, expenseId: string, userId: string): Promise<ExpenseRow> {
  const { groupId } = await requireExpenseAccess(tx, groupService, expenseId, userId);
  if (groupId !== null) await lockGroup(tx, groupId);
  await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.id, expenseId)).for("update");
  return requireExpenseAccess(tx, groupService, expenseId, userId);
}

export async function addComment(
  db: Database,
  groupService: GroupService,
  input: { expenseId: string; userId: string; body: CreateCommentRequest },
): Promise<{ comment: Comment; created: boolean }> {
  const { expenseId, userId, body } = input;
  return db.transaction(async (tx) => {
    const id = body.id ?? uuidv7();
    await lockKey(tx, `ledger-id:${id}`);
    const row = await lockForComment(tx, groupService, expenseId, userId);

    const [existing] = await tx.select().from(expenseComments).where(eq(expenseComments.id, id));
    if (existing && (existing.userId !== userId || existing.expenseId !== expenseId || existing.body !== body.body)) throw new IdConflictError();
    if (!existing) {
      if (row.deletedAt) throw new WrongStateError("This expense is deleted");
      // Explicit, so it compares with edit times in visibleSince below.
      await tx.insert(expenseComments).values({ id, expenseId, userId, body: body.body, createdAt: new Date() });
      const snapshot = await snapshotExpense(tx, row);
      await writeActivity(tx, {
        actorId: userId,
        type: "comment_added",
        entityType: "expense",
        entityId: expenseId,
        groupId: row.groupId,
        involved: involvedIn(snapshot),
      });
    }
    const [saved] = await tx
      .select({ comment: expenseComments, displayName: users.displayName })
      .from(expenseComments)
      .innerJoin(users, eq(users.id, expenseComments.userId))
      .where(eq(expenseComments.id, id));
    return { comment: serialize(saved!), created: !existing };
  });
}

export async function deleteComment(
  db: Database,
  groupService: GroupService,
  input: { expenseId: string; commentId: string; userId: string },
): Promise<void> {
  const { expenseId, commentId, userId } = input;
  await db.transaction(async (tx) => {
    await lockForComment(tx, groupService, expenseId, userId);
    const deleted = await tx
      .update(expenseComments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(expenseComments.id, commentId),
          eq(expenseComments.expenseId, expenseId),
          eq(expenseComments.userId, userId),
          isNull(expenseComments.deletedAt),
        ),
      )
      .returning({ id: expenseComments.id });
    if (deleted.length === 0) throw new CommentNotFoundError();
  });
}

/** Oldest first. */
export async function listComments(db: Executor, row: ExpenseRow, readerId: string): Promise<Comment[]> {
  const rows = await db
    .select({ comment: expenseComments, displayName: users.displayName })
    .from(expenseComments)
    .innerJoin(users, eq(users.id, expenseComments.userId))
    .where(and(eq(expenseComments.expenseId, row.id), isNull(expenseComments.deletedAt)))
    .orderBy(asc(expenseComments.createdAt), asc(expenseComments.id));
  const since = row.groupId === null ? await visibleSince(db, row.id, readerId) : null;
  return rows.filter(({ comment }) => since === null || comment.createdAt > since).map(serialize);
}

/** When the reader last became part of a direct expense; null if they have
 * been all along. Being added later doesn't open up earlier comments. */
async function visibleSince(db: Executor, expenseId: string, readerId: string): Promise<Date | null> {
  const entries = await db
    .select({ editedAt: expenseEditHistory.editedAt, diff: expenseEditHistory.diff })
    .from(expenseEditHistory)
    .where(eq(expenseEditHistory.expenseId, expenseId))
    .orderBy(asc(expenseEditHistory.editedAt));
  let since: Date | null = null;
  for (const { editedAt, diff } of entries) {
    const { before, after } = (diff ?? {}) as HistoryDiff;
    if (after && before && involvedIn(after).has(readerId) && !involvedIn(before).has(readerId)) since = editedAt;
  }
  return since;
}

function serialize({ comment, displayName }: { comment: typeof expenseComments.$inferSelect; displayName: string }): Comment {
  return {
    id: comment.id,
    expenseId: comment.expenseId,
    userId: comment.userId,
    displayName,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
