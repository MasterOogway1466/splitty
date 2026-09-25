import { and, eq, isNull } from "drizzle-orm";
import type { GroupSummary, GroupDetail, GroupMember, MemberColor } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { groupMembers, groups, invites, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { generateOpaqueToken, hashOpaqueToken } from "../auth/tokens.js";
import { sendCappedEmail } from "../mail/capped.js";
import type { Mailer } from "../mail/mailer.js";
import { computeGroupBalances } from "../ledger/balances.js";
import {
  AlreadyMemberError,
  DomainError,
  GroupNotFoundError,
  GroupNotSettledError,
  NonzeroBalanceError,
  NotGroupCreatorError,
  NotGroupMemberError,
} from "./errors.js";

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
      await tx.insert(groupMembers).values({ groupId: group.id, userId: input.createdBy, role: "admin" });
      return group;
    });
  }

  /** docs/PLAN-PUBLIC.md §5: the access boundary — throws if `userId` is
   * not a current member (a removed member's old row must not grant
   * access, hence `removedAt` still null). */
  async requireMembership(groupId: string, userId: string): Promise<void> {
    const [row] = await this.#db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)));
    if (!row) throw new NotGroupMemberError();
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const [row] = await this.#db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)));
    return !!row;
  }

  async listMyGroups(userId: string): Promise<GroupSummary[]> {
    const memberships = await this.#db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.userId, userId), isNull(groupMembers.removedAt)));

    const summaries: GroupSummary[] = [];
    for (const { groupId } of memberships) {
      const [group] = await this.#db.select().from(groups).where(eq(groups.id, groupId));
      if (!group || group.deletedAt) continue;
      const memberCountRows = await this.#db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.removedAt)));
      const balances = await computeGroupBalances(this.#db, groupId);
      summaries.push({
        id: group.id,
        name: group.name,
        groupType: group.groupType,
        defaultCurrency: group.defaultCurrency,
        simplifyDebts: group.simplifyDebts,
        memberCount: memberCountRows.length,
        yourBalanceMinor: balances.get(userId) ?? 0,
      });
    }
    return summaries;
  }

  async getGroupDetail(groupId: string, requestingUserId: string): Promise<GroupDetail> {
    await this.requireMembership(groupId, requestingUserId);

    const [group] = await this.#db.select().from(groups).where(eq(groups.id, groupId));
    if (!group || group.deletedAt) throw new GroupNotFoundError();

    const memberRows = await this.#db
      .select({ userId: groupMembers.userId, role: groupMembers.role, color: groupMembers.color })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.removedAt)));

    const balances = await computeGroupBalances(this.#db, groupId);

    const members: GroupMember[] = [];
    for (const row of memberRows) {
      const [user] = await this.#db.select().from(users).where(eq(users.id, row.userId));
      if (!user) continue;
      members.push({
        userId: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: row.role,
        color: row.color,
        netBalanceMinor: balances.get(user.id) ?? 0,
      });
    }

    return {
      id: group.id,
      name: group.name,
      groupType: group.groupType,
      defaultCurrency: group.defaultCurrency,
      simplifyDebts: group.simplifyDebts,
      memberCount: members.length,
      yourBalanceMinor: balances.get(requestingUserId) ?? 0,
      members,
      createdByUserId: group.createdBy,
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

    const [existingUser] = await this.#db.select().from(users).where(eq(users.email, email));

    if (existingUser) {
      if (existingUser.status === "suspended" || existingUser.status === "deleted") {
        throw new DomainError("This account cannot be added to a group", "account_unavailable");
      }
      if (await this.isMember(groupId, existingUser.id)) {
        throw new AlreadyMemberError();
      }
      await this.#db.insert(groupMembers).values({ groupId, userId: existingUser.id, role: "member" });
      return;
    }

    // No account with this email at all: create the placeholder + invite.
    const [placeholder] = await this.#db
      .insert(users)
      .values({ email, displayName: email.split("@")[0] ?? email, status: "invited" })
      .returning();
    if (!placeholder) throw new Error("Insert returned no row");

    await this.#db.insert(groupMembers).values({ groupId, userId: placeholder.id, role: "member" });

    const rawToken = generateOpaqueToken();
    await this.#db.insert(invites).values({
      inviterId,
      inviteeEmail: email,
      placeholderUserId: placeholder.id,
      groupId,
      tokenHash: hashOpaqueToken(rawToken),
      expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    });

    const [inviter] = await this.#db.select().from(users).where(eq(users.id, inviterId));
    const link = `${this.#env.APP_ORIGIN}/accept-invite?token=${rawToken}`;
    await sendCappedEmail(this.#db, this.#mailer, placeholder.id, {
      to: email,
      subject: `${inviter?.displayName ?? "Someone"} added you to "${group.name}" on Splitty`,
      text: `${inviter?.displayName ?? "Someone"} added you to the group "${group.name}" on Splitty.\n\nClick here to set up your account:\n\n${link}\n\nThis link expires in 7 days.`,
    });
  }

  /** §6: removal blocked while the member's net balance *within that
   * group* is nonzero — deliberately narrower than account deletion's
   * "balance with anyone, anywhere" guard. */
  async removeMember(groupId: string, targetUserId: string, requesterId: string): Promise<void> {
    await this.requireMembership(groupId, requesterId);
    await this.requireMembership(groupId, targetUserId);

    const balances = await computeGroupBalances(this.#db, groupId);
    const balance = balances.get(targetUserId) ?? 0;
    if (balance !== 0) {
      throw new NonzeroBalanceError(balance);
    }

    await this.#db
      .update(groupMembers)
      .set({ removedAt: new Date() })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));
  }

  /** Same balance guard as removeMember, just always targeting yourself. */
  async leaveGroup(groupId: string, userId: string): Promise<void> {
    await this.removeMember(groupId, userId, userId);
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

  /** Only the group's recorded creator may delete it, and only once
   * every current member's balance in the group is zero — deleting a
   * group with live debts in it would erase the only record of who owes
   * whom. Soft-deleted via the existing (previously unused) deletedAt
   * column, same pattern as expenses/settlements. */
  async deleteGroup(groupId: string, requesterId: string): Promise<void> {
    await this.requireMembership(groupId, requesterId);

    const [group] = await this.#db.select().from(groups).where(eq(groups.id, groupId));
    if (!group || group.deletedAt) throw new GroupNotFoundError();
    if (group.createdBy !== requesterId) throw new NotGroupCreatorError();

    const balances = await computeGroupBalances(this.#db, groupId);
    for (const balance of balances.values()) {
      if (balance !== 0) throw new GroupNotSettledError();
    }

    await this.#db.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, groupId));
  }
}
