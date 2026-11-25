import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSettlement } from "../src/ledger/settlements.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };
type Balance = { currency: string; netMinor: number };

describe("pairwise attribution with multiple payers (docs/PLAN-PUBLIC.md §7)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await truncateAllTestTables(ctx.db);
    ctx.mailer.sent.length = 0;
  });

  async function get(user: User, url: string) {
    const res = await ctx.app.inject({ method: "GET", url, headers: authHeader(user.accessToken) });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function post(user: User, url: string, payload: object) {
    const res = await ctx.app.inject({ method: "POST", url, headers: authHeader(user.accessToken), payload });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.statusCode === 204 ? null : res.json();
  }

  async function setupGroup(names: string[]): Promise<{ users: User[]; groupId: string }> {
    const users: User[] = [];
    for (const name of names) {
      users.push(await createVerifiedUser(ctx, { email: `${name}@example.com`, password: "password123", displayName: name }));
    }
    const group = await post(users[0]!, "/api/groups", { name: "Trip", defaultCurrency: "USD" });
    for (const name of names.slice(1)) await post(users[0]!, `/api/groups/${group.id}/members`, { email: `${name}@example.com` });
    return { users, groupId: group.id };
  }

  async function pairwise(from: User, to: User): Promise<number> {
    const balances: Balance[] = await get(from, `/api/balances/${to.userId}`);
    return balances.reduce((sum, b) => sum + b.netMinor, 0);
  }

  it("divides a participant's debt between the payers instead of charging it once per payer", async () => {
    const { users, groupId } = await setupGroup(["a", "b", "c"]);
    const [a, b, c] = users as [User, User, User];
    await post(a, `/api/groups/${groupId}/expenses`, {
      description: "Dinner", amountMinor: 9000, currency: "USD", splitMethod: "equal",
      payers: [{ userId: a.userId, amountMinor: 4500 }, { userId: b.userId, amountMinor: 4500 }],
      participantUserIds: [a.userId, b.userId, c.userId],
    });
    expect(await pairwise(c, a)).toBe(-1500);
    expect(await pairwise(c, b)).toBe(-1500);
    expect(await pairwise(a, b)).toBe(0);
  });

  it("a payer who paid less than their share is a debtor, not a creditor", async () => {
    const { users, groupId } = await setupGroup(["a", "b", "c"]);
    const [a, b, c] = users as [User, User, User];
    await post(a, `/api/groups/${groupId}/expenses`, {
      description: "Dinner", amountMinor: 9000, currency: "USD", splitMethod: "equal",
      payers: [{ userId: a.userId, amountMinor: 8000 }, { userId: b.userId, amountMinor: 1000 }],
      participantUserIds: [a.userId, b.userId, c.userId],
    });
    expect(await pairwise(b, a)).toBe(-2000);
    expect(await pairwise(c, a)).toBe(-3000);
    expect(await pairwise(c, b)).toBe(0);
  });

  it("pairwise balances are antisymmetric and sum to the global balance across random expenses", async () => {
    const { users, groupId } = await setupGroup(["a", "b", "c", "d"]);
    let seed = 42;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let i = 0; i < 25; i++) {
      const payers = users.filter(() => rand(1000) < 500);
      if (payers.length === 0) payers.push(users[0]!);
      const participants = users.filter(() => rand(1000) < 700);
      if (participants.length === 0) participants.push(users[1]!);
      const payerRows = payers.map((p) => ({ userId: p.userId, amountMinor: 1 + rand(5000) }));
      const weighted = participants.map((p) => ({ userId: p.userId, shares: 1 + rand(5) }));
      await post(users[0]!, `/api/groups/${groupId}/expenses`, {
        description: `e${i}`, amountMinor: payerRows.reduce((s, p) => s + p.amountMinor, 0), currency: "USD",
        payers: payerRows, splitMethod: "shares", participants: weighted,
      });
    }
    await post(users[0]!, `/api/groups/${groupId}/settlements`, {
      fromUserId: users[0]!.userId, toUserId: users[1]!.userId, amountMinor: 777, currency: "USD",
    });
    // Rejected by the API now, but rows recorded before that may exist.
    await createSettlement(ctx.db, {
      groupId, fromUserId: users[2]!.userId, toUserId: users[2]!.userId, amountMinor: 333, currency: "USD",
      method: "other", note: null, settledAt: "2026-01-01", createdBy: users[2]!.userId,
    });
    for (const user of users) {
      const global = ((await get(user, "/api/balances")) as Balance[]).reduce((s, b) => s + b.netMinor, 0);
      let total = 0;
      for (const other of users) {
        if (other === user) continue;
        const forward = await pairwise(user, other);
        expect(forward + (await pairwise(other, user))).toBe(0);
        total += forward;
      }
      expect(total).toBe(global);
    }
  });

  it("rejects a settlement from someone to themselves", async () => {
    const { users, groupId } = await setupGroup(["a"]);
    const payload = { fromUserId: users[0]!.userId, toUserId: users[0]!.userId, amountMinor: 100, currency: "USD" };
    for (const url of ["/api/settlements", `/api/groups/${groupId}/settlements`]) {
      const res = await ctx.app.inject({ method: "POST", url, headers: authHeader(users[0]!.accessToken), payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("keeps a former co-member in the people list while a pairwise balance remains", async () => {
    const { users, groupId } = await setupGroup(["a", "b", "c"]);
    const [a, b, c] = users as [User, User, User];
    const expense = (payer: User, participant: User) =>
      post(a, `/api/groups/${groupId}/expenses`, {
        description: "x", amountMinor: 1000, currency: "USD", splitMethod: "equal",
        payers: [{ userId: payer.userId, amountMinor: 1000 }], participantUserIds: [participant.userId],
      });
    // b owes a and is owed by c: net zero in the group, so b may leave.
    await expense(a, b);
    await expense(b, c);
    await post(b, `/api/groups/${groupId}/leave`, {});
    const people = (await get(a, "/api/balances/people")) as Array<{ userId: string; balances: Balance[] }>;
    expect(people.find((p) => p.userId === b.userId)?.balances).toEqual([{ currency: "USD", netMinor: 1000 }]);
  });
});
