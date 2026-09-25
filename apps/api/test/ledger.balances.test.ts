import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("balance aggregation across groups and direct expenses (docs/PLAN-PUBLIC.md §7)", () => {
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

  it("pairwise balance sums across two shared groups plus a direct expense, all same currency", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice9@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob9@example.com", password: "password123", displayName: "Bob" });

    // Group 1: Alice pays $20, split with Bob -> Bob owes Alice $10.
    const group1 = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "G1", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group1.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob9@example.com" } });
    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group1.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: { description: "G1 expense", amountMinor: 2000, currency: "USD", splitMethod: "equal", payers: [{ userId: alice.userId, amountMinor: 2000 }], participantUserIds: [alice.userId, bob.userId] },
    });

    // Group 2: Bob pays $6, split with Alice -> Alice owes Bob $3.
    const group2 = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(bob.accessToken), payload: { name: "G2", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group2.id}/members`, headers: authHeader(bob.accessToken), payload: { email: "alice9@example.com" } });
    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group2.id}/expenses`,
      headers: authHeader(bob.accessToken),
      payload: { description: "G2 expense", amountMinor: 600, currency: "USD", splitMethod: "equal", payers: [{ userId: bob.userId, amountMinor: 600 }], participantUserIds: [alice.userId, bob.userId] },
    });

    // Direct: Alice pays $5 for something only Bob owes her for entirely
    // (Bob is the sole participant) -> Bob owes Alice $5.
    await ctx.app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authHeader(alice.accessToken),
      payload: { description: "Direct IOU", amountMinor: 500, currency: "USD", splitMethod: "equal", payers: [{ userId: alice.userId, amountMinor: 500 }], participantUserIds: [bob.userId] },
    });

    // Net: Bob owes Alice 1000 (G1) - 300 (G2, i.e. Alice owes Bob 300) + 500 (direct) = 1200.
    const pairwiseRes = await ctx.app.inject({ method: "GET", url: `/api/balances/${bob.userId}`, headers: authHeader(alice.accessToken) });
    expect(pairwiseRes.statusCode).toBe(200);
    const balances = pairwiseRes.json() as Array<{ currency: string; netMinor: number }>;
    expect(balances).toEqual([{ currency: "USD", netMinor: 1200 }]);

    // Symmetric from Bob's side.
    const reverseRes = await ctx.app.inject({ method: "GET", url: `/api/balances/${alice.userId}`, headers: authHeader(bob.accessToken) });
    expect(reverseRes.json()).toEqual([{ currency: "USD", netMinor: -1200 }]);

    // friend_links: the direct expense should have linked them, making
    // them show up in each other's /api/balances/people.
    const peopleRes = await ctx.app.inject({ method: "GET", url: "/api/balances/people", headers: authHeader(alice.accessToken) });
    const people = peopleRes.json() as Array<{ userId: string }>;
    expect(people.map((p) => p.userId)).toContain(bob.userId);
  });

  it("global balance reflects paid, owed, and settlements across everything", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice10@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob10@example.com", password: "password123", displayName: "Bob" });

    await ctx.app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authHeader(alice.accessToken),
      payload: { description: "Direct", amountMinor: 1000, currency: "USD", splitMethod: "equal", payers: [{ userId: alice.userId, amountMinor: 1000 }], participantUserIds: [alice.userId, bob.userId] },
    });
    // Alice is owed 500. Bob pays her back 200 of it.
    await ctx.app.inject({
      method: "POST",
      url: "/api/settlements",
      headers: authHeader(bob.accessToken),
      payload: { fromUserId: bob.userId, toUserId: alice.userId, amountMinor: 200, currency: "USD" },
    });

    const aliceGlobal = await ctx.app.inject({ method: "GET", url: "/api/balances", headers: authHeader(alice.accessToken) });
    expect(aliceGlobal.json()).toEqual([{ currency: "USD", netMinor: 300 }]);

    const bobGlobal = await ctx.app.inject({ method: "GET", url: "/api/balances", headers: authHeader(bob.accessToken) });
    expect(bobGlobal.json()).toEqual([{ currency: "USD", netMinor: -300 }]);
  });
});
