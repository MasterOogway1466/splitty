import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createSettlementRequestSchema } from "@splitty/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { settlements } from "../db/schema.js";
import { recordSettlement } from "../ledger/record.js";
import { authenticateVerified } from "../plugins/authenticate.js";
import { serializeSettlement } from "./serializers.js";

const SETTLEMENT_CREATE_CAP = { windowSeconds: 24 * 60 * 60, maxEvents: 200 };

/** Direct (non-group) settlements — same isolation shape as direct
 * expenses (routes/expenses.ts): no group membership to check, so the
 * requester must be one of the two parties involved. */
export async function registerSettlementRoutes(app: FastifyInstance): Promise<void> {
  const { db, groupService } = app;

  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (request) => {
    const userId = request.currentUser!.id;
    const rows = await db
      .select()
      .from(settlements)
      .where(
        and(
          isNull(settlements.groupId),
          isNull(settlements.deletedAt),
          or(eq(settlements.fromUserId, userId), eq(settlements.toUserId, userId)),
        ),
      )
      .orderBy(desc(settlements.settledAt));
    return rows.map(serializeSettlement);
  });

  app.post("/", async (request, reply) => {
    const userId = request.currentUser!.id;
    const rl = await checkAndRecordRateLimit(db, "settlement_create", userId, SETTLEMENT_CREATE_CAP);
    if (!rl.allowed) return reply.status(429).send({ error: "rate_limited", message: "Too many settlements recorded today" });

    const body = createSettlementRequestSchema.parse(request.body);
    const { row, created } = await recordSettlement(db, groupService, { groupId: null, userId, body });
    reply.status(created ? 201 : 200);
    return serializeSettlement(row);
  });
}
