import { eq, inArray, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { BalanceContext, PairwiseBalance, PersonBalance } from "@splitty/shared";
import { friendLinks, users } from "../db/schema.js";
import { computeAllPairwiseBalances, computeGlobalBalances, computePairwiseBalances, pairwiseFlows } from "../ledger/balances.js";
import { PersonNotFoundError } from "../groups/errors.js";
import { activeCoMemberIds, isConnected, sharedGroups } from "../ledger/relationships.js";
import { uuidParam } from "./params.js";
import { authenticateVerified } from "../plugins/authenticate.js";

export async function registerBalanceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook("preHandler", (request, reply) => authenticateVerified(app, request, reply));

  app.get("/", async (request) => {
    const userId = request.currentUser!.id;
    const balances = await computeGlobalBalances(db, userId);
    return [...balances.entries()].map(([currency, netMinor]) => ({ currency, netMinor }));
  });

  /** Everyone with a running balance context: linked via a shared direct
   * expense/IOU (friend_links, §6), a current co-member of any group, or
   * anyone with an outstanding balance (e.g. a former co-member).
   * This is what makes writing friend_links on the first direct expense
   * actually useful, rather than a table nothing reads. */
  app.get("/people", async (request) => {
    const userId = request.currentUser!.id;

    const links = await db
      .select()
      .from(friendLinks)
      .where(or(eq(friendLinks.userAId, userId), eq(friendLinks.userBId, userId)));
    const fromLinks = links.map((l) => (l.userAId === userId ? l.userBId : l.userAId));

    const coMembers = (await activeCoMemberIds(db, userId)).filter((id) => id !== userId);

    const pairwise = await computeAllPairwiseBalances(db, userId);
    const withBalance = [...pairwise].filter(([, net]) => [...net.values()].some((v) => v !== 0)).map(([id]) => id);

    const peopleIds = [...new Set([...fromLinks, ...coMembers, ...withBalance])];
    if (peopleIds.length === 0) return [];

    const peopleRows = await db.select().from(users).where(inArray(users.id, peopleIds));

    const result: PairwiseBalance[] = [];
    for (const person of peopleRows) {
      const balances = pairwise.get(person.id) ?? new Map<string, number>();
      result.push({
        userId: person.id,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl,
        balances: [...balances.entries()].map(([currency, netMinor]) => ({ currency, netMinor })),
      });
    }
    return result;
  });

  /** One person, broken down by where each part can be settled. What is
   * left in a group you no longer both belong to counts as direct. */
  app.get("/people/:personId", async (request): Promise<PersonBalance> => {
    const userId = request.currentUser!.id;
    const personId = uuidParam(request, "personId");
    const flows = (await pairwiseFlows(db, userId)).filter((f) => f.otherUserId === personId);
    const [person] = await db.select().from(users).where(eq(users.id, personId));
    const known = flows.length > 0 || (personId !== userId && (await isConnected(db, userId, personId)));
    if (!person || !known) throw new PersonNotFoundError();

    const shared = new Map((await sharedGroups(db, userId, personId)).map((g) => [g.id, g.name]));
    const contexts = new Map<string, BalanceContext>();
    for (const { groupId, currency, deltaMinor } of flows) {
      const settleIn = groupId !== null && shared.has(groupId) ? groupId : null;
      const key = `${settleIn}:${currency}`;
      const context = contexts.get(key) ?? { groupId: settleIn, groupName: settleIn && shared.get(settleIn)!, currency, netMinor: 0 };
      context.netMinor += deltaMinor;
      contexts.set(key, context);
    }
    return {
      userId: person.id,
      displayName: person.displayName,
      avatarUrl: person.avatarUrl,
      contexts: [...contexts.values()].filter((c) => c.netMinor !== 0),
    };
  });

  app.get("/:otherUserId", async (request) => {
    const userId = request.currentUser!.id;
    const otherUserId = uuidParam(request, "otherUserId");
    const balances = await computePairwiseBalances(db, userId, otherUserId);
    return [...balances.entries()].map(([currency, netMinor]) => ({ currency, netMinor }));
  });
}
