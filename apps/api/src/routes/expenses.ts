import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createExpenseRequestSchema } from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { expenseParticipants, expensePayers, expenses } from "../db/schema.js";
import { recordExpense } from "../ledger/record.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { serializeExpense } from "./serializers.js";

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
      .orderBy(desc(expenses.expenseDate));
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
}
