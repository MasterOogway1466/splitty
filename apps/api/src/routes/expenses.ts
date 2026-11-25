import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createExpenseRequestSchema, expenseVersionRequestSchema, updateExpenseRequestSchema } from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { expenseParticipants, expensePayers, expenses } from "../db/schema.js";
import { RateLimitedError } from "../auth/errors.js";
import { readHistory, requireExpenseAccess, setExpenseDeleted, updateExpense } from "../ledger/lifecycle.js";
import { recordExpense } from "../ledger/record.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { uuidParam } from "./params.js";
import { serializeExpense, serializeHistory } from "./serializers.js";

const EXPENSE_EDIT_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 500 };
const EXPENSE_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };

/** Direct (non-group) expenses and IOUs — docs/PLAN-PUBLIC.md §12's
 * isolation test explicitly requires this path to exist and be scoped:
 * with no group to check membership against, authorization here is
 * "the requester must be a payer or participant," not membership. */
export async function registerExpenseRoutes(app: FastifyInstance): Promise<void> {
  const { db, groupService } = app;

  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (request) => {
    const userId = request.currentUser!.id;
    const asPayer = await db
      .select({ expenseId: expensePayers.expenseId })
      .from(expensePayers)
      .innerJoin(expenses, eq(expensePayers.expenseId, expenses.id))
      .where(and(eq(expensePayers.userId, userId), isNull(expenses.groupId)));
    const asParticipant = await db
      .select({ expenseId: expenseParticipants.expenseId })
      .from(expenseParticipants)
      .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
      .where(and(eq(expenseParticipants.userId, userId), isNull(expenses.groupId)));
    const expenseIds = [...new Set([...asPayer.map((r) => r.expenseId), ...asParticipant.map((r) => r.expenseId)])];
    if (expenseIds.length === 0) return [];

    const rows = await db
      .select()
      .from(expenses)
      .where(and(isNull(expenses.groupId), isNull(expenses.deletedAt)))
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
    const relevant = rows.filter((r) => expenseIds.includes(r.id));
    return Promise.all(relevant.map((r) => serializeExpense(db, r)));
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

  async function limitEdits(userId: string): Promise<void> {
    const rl = await checkAndRecordRateLimit(db, "expense_edit", userId, EXPENSE_EDIT_CAP);
    if (!rl.allowed) throw new RateLimitedError(EXPENSE_EDIT_CAP.windowSeconds);
  }

  app.get("/:expenseId", async (request) => {
    const row = await requireExpenseAccess(db, groupService, uuidParam(request, "expenseId"), request.currentUser!.id);
    return serializeExpense(db, row);
  });

  app.get("/:expenseId/history", async (request) => {
    const row = await requireExpenseAccess(db, groupService, uuidParam(request, "expenseId"), request.currentUser!.id);
    return serializeHistory(db, await readHistory(db, row.id));
  });

  app.put("/:expenseId", async (request) => {
    const expenseId = uuidParam(request, "expenseId");
    const userId = request.currentUser!.id;
    await limitEdits(userId);
    const body = updateExpenseRequestSchema.parse(request.body);
    return serializeExpense(db, await updateExpense(db, groupService, { expenseId, userId, body }));
  });

  for (const [action, deleted] of [["delete", true], ["restore", false]] as const) {
    app.post(`/:expenseId/${action}`, async (request) => {
      const expenseId = uuidParam(request, "expenseId");
      const userId = request.currentUser!.id;
      await limitEdits(userId);
      const { version } = expenseVersionRequestSchema.parse(request.body);
      return serializeExpense(db, await setExpenseDeleted(db, groupService, { expenseId, userId, version, deleted }));
    });
  }
}
