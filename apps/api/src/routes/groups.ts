import type { FastifyInstance } from "fastify";
import {
  addGroupMemberRequestSchema,
  createExpenseRequestSchema,
  createGroupRequestSchema,
  createSettlementRequestSchema,
  setMemberColorRequestSchema,
} from "@splitty/shared";
import { readActivity } from "../activity/read.js";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { computeGroupDebts } from "../ledger/balances.js";
import { listExpenses, listSettlements } from "../ledger/lists.js";
import { recordExpense, recordSettlement } from "../ledger/record.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { listQuery } from "./paging.js";
import { uuidParam } from "./params.js";
import { serializeExpense, serializeSettlement } from "./serializers.js";

// docs/PLAN-PUBLIC.md §5 Phase 0 requirement, actually applicable from
// Phase 1 on since groups/expenses didn't exist before now — a
// per-account cap on resource creation, bounding abuse and keeping load
// predictable. Generous enough that real usage never brushes up against it.
const GROUP_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 20 };
const MEMBER_ADD_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 100 };
const EXPENSE_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };
const SETTLEMENT_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  const { db, groupService } = app;

  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

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
    const groupId = uuidParam(request, "groupId");
    return groupService.getGroupDetail(groupId, request.currentUser!.id);
  });

  app.post("/:groupId/members", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    const rl = await checkAndRecordRateLimit(db, "member_add", request.currentUser!.id, MEMBER_ADD_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many members added today" });

    const body = addGroupMemberRequestSchema.parse(request.body);
    await groupService.addMember(groupId, body.email, request.currentUser!.id);
    reply.status(204).send();
  });

  app.delete("/:groupId/members/:userId", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    const userId = uuidParam(request, "userId");
    await groupService.removeMember(groupId, userId, request.currentUser!.id);
    reply.status(204).send();
  });

  app.post("/:groupId/leave", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    await groupService.leaveGroup(groupId, request.currentUser!.id);
    reply.status(204).send();
  });

  app.patch("/:groupId/color", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    const body = setMemberColorRequestSchema.parse(request.body);
    await groupService.setMemberColor(groupId, request.currentUser!.id, body.color);
    reply.status(204).send();
  });

  app.delete("/:groupId", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    await groupService.deleteGroup(groupId, request.currentUser!.id);
    reply.status(204).send();
  });

  app.get("/:groupId/expenses", async (request) => {
    const groupId = uuidParam(request, "groupId");
    await groupService.requireMembership(groupId, request.currentUser!.id);
    return listExpenses(db, { groupId }, listQuery(request));
  });

  app.post("/:groupId/expenses", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    const userId = request.currentUser!.id;
    await groupService.requireMembership(groupId, userId);

    const rl = await checkAndRecordRateLimit(db, "expense_create", userId, EXPENSE_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many expenses created today" });

    const body = createExpenseRequestSchema.parse(request.body);
    const { row, created } = await recordExpense(db, groupService, { groupId, userId, body });
    reply.status(created ? 201 : 200);
    return serializeExpense(db, row);
  });

  app.get("/:groupId/settlements", async (request) => {
    const groupId = uuidParam(request, "groupId");
    await groupService.requireMembership(groupId, request.currentUser!.id);

    return listSettlements(db, { groupId }, listQuery(request));
  });

  app.post("/:groupId/settlements", async (request, reply) => {
    const groupId = uuidParam(request, "groupId");
    const userId = request.currentUser!.id;
    await groupService.requireMembership(groupId, userId);

    const rl = await checkAndRecordRateLimit(db, "settlement_create", userId, SETTLEMENT_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many settlements recorded today" });

    const body = createSettlementRequestSchema.parse(request.body);
    const { row, created } = await recordSettlement(db, groupService, { groupId, userId, body });
    reply.status(created ? 201 : 200);
    return serializeSettlement(db, row);
  });

  app.get("/:groupId/debts", async (request) => {
    const groupId = uuidParam(request, "groupId");
    const { members } = await groupService.getGroupDetail(groupId, request.currentUser!.id);
    return computeGroupDebts(db, groupId, new Set(members.map((m) => m.userId)));
  });

  app.get("/:groupId/activity", async (request) => {
    const groupId = uuidParam(request, "groupId");
    const userId = request.currentUser!.id;
    await groupService.requireMembership(groupId, userId);

    return readActivity(db, userId, listQuery(request), groupId);
  });
}
