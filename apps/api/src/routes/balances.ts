import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { PairwiseBalance } from "@splitty/shared";
import { friendLinks, groupMembers, users } from "../db/schema.js";
import { computeGlobalBalances, computePairwiseBalances } from "../ledger/balances.js";
import { authenticate } from "../plugins/authenticate.js";

export async function registerBalanceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook("preHandler", (request, reply) => authenticate(app, request, reply));

  app.get("/", async (request) => {
    const userId = request.currentUser!.id;
    const balances = await computeGlobalBalances(db, userId);
    return [...balances.entries()].map(([currency, netMinor]) => ({ currency, netMinor }));
  });

  /** Everyone with a running balance context: linked via a shared direct
   * expense/IOU (friend_links, §6), or a current co-member of any group.
   * This is what makes writing friend_links on the first direct expense
   * actually useful, rather than a table nothing reads. */
  app.get("/people", async (request) => {
    const userId = request.currentUser!.id;

    const links = await db
      .select()
      .from(friendLinks)
      .where(or(eq(friendLinks.userAId, userId), eq(friendLinks.userBId, userId)));
    const fromLinks = links.map((l) => (l.userAId === userId ? l.userBId : l.userAId));

    const myGroupIds = (
      await db.select({ groupId: groupMembers.groupId }).from(groupMembers).where(and(eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)))
    ).map((r) => r.groupId);
    const coMembers = myGroupIds.length
      ? await db
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(inArray(groupMembers.groupId, myGroupIds), isNull(groupMembers.removedAt), ne(groupMembers.userId, userId)))
      : [];

    const peopleIds = [...new Set([...fromLinks, ...coMembers.map((r) => r.userId)])];
    if (peopleIds.length === 0) return [];

    const peopleRows = await db.select().from(users).where(inArray(users.id, peopleIds));

    const result: PairwiseBalance[] = [];
    for (const person of peopleRows) {
      const balances = await computePairwiseBalances(db, userId, person.id);
      result.push({
        userId: person.id,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl,
        balances: [...balances.entries()].map(([currency, netMinor]) => ({ currency, netMinor })),
      });
    }
    return result;
  });

  app.get("/:otherUserId", async (request) => {
    const userId = request.currentUser!.id;
    const { otherUserId } = request.params as { otherUserId: string };
    const balances = await computePairwiseBalances(db, userId, otherUserId);
    return [...balances.entries()].map(([currency, netMinor]) => ({ currency, netMinor }));
  });
}
