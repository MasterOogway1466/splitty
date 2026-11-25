import type { FastifyInstance } from "fastify";
import { createCommentRequestSchema, createExpenseRequestSchema, versionRequestSchema, updateExpenseRequestSchema } from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { limitLedgerEdits } from "./editLimit.js";
import { readHistory, requireExpenseAccess, setExpenseDeleted, updateExpense } from "../ledger/lifecycle.js";
import { addComment, deleteComment, listComments } from "../ledger/comments.js";
import { listExpenses } from "../ledger/lists.js";
import { recordExpense } from "../ledger/record.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { listQuery } from "./paging.js";
import { uuidParam } from "./params.js";
import { serializeExpense, serializeHistory } from "./serializers.js";

const COMMENT_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 300 };
const EXPENSE_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };

/** Direct (non-group) expenses and IOUs — docs/PLAN-PUBLIC.md §12's
 * isolation test explicitly requires this path to exist and be scoped:
 * with no group to check membership against, authorization here is
 * "the requester must be a payer or participant," not membership. */
export async function registerExpenseRoutes(app: FastifyInstance): Promise<void> {
  const { db, groupService } = app;

  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (request) => {
    return listExpenses(db, { directFor: request.currentUser!.id }, listQuery(request));
  });

  app.post("/", async (request, reply) => {
    const userId = request.currentUser!.id;
    const rl = await checkAndRecordRateLimit(db, "expense_create", userId, EXPENSE_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many expenses created today" });

    const body = createExpenseRequestSchema.parse(request.body);
    const { row, created } = await recordExpense(db, groupService, { groupId: null, userId, body });
    reply.status(created ? 201 : 200);
    return serializeExpense(db, row);
  });

  // The routes below serve group and direct expenses alike.

  app.get("/:expenseId", async (request) => {
    const row = await requireExpenseAccess(db, groupService, uuidParam(request, "expenseId"), request.currentUser!.id);
    return serializeExpense(db, row);
  });

  app.get("/:expenseId/history", async (request) => {
    const row = await requireExpenseAccess(db, groupService, uuidParam(request, "expenseId"), request.currentUser!.id);
    return serializeHistory(db, await readHistory(db, row, request.currentUser!.id));
  });

  app.get("/:expenseId/comments", async (request) => {
    const userId = request.currentUser!.id;
    const row = await requireExpenseAccess(db, groupService, uuidParam(request, "expenseId"), userId);
    return listComments(db, row, userId);
  });

  app.post("/:expenseId/comments", async (request, reply) => {
    const expenseId = uuidParam(request, "expenseId");
    const userId = request.currentUser!.id;
    const rl = await checkAndRecordRateLimit(db, "comment_create", userId, COMMENT_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many comments today" });
    const body = createCommentRequestSchema.parse(request.body);
    const { comment, created } = await addComment(db, groupService, { expenseId, userId, body });
    reply.status(created ? 201 : 200);
    return comment;
  });

  app.delete("/:expenseId/comments/:commentId", async (request, reply) => {
    await deleteComment(db, groupService, {
      expenseId: uuidParam(request, "expenseId"),
      commentId: uuidParam(request, "commentId"),
      userId: request.currentUser!.id,
    });
    return reply.status(204).send();
  });

  app.put("/:expenseId", async (request) => {
    const expenseId = uuidParam(request, "expenseId");
    const userId = request.currentUser!.id;
    await limitLedgerEdits(db, userId);
    const body = updateExpenseRequestSchema.parse(request.body);
    return serializeExpense(db, await updateExpense(db, groupService, { expenseId, userId, body }));
  });

  for (const [action, deleted] of [["delete", true], ["restore", false]] as const) {
    app.post(`/:expenseId/${action}`, async (request) => {
      const expenseId = uuidParam(request, "expenseId");
      const userId = request.currentUser!.id;
      await limitLedgerEdits(db, userId);
      const { version } = versionRequestSchema.parse(request.body);
      return serializeExpense(db, await setExpenseDeleted(db, groupService, { expenseId, userId, version, deleted }));
    });
  }
}
