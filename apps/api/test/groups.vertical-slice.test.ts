import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("Phase 1 vertical slice (docs/PLAN-PUBLIC.md §15)", () => {
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

  it("create group -> add existing member -> equal-split expense -> correct balances -> settle -> zeroed -> remove", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob@example.com", password: "password123", displayName: "Bob" });

    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/groups",
      headers: authHeader(alice.accessToken),
      payload: { name: "Trip", groupType: "trip", defaultCurrency: "USD" },
    });
    expect(createRes.statusCode).toBe(201);
    const group = createRes.json();

    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/members`,
      headers: authHeader(alice.accessToken),
      payload: { email: "bob@example.com" },
    });
    expect(addRes.statusCode).toBe(204);

    const detailRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().memberCount).toBe(2);

    // Alice pays $100, split equally between Alice and Bob.
    const expenseRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner",
        amountMinor: 10000,
        currency: "USD",
        splitMethod: "equal",
        payers: [{ userId: alice.userId, amountMinor: 10000 }],
        participantUserIds: [alice.userId, bob.userId],
      },
    });
    expect(expenseRes.statusCode).toBe(201);

    const detail2 = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    const members2 = detail2.json().members as Array<{ userId: string; netBalanceMinor: number }>;
    expect(members2.find((m) => m.userId === alice.userId)?.netBalanceMinor).toBe(5000);
    expect(members2.find((m) => m.userId === bob.userId)?.netBalanceMinor).toBe(-5000);

    // Bob settles up.
    const settleRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/settlements`,
      headers: authHeader(bob.accessToken),
      payload: { fromUserId: bob.userId, toUserId: alice.userId, amountMinor: 5000, currency: "USD" },
    });
    expect(settleRes.statusCode).toBe(201);

    const detail3 = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    const members3 = detail3.json().members as Array<{ userId: string; netBalanceMinor: number }>;
    expect(members3.find((m) => m.userId === alice.userId)?.netBalanceMinor).toBe(0);
    expect(members3.find((m) => m.userId === bob.userId)?.netBalanceMinor).toBe(0);

    // Now that Bob is settled, he can be removed.
    const removeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/groups/${group.id}/members/${bob.userId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(removeRes.statusCode).toBe(204);
  });

  it("uneven split assigns the leftover cent deterministically (largest-remainder)", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice2@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob2@example.com", password: "password123", displayName: "Bob" });
    const carol = await createVerifiedUser(ctx, { email: "carol2@example.com", password: "password123", displayName: "Carol" });

    const group = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/groups",
        headers: authHeader(alice.accessToken),
        payload: { name: "Trio", defaultCurrency: "USD" },
      })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob2@example.com" } });
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "carol2@example.com" } });

    // $10.00 split three ways: 334 / 333 / 333, lowest user id wins the extra cent.
    const ids = [alice.userId, bob.userId, carol.userId].sort();
    const expenseRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: { description: "Snacks", amountMinor: 1000, currency: "USD", splitMethod: "equal", payers: [{ userId: alice.userId, amountMinor: 1000 }], participantUserIds: ids },
    });
    const expense = expenseRes.json();
    const shares = new Map(expense.participants.map((p: { userId: string; owedAmountMinor: number }) => [p.userId, p.owedAmountMinor]));
    expect(shares.get(ids[0])).toBe(334);
    expect(shares.get(ids[1])).toBe(333);
    expect(shares.get(ids[2])).toBe(333);
    expect((shares.get(ids[0]) as number) + (shares.get(ids[1]) as number) + (shares.get(ids[2]) as number)).toBe(1000);
  });
});
