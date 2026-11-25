import { and, asc, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { GroupSummary, GroupDetail, GroupMember, MemberColor } from "@splitty/shared";
import type { Database, Executor } from "../db/client.js";
import { lockGroup } from "../db/locks.js";
import { groupMembers, groups, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { createInviteLink, reserveInviteSend } from "../invites/send.js";
import type { Mailer } from "../mail/mailer.js";
import { computeBalancesByGroup, computeGroupBalances } from "../ledger/balances.js";
import {
  AlreadyMemberError,
  CurrencyMismatchError,
  DomainError,
  GroupNotFoundError,
  GroupNotSettledError,
  NonzeroBalanceError,
  NotGroupMemberError,
  NotGroupOwnerError,
} from "./errors.js";

type GroupRow = typeof groups.$inferSelect;

export class GroupService {
  #db: Database;
  #mailer: Mailer;
  #env: Env;

  constructor(db: Database, mailer: Mailer, env: Env) {
    this.#db = db;
    this.#mailer = mailer;
    this.#env = env;
  }

  async createGroup(input: { name: string; groupType: string; defaultCurrency: string; createdBy: string }): Promise<GroupRow> {
    return this.#db.transaction(async (tx) => {
      const [group] = await tx
        .insert(groups)
        .values({
          name: input.name,
          groupType: input.groupType as GroupRow["groupType"],
          defaultCurrency: input.defaultCurrency,
          createdBy: input.createdBy,
        })
        .returning();
      if (!group) throw new Error("Insert returned no row");
      await tx.insert(groupMembers).values({ groupId: group.id, userId: input.createdBy, role: "owner" });
      return group;
    });
  }

  /** docs/PLAN-PUBLIC.md §5: the access boundary — throws if `userId` is
   * not a current member (a removed member's old row must not grant
   * access, hence `removedAt` still null), or the group is deleted. */
  async requireMembership(groupId: string, userId: string): Promise<void> {
    if (!(await this.isMember(groupId, userId))) throw new NotGroupMemberError();
  }

  async isMember(groupId: string, userId: string, db: Executor = this.#db): Promise<boolean> {
    const [row] = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, userId),
          isNull(groupMembers.removedAt),
          isNull(groups.deletedAt),
        ),
      );
    return !!row;
  }

  async areMembers(groupId: string, userIds: string[], db: Executor = this.#db): Promise<boolean> {
    const wanted = [...new Set(userIds)];
    const rows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          inArray(groupMembers.userId, wanted),
          isNull(groupMembers.removedAt),
          isNull(groups.deletedAt),
        ),
      );
    return rows.length === wanted.length;
  }

  async requireGroupCurrency(groupId: string, currency: string, db: Executor = this.#db): Promise<void> {
    const [group] = await db.select({ defaultCurrency: groups.defaultCurrency }).from(groups).where(eq(groups.id, groupId));
    if (!group) throw new GroupNotFoundError();
    if (group.defaultCurrency !== currency) throw new CurrencyMismatchError(group.defaultCurrency);
  }

  async listMyGroups(userId: string): Promise<GroupSummary[]> {
    const myGroups = await this.#db
      .select({ group: groups })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, userId), isNull(groupMembers.removedAt), isNull(groups.deletedAt)));
    if (myGroups.length === 0) return [];

    const ids = myGroups.map(({ group }) => group.id);
    const counts = await this.#db
      .select({ groupId: groupMembers.groupId, members: count() })
      .from(groupMembers)
      .where(and(inArray(groupMembers.groupId, ids), isNull(groupMembers.removedAt)))
      .groupBy(groupMembers.groupId);
    const countOf = new Map(counts.map((c) => [c.groupId, c.members]));
    const balances = await computeBalancesByGroup(this.#db, ids);

    return myGroups.map(({ group }) => ({
      id: group.id,
      name: group.name,
      groupType: group.groupType,
      defaultCurrency: group.defaultCurrency,
      simplifyDebts: group.simplifyDebts,
      memberCount: countOf.get(group.id) ?? 0,
      yourBalanceMinor: balances.get(group.id)?.get(userId) ?? 0,
    }));
  }

  async getGroupDetail(groupId: string, requestingUserId: string): Promise<GroupDetail> {
    await this.requireMembership(groupId, requestingUserId);

    const [group] = await this.#db.select().from(groups).where(eq(groups.id, groupId));
    if (!group || group.deletedAt) throw new GroupNotFoundError();

    const memberRows = await this.#db
      .select({ user: users, role: groupMembers.role, color: groupMembers.color })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.removedAt)))
      .orderBy(asc(groupMembers.joinedAt));

    const balances = await computeGroupBalances(this.#db, groupId);

    const members: GroupMember[] = memberRows.map(({ user, role, color }) => ({
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role,
      color,
      netBalanceMinor: balances.get(user.id) ?? 0,
    }));

    return {
      id: group.id,
      name: group.name,
      groupType: group.groupType,
      defaultCurrency: group.defaultCurrency,
      simplifyDebts: group.simplifyDebts,
      memberCount: members.length,
      yourBalanceMinor: balances.get(requestingUserId) ?? 0,
      members,
    };
  }

  /** Unified add-member: an existing active account is added directly; an
   * unrecognized email gets a placeholder account created immediately
   * (so it can be attached to group_members right away, per §5) plus an
   * emailed invite to claim it. */
  async addMember(groupId: string, email: string, inviterId: string): Promise<void> {
    await this.requireMembership(groupId, inviterId);

    const [group] = await this.#db.select().from(groups).where(eq(groups.id, groupId));
    if (!group || group.deletedAt) throw new GroupNotFoundError();

    let [user] = await this.#db.select().from(users).where(eq(users.email, email));
    if (user?.status === "suspended" || user?.status === "deleted") {
      throw new DomainError("This account cannot be added to a group", "account_unavailable");
    }

    if (user?.status === "active") {
      if (await this.isMember(groupId, user.id)) throw new AlreadyMemberError();
      await this.#upsertMember(this.#db, groupId, user.id);
      return;
    }

    // No account yet, or an unclaimed placeholder: (re)send an invite. An
    // invitee already in the group gets a fresh link rather than an error.
    await reserveInviteSend(this.#db, inviterId, email);

    const link = await this.#db.transaction(async (tx) => {
      if (!user) {
        // Another request may have just created the same placeholder.
        await tx
          .insert(users)
          .values({ email, displayName: email.split("@")[0] ?? email, status: "invited" })
          .onConflictDoNothing();
        [user] = await tx.select().from(users).where(eq(users.email, email));
      }
      if (!user) throw new Error("Placeholder missing after insert");
      await this.#upsertMember(tx, groupId, user.id);
      return createInviteLink(tx, this.#env, { inviterId, email, placeholderUserId: user.id, groupId });
    });

    const [inviter] = await this.#db.select().from(users).where(eq(users.id, inviterId));
    const inviterName = inviter?.displayName ?? "Someone";
    await this.#mailer.send({
      to: email,
      subject: `${inviterName} added you to "${group.name}" on Splitty`,
      text: `${inviterName} added you to the group "${group.name}" on Splitty.\n\nClick here to set up your account:\n\n${link}\n\nThis link expires in 7 days.`,
    });
  }

  /** A returning member reuses their old row (the key is group + user) and
   * rejoins as a plain member; a current member is left untouched. */
  async #upsertMember(db: Pick<Database, "insert">, groupId: string, userId: string): Promise<void> {
    await db
      .insert(groupMembers)
      .values({ groupId, userId, role: "member" })
      .onConflictDoUpdate({
        target: [groupMembers.groupId, groupMembers.userId],
        set: { removedAt: null, role: "member", joinedAt: new Date() },
        setWhere: isNotNull(groupMembers.removedAt),
      });
  }

  /** Only the owner may remove someone else; anyone may remove themselves.
   * §6: removal blocked while the member's net balance *within that
   * group* is nonzero — deliberately narrower than account deletion's
   * "balance with anyone, anywhere" guard. If the departing member is
   * the owner and others remain, ownership auto-transfers to whoever
   * has been a member the longest — a group with active members always
   * has exactly one owner. */
  async removeMember(groupId: string, targetUserId: string, requesterId: string): Promise<void> {
    await this.requireMembership(groupId, requesterId);

    await this.#db.transaction(async (tx) => {
      await lockGroup(tx, groupId);

      const [target] = await tx
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId), isNull(groupMembers.removedAt)));
      if (!target) throw new NotGroupMemberError();
      if (targetUserId !== requesterId) await this.#requireOwner(groupId, requesterId, tx);

      const balances = await computeGroupBalances(tx, groupId);
      const balance = balances.get(targetUserId) ?? 0;
      if (balance !== 0) {
        throw new NonzeroBalanceError(balance);
      }

      await tx
        .update(groupMembers)
        .set({ removedAt: new Date() })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

      if (target.role === "owner") {
        const [successor] = await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), ne(groupMembers.userId, targetUserId), isNull(groupMembers.removedAt)))
          .orderBy(asc(groupMembers.joinedAt))
          .limit(1);
        if (successor) {
          await tx
            .update(groupMembers)
            .set({ role: "owner" })
            .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, successor.userId)));
        }
      }
    });
  }

  /** Same balance guard as removeMember, just always targeting yourself. */
  async leaveGroup(groupId: string, userId: string): Promise<void> {
    await this.removeMember(groupId, userId, userId);
  }

  async #requireOwner(groupId: string, userId: string, db: Executor): Promise<void> {
    const [membership] = await db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)));
    if (!membership) throw new NotGroupMemberError();
    if (membership.role !== "owner") throw new NotGroupOwnerError();
  }

  /** Self-service only — a member sets their own color, never someone
   * else's. */
  async setMemberColor(groupId: string, userId: string, color: MemberColor | null): Promise<void> {
    await this.requireMembership(groupId, userId);
    await this.#db
      .update(groupMembers)
      .set({ color })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  }

  /** Only the group's current owner may delete it (role, not the
   * original creator — ownership can transfer, see removeMember), and
   * only once every current member's balance in the group is zero —
   * deleting a group with live debts in it would erase the only record
   * of who owes whom. Soft-deleted via the existing (previously unused)
   * deletedAt column, same pattern as expenses/settlements. */
  async deleteGroup(groupId: string, requesterId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await lockGroup(tx, groupId);
      await this.#requireOwner(groupId, requesterId, tx);

      const balances = await computeGroupBalances(tx, groupId);
      for (const balance of balances.values()) {
        if (balance !== 0) throw new GroupNotSettledError();
      }

      await tx.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, groupId));
    });
  }
}
