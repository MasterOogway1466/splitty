import { and, eq, isNull, sql } from "drizzle-orm";
import { GroupArchivedError, GroupNotFoundError } from "../groups/errors.js";
import type { Executor } from "./client.js";
import { groups } from "./schema.js";

/** Serializes a group's ledger writes against its membership and deletion
 * guards, so neither can act on what the other is about to change. Call
 * inside a transaction, before reading anything the decision depends on.
 * An archived group is read-only unless the caller says otherwise. */
export async function lockGroup(tx: Executor, groupId: string, { allowArchived = false } = {}): Promise<void> {
  const [group] = await tx
    .select({ archivedAt: groups.archivedAt })
    .from(groups)
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
    .for("no key update");
  if (!group) throw new GroupNotFoundError();
  if (group.archivedAt && !allowArchived) throw new GroupArchivedError();
}

/** Transaction-scoped lock on an arbitrary key, for what has no row to lock. */
export async function lockKey(tx: Executor, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
