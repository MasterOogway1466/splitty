import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("cross-account data isolation (docs/PLAN-PUBLIC.md §5/§12)", () => {
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

  it("group path: an excluded account cannot read or write a group it doesn't belong to", async () => {
    const bob = await createVerifiedUser(ctx, { email: "bob3@example.com", password: "password123", displayName: "Bob" });
    const carol = await createVerifiedUser(ctx, { email: "carol3@example.com", password: "password123", displayName: "Carol" });
    const mallory = await createVerifiedUser(ctx, { email: "mallory3@example.com", password: "password123", displayName: "Mallory" });

    const group = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/groups",
        headers: authHeader(bob.accessToken),
        payload: { name: "Bob and Carol's trip", defaultCurrency: "USD" },
      })
    ).json();
    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/members`,
      headers: authHeader(bob.accessToken),
      payload: { email: "carol3@example.com" },
    });

    // Mallory, uninvolved, must not be able to read the group at all.
    const readRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(mallory.accessToken) });
    expect(readRes.statusCode).toBe(404);

    // ...nor create an expense in it...
    const expenseRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(mallory.accessToken),
      payload: { description: "Sneaky", amountMinor: 100, currency: "USD", splitMethod: "equal", payers: [{ userId: mallory.userId, amountMinor: 100 }], participantUserIds: [mallory.userId] },
    });
    expect(expenseRes.statusCode).toBe(404);

    // ...nor add herself as a payer/participant on an expense inside it,
    // even as a legitimate member creating the expense.
    const injectRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(bob.accessToken),
      payload: {
        description: "Trying to rope in an outsider",
        amountMinor: 100,
        currency: "USD",
        splitMethod: "equal",
        payers: [{ userId: bob.userId, amountMinor: 100 }],
        participantUserIds: [bob.userId, mallory.userId],
      },
    });
    expect(injectRes.statusCode).toBe(404);

    // ...nor list its expenses.
    const listRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}/expenses`, headers: authHeader(mallory.accessToken) });
    expect(listRes.statusCode).toBe(404);
  });

  it("direct (non-group) path: an uninvolved account cannot see or write a direct expense/IOU between two others — no group to scope through", async () => {
    const bob = await createVerifiedUser(ctx, { email: "bob4@example.com", password: "password123", displayName: "Bob" });
    const carol = await createVerifiedUser(ctx, { email: "carol4@example.com", password: "password123", displayName: "Carol" });
    const mallory = await createVerifiedUser(ctx, { email: "mallory4@example.com", password: "password123", displayName: "Mallory" });

    // Bob paid for something Carol owes him for — a direct IOU, no group.
    const expenseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authHeader(bob.accessToken),
      payload: { description: "Concert ticket", amountMinor: 5000, currency: "USD", splitMethod: "equal", payers: [{ userId: bob.userId, amountMinor: 5000 }], participantUserIds: [bob.userId, carol.userId] },
    });
    expect(expenseRes.statusCode).toBe(201);

    // Mallory must not be able to create an expense that names herself
    // alongside two people who never involved her.
    const injectRes = await ctx.app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authHeader(mallory.accessToken),
      payload: { description: "Uninvited", amountMinor: 100, currency: "USD", splitMethod: "equal", payers: [{ userId: bob.userId, amountMinor: 100 }], participantUserIds: [carol.userId] },
    });
    expect(injectRes.statusCode).toBe(404);

    // Mallory's own direct-expense list must not include Bob and Carol's IOU.
    const listRes = await ctx.app.inject({ method: "GET", url: "/api/expenses", headers: authHeader(mallory.accessToken) });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual([]);

    // Bob and Carol's own lists, by contrast, do include it.
    const bobListRes = await ctx.app.inject({ method: "GET", url: "/api/expenses", headers: authHeader(bob.accessToken) });
    expect(bobListRes.json()).toHaveLength(1);
  });
});
