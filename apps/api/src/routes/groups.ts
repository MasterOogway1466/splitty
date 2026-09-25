import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  addGroupMemberRequestSchema,
  createExpenseRequestSchema,
  createGroupRequestSchema,
  createSettlementRequestSchema,
  setMemberColorRequestSchema,
} from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { activityFeed, expenses, settlements, users } from "../db/schema.js";
import { NotGroupMemberError } from "../groups/errors.js";
import { createExpense, participantUserIdsOf } from "../ledger/expenses.js";
import { createSettlement } from "../ledger/settlements.js";
import { authenticate } from "../plugins/authenticate.js";
import { serializeExpense, serializeSettlement } from "./serializers.js";

// docs/PLAN-PUBLIC.md §5 Phase 0 requirement, actually applicable from
// Phase 1 on since groups/expenses didn't exist before now — a
// per-account cap on resource creation, bounding abuse and keeping load
// predictable. Generous enough that real usage never brushes up against it.
const GROUP_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 20 };
const EXPENSE_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };
const SETTLEMENT_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  const { db, groupService } = app;

  app.addHook("preHandler", (request, reply) => authenticate(app, request, reply));

  app.post("/", async (request, reply) => {
    const rl = await checkAndRecordRateLimit(db, "group_create", request.currentUser!.id, GROUP_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many groups created today" });

    const body = createGroupRequestSchema.parse(request.body);
    const group = await groupService.createGroup({ ...body, createdBy: request.currentUser!.id });
    reply.status(201);
    return group;
  });

  app.get("/", async (request) => {
    return groupService.listMyGroups(request.currentUser!.id);
  });

  app.get("/:groupId", async (request) => {
    const { groupId } = request.params as { groupId: string };
    return groupService.getGroupDetail(groupId, request.currentUser!.id);
  });

  app.post("/:groupId/members", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const body = addGroupMemberRequestSchema.parse(request.body);
    await groupService.addMember(groupId, body.email, request.currentUser!.id);
    reply.status(204).send();
  });

  app.delete("/:groupId/members/:userId", async (request, reply) => {
    const { groupId, userId } = request.params as { groupId: string; userId: string };
    await groupService.removeMember(groupId, userId, request.currentUser!.id);
    reply.status(204).send();
  });

  app.post("/:groupId/leave", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    await groupService.leaveGroup(groupId, request.currentUser!.id);
    reply.status(204).send();
  });

  app.patch("/:groupId/color", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const body = setMemberColorRequestSchema.parse(request.body);
    await groupService.setMemberColor(groupId, request.currentUser!.id, body.color);
    reply.status(204).send();
  });

  app.delete("/:groupId", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    await groupService.deleteGroup(groupId, request.currentUser!.id);
    reply.status(204).send();
  });

  app.get("/:groupId/expenses", async (request) => {
    const { groupId } = request.params as { groupId: string };
    await groupService.requireMembership(groupId, request.currentUser!.id);

    const rows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId)))
      .orderBy(desc(expenses.expenseDate));
    return Promise.all(rows.filter((r) => !r.deletedAt).map((r) => serializeExpense(db, r)));
  });

  app.post("/:groupId/expenses", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const userId = request.currentUser!.id;
    await groupService.requireMembership(groupId, userId);

    const rl = await checkAndRecordRateLimit(db, "expense_create", userId, EXPENSE_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many expenses created today" });

    const body = createExpenseRequestSchema.parse(request.body);
    // Every payer and participant must actually be a current member of
    // this group — the isolation boundary applies to who an expense can
    // involve, not just who can create one.
    for (const memberId of new Set([...body.payers.map((p) => p.userId), ...participantUserIdsOf(body)])) {
      if (!(await groupService.isMember(groupId, memberId))) {
        throw new NotGroupMemberError();
      }
    }

    const { id } = await createExpense(db, {
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
    const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
    reply.status(201);
    return serializeExpense(db, row!);
  });

  app.get("/:groupId/settlements", async (request) => {
    const { groupId } = request.params as { groupId: string };
    await groupService.requireMembership(groupId, request.currentUser!.id);

    const rows = await db
      .select()
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId)))
      .orderBy(desc(settlements.settledAt));
    return rows.filter((r) => !r.deletedAt).map(serializeSettlement);
  });

  app.post("/:groupId/settlements", async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const userId = request.currentUser!.id;
    await groupService.requireMembership(groupId, userId);

    const rl = await checkAndRecordRateLimit(db, "settlement_create", userId, SETTLEMENT_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many settlements recorded today" });

    const body = createSettlementRequestSchema.parse(request.body);
    for (const memberId of [body.fromUserId, body.toUserId]) {
      if (!(await groupService.isMember(groupId, memberId))) {
        throw new NotGroupMemberError();
      }
    }

    const { id } = await createSettlement(db, {
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
    const [row] = await db.select().from(settlements).where(eq(settlements.id, id));
    reply.status(201);
    return serializeSettlement(row!);
  });

  app.get("/:groupId/activity", async (request) => {
    const { groupId } = request.params as { groupId: string };
    const userId = request.currentUser!.id;
    await groupService.requireMembership(groupId, userId);

    const rows = await db
      .select()
      .from(activityFeed)
      .where(and(eq(activityFeed.groupId, groupId), eq(activityFeed.recipientId, userId)))
      .orderBy(desc(activityFeed.createdAt))
      .limit(50);

    const actorIds = [...new Set(rows.map((r) => r.actorId))];
    const actorRows = actorIds.length
      ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, actorIds))
      : [];
    const actorMap = new Map(actorRows.map((a) => [a.id, a.displayName]));

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      actorId: row.actorId,
      actorDisplayName: actorMap.get(row.actorId) ?? "Someone",
      entityType: row.entityType,
      entityId: row.entityId,
      groupId: row.groupId,
      groupName: null,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}
