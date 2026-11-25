import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { activityFeed, groupMembers } from "../db/schema.js";

/** One feed row per recipient (docs/PLAN-PUBLIC.md §6): everyone involved,
 * plus every current member of the group. */
export async function writeActivity(
  tx: Executor,
  input: {
    actorId: string;
    type: (typeof activityFeed.$inferInsert)["type"];
    entityType: "expense" | "settlement" | "group" | "member";
    entityId: string;
    groupId: string | null;
    involved: Iterable<string>;
  },
): Promise<void> {
  const { involved, ...entry } = input;
  const recipients = new Set(involved);
  if (input.groupId !== null) {
    const members = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, input.groupId), isNull(groupMembers.removedAt)));
    for (const m of members) recipients.add(m.userId);
  }
  await tx.insert(activityFeed).values([...recipients].map((recipientId) => ({ ...entry, recipientId })));
}
