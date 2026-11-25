import type { FastifyInstance } from "fastify";
import { createSettlementRequestSchema, versionRequestSchema, updateSettlementRequestSchema } from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { listSettlements } from "../ledger/lists.js";
import { recordSettlement } from "../ledger/record.js";
import { readSettlementHistory, requireSettlementAccess, setSettlementDeleted, updateSettlement } from "../ledger/settlementLifecycle.js";
import { limitLedgerEdits } from "./editLimit.js";
import { listQuery } from "./paging.js";
import { uuidParam } from "./params.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { serializeSettlement, serializeSettlementHistory } from "./serializers.js";

const SETTLEMENT_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };

/** Direct (non-group) settlements — same isolation shape as direct
 * expenses (routes/expenses.ts): no group membership to check, so the
 * requester must be one of the two parties involved. */
export async function registerSettlementRoutes(app: FastifyInstance): Promise<void> {
  const { db, groupService } = app;

  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (request) => {
    return listSettlements(db, { directFor: request.currentUser!.id }, listQuery(request));
  });

  app.post("/", async (request, reply) => {
    const userId = request.currentUser!.id;
    const rl = await checkAndRecordRateLimit(db, "settlement_create", userId, SETTLEMENT_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many settlements recorded today" });

    const body = createSettlementRequestSchema.parse(request.body);
    const { row, created } = await recordSettlement(db, groupService, { groupId: null, userId, body });
    reply.status(created ? 201 : 200);
    return serializeSettlement(db, row);
  });

  // The routes below serve group and direct settlements alike.

  app.get("/:settlementId", async (request) => {
    const row = await requireSettlementAccess(db, groupService, uuidParam(request, "settlementId"), request.currentUser!.id);
    return serializeSettlement(db, row);
  });

  app.get("/:settlementId/history", async (request) => {
    const row = await requireSettlementAccess(db, groupService, uuidParam(request, "settlementId"), request.currentUser!.id);
    return serializeSettlementHistory(await readSettlementHistory(db, row.id));
  });

  app.put("/:settlementId", async (request) => {
    const settlementId = uuidParam(request, "settlementId");
    const userId = request.currentUser!.id;
    await limitLedgerEdits(db, userId);
    const body = updateSettlementRequestSchema.parse(request.body);
    return serializeSettlement(db, await updateSettlement(db, groupService, { settlementId, userId, body }));
  });

  for (const [action, deleted] of [["delete", true], ["restore", false]] as const) {
    app.post(`/:settlementId/${action}`, async (request) => {
      const settlementId = uuidParam(request, "settlementId");
      const userId = request.currentUser!.id;
      await limitLedgerEdits(db, userId);
      const { version } = versionRequestSchema.parse(request.body);
      return serializeSettlement(db, await setSettlementDeleted(db, groupService, { settlementId, userId, version, deleted }));
    });
  }
}
