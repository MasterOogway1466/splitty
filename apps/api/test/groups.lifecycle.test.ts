import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("group leave / delete / member color", () => {
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

  it("blocks leaving while your own balance in the group is nonzero, allows it once settled", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice7@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob7@example.com", password: "password123", displayName: "Bob" });

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Trip", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob7@example.com" } });
    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: { description: "Hotel", amountMinor: 4000, currency: "USD", paidBy: alice.userId, participantUserIds: [alice.userId, bob.userId] },
    });

    const blockedRes = await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/leave`, headers: authHeader(bob.accessToken) });
    expect(blockedRes.statusCode).toBe(409);
    expect(blockedRes.json().balanceMinor).toBe(-2000);

    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/settlements`,
      headers: authHeader(alice.accessToken),
      payload: { fromUserId: bob.userId, toUserId: alice.userId, amountMinor: 2000, currency: "USD", method: "other" },
    });

    const leaveRes = await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/leave`, headers: authHeader(bob.accessToken) });
    expect(leaveRes.statusCode).toBe(204);

    const bobReadRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(bob.accessToken) });
    expect(bobReadRes.statusCode).toBe(404);
  });

  it("only the owner can delete the group, and only once everyone is settled", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice8@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob8@example.com", password: "password123", displayName: "Bob" });

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "House", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob8@example.com" } });

    // Bob isn't the owner — blocked regardless of balances.
    const notOwnerRes = await ctx.app.inject({ method: "DELETE", url: `/api/groups/${group.id}`, headers: authHeader(bob.accessToken) });
    expect(notOwnerRes.statusCode).toBe(403);
    expect(notOwnerRes.json().error).toBe("not_group_owner");

    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: { description: "Groceries", amountMinor: 2000, currency: "USD", paidBy: alice.userId, participantUserIds: [alice.userId, bob.userId] },
    });

    // Alice created it, but Bob's balance is still nonzero.
    const notSettledRes = await ctx.app.inject({ method: "DELETE", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    expect(notSettledRes.statusCode).toBe(409);
    expect(notSettledRes.json().error).toBe("group_not_settled");

    await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/settlements`,
      headers: authHeader(alice.accessToken),
      payload: { fromUserId: bob.userId, toUserId: alice.userId, amountMinor: 1000, currency: "USD", method: "other" },
    });

    const deleteRes = await ctx.app.inject({ method: "DELETE", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    expect(deleteRes.statusCode).toBe(204);

    // Gone for everyone, including the creator who deleted it.
    const aliceReadRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    expect(aliceReadRes.statusCode).toBe(404);
    const listRes = await ctx.app.inject({ method: "GET", url: "/api/groups", headers: authHeader(alice.accessToken) });
    expect(listRes.json()).toEqual([]);
  });

  it("auto-transfers ownership to the longest-tenured remaining member when the owner leaves", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice10@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob10@example.com", password: "password123", displayName: "Bob" });
    const carol = await createVerifiedUser(ctx, { email: "carol10@example.com", password: "password123", displayName: "Carol" });

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Trio", defaultCurrency: "USD" } })
    ).json();
    // Joined in order: Bob, then Carol — Bob should be next in line.
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob10@example.com" } });
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "carol10@example.com" } });

    const leaveRes = await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/leave`, headers: authHeader(alice.accessToken) });
    expect(leaveRes.statusCode).toBe(204);

    const detailRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(bob.accessToken) });
    const members = detailRes.json().members as { userId: string; role: string }[];
    expect(members.find((m) => m.userId === bob.userId)?.role).toBe("owner");
    expect(members.find((m) => m.userId === carol.userId)?.role).toBe("member");

    // Bob, the new owner, can now delete the group; Carol still can't.
    const carolDeleteRes = await ctx.app.inject({ method: "DELETE", url: `/api/groups/${group.id}`, headers: authHeader(carol.accessToken) });
    expect(carolDeleteRes.statusCode).toBe(403);
    const bobDeleteRes = await ctx.app.inject({ method: "DELETE", url: `/api/groups/${group.id}`, headers: authHeader(bob.accessToken) });
    expect(bobDeleteRes.statusCode).toBe(204);
  });

  it("lets a member set their own color, visible to the whole group, but rejects an unknown color", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice9@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob9@example.com", password: "password123", displayName: "Bob" });

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Roomies", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: "bob9@example.com" } });

    const setColorRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/groups/${group.id}/color`,
      headers: authHeader(bob.accessToken),
      payload: { color: "teal" },
    });
    expect(setColorRes.statusCode).toBe(204);

    const detailRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    const members = detailRes.json().members as { userId: string; color: string | null }[];
    expect(members.find((m) => m.userId === bob.userId)?.color).toBe("teal");
    expect(members.find((m) => m.userId === alice.userId)?.color).toBeNull();

    const invalidRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/groups/${group.id}/color`,
      headers: authHeader(bob.accessToken),
      payload: { color: "ultraviolet" },
    });
    expect(invalidRes.statusCode).toBe(400);
  });
});
