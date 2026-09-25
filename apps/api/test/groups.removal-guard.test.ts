import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("group member removal guard (docs/PLAN-PUBLIC.md §6)", () => {
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

  it("blocks removal while the member's net balance in the group is nonzero", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice5@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob5@example.com", password: "password123", displayName: "Bob" });

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Owes money", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob5@example.com" } });
    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: { description: "Rent", amountMinor: 2000, currency: "USD", paidBy: alice.userId, participantUserIds: [alice.userId, bob.userId] },
    });

    const removeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/groups/${group.id}/members/${bob.userId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(removeRes.statusCode).toBe(409);
    expect(removeRes.json().balanceMinor).toBe(-1000);

    // Bob is still a member — the block actually held, not just returned an error.
    const detailRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    expect(detailRes.json().memberCount).toBe(2);
  });

  it("a removed member loses read access — not just disappears from the member list", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice6@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob6@example.com", password: "password123", displayName: "Bob" });

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Clean split", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob6@example.com" } });

    // No expenses at all — Bob's balance is already zero, removable immediately.
    const removeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/groups/${group.id}/members/${bob.userId}`,
      headers: authHeader(alice.accessToken),
    });
    expect(removeRes.statusCode).toBe(204);

    // Bob's own read attempt must now fail — his old membership row still
    // exists (removed_at set), and the isolation check has to filter on
    // that, not just stop listing him for others.
    const bobReadRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(bob.accessToken) });
    expect(bobReadRes.statusCode).toBe(404);
  });
});
