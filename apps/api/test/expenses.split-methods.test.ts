import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("expense split methods and multi-payer (Phase 2 sub-project A)", () => {
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

  async function setupGroup(prefix: string) {
    const alice = await createVerifiedUser(ctx, { email: `${prefix}-alice@example.com`, password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: `${prefix}-bob@example.com`, password: "password123", displayName: "Bob" });
    const carol = await createVerifiedUser(ctx, { email: `${prefix}-carol@example.com`, password: "password123", displayName: "Carol" });
    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Trip", defaultCurrency: "USD" } })
    ).json();
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: `${prefix}-bob@example.com` } });
    await ctx.app.inject({ method: "POST", url: `/api/groups/${group.id}/members`, headers: authHeader(alice.accessToken), payload: { email: `${prefix}-carol@example.com` } });
    return { alice, bob, carol, group };
  }

  function balanceOf(members: { userId: string; netBalanceMinor: number }[], userId: string): number {
    return members.find((m) => m.userId === userId)!.netBalanceMinor;
  }

  it("exact split: each participant owes exactly what was entered", async () => {
    const { alice, bob, carol, group } = await setupGroup("exact");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 3000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 3000 }],
        splitMethod: "exact",
        participants: [
          { userId: alice.userId, amountMinor: 1000 },
          { userId: bob.userId, amountMinor: 1200 },
          { userId: carol.userId, amountMinor: 800 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) })).json();
    expect(balanceOf(detail.members, alice.userId)).toBe(2000); // paid 3000, owed 1000
    expect(balanceOf(detail.members, bob.userId)).toBe(-1200);
    expect(balanceOf(detail.members, carol.userId)).toBe(-800);
  });

  it("percentage split: divides by entered percentages", async () => {
    const { alice, bob, group } = await setupGroup("pct");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Rent", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "percentage",
        participants: [
          { userId: alice.userId, percentage: 60 },
          { userId: bob.userId, percentage: 40 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) })).json();
    expect(balanceOf(detail.members, alice.userId)).toBe(400); // paid 1000, owed 600
    expect(balanceOf(detail.members, bob.userId)).toBe(-400);
  });

  it("shares split: divides proportional to share weights", async () => {
    const { alice, bob, group } = await setupGroup("shares");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Groceries", amountMinor: 300, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 300 }],
        splitMethod: "shares",
        participants: [
          { userId: alice.userId, shares: 2 },
          { userId: bob.userId, shares: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) })).json();
    expect(balanceOf(detail.members, alice.userId)).toBe(100); // paid 300, owed 200 (2/3 of 300)
    expect(balanceOf(detail.members, bob.userId)).toBe(-100); // owed 100 (1/3 of 300)
  });

  it("adjustment split: base equal share plus a per-person adjustment", async () => {
    const { alice, bob, group } = await setupGroup("adj");
    // Total 1000: Bob gets a +200 adjustment (e.g. he had an extra item),
    // the remaining 800 splits equally (400 each).
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Shopping", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "adjustment",
        participants: [
          { userId: alice.userId, adjustmentMinor: 0 },
          { userId: bob.userId, adjustmentMinor: 200 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) })).json();
    expect(balanceOf(detail.members, alice.userId)).toBe(600); // paid 1000, owed 400
    expect(balanceOf(detail.members, bob.userId)).toBe(-600); // owed 400 + 200 adjustment
  });

  it("multiple payers: each payer's balance reflects their own contribution", async () => {
    const { alice, bob, carol, group } = await setupGroup("multipay");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Hotel", amountMinor: 900, currency: "USD",
        payers: [
          { userId: alice.userId, amountMinor: 600 },
          { userId: bob.userId, amountMinor: 300 },
        ],
        splitMethod: "equal",
        participantUserIds: [alice.userId, bob.userId, carol.userId],
      },
    });
    expect(res.statusCode).toBe(201);
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) })).json();
    // Equal split of 900 among 3 = 300 each.
    expect(balanceOf(detail.members, alice.userId)).toBe(300); // paid 600, owed 300
    expect(balanceOf(detail.members, bob.userId)).toBe(0); // paid 300, owed 300
    expect(balanceOf(detail.members, carol.userId)).toBe(-300); // paid 0, owed 300
  });

  it("rejects payer amounts that don't sum to the total", async () => {
    const { alice, bob, group } = await setupGroup("badpayers");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 400 }, { userId: bob.userId, amountMinor: 400 }],
        splitMethod: "equal",
        participantUserIds: [alice.userId, bob.userId],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
  });

  it("rejects a duplicate payer userId", async () => {
    const { alice, group } = await setupGroup("duppayer");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 500 }, { userId: alice.userId, amountMinor: 500 }],
        splitMethod: "equal",
        participantUserIds: [alice.userId],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
  });

  it("rejects a duplicate participant userId", async () => {
    const { alice, bob, group } = await setupGroup("dupparticipant");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "exact",
        participants: [{ userId: bob.userId, amountMinor: 500 }, { userId: bob.userId, amountMinor: 500 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
  });

  it("rejects exact amounts that don't sum to the total", async () => {
    const { alice, bob, group } = await setupGroup("badexact");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "exact",
        participants: [{ userId: alice.userId, amountMinor: 400 }, { userId: bob.userId, amountMinor: 400 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
    expect(res.json().message).toContain("800"); // states the actual sum (400+400), not just "invalid"
  });

  it("rejects percentages that don't sum to 100", async () => {
    const { alice, bob, group } = await setupGroup("badpct");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Rent", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "percentage",
        participants: [{ userId: alice.userId, percentage: 33 }, { userId: bob.userId, percentage: 33 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
    expect(res.json().message).toContain("66"); // states the actual sum (33+33), not just "invalid"
  });

  it("rejects adjustments that exceed the total", async () => {
    const { alice, bob, group } = await setupGroup("badadj");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Shopping", amountMinor: 500, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 500 }],
        splitMethod: "adjustment",
        participants: [{ userId: alice.userId, adjustmentMinor: 0 }, { userId: bob.userId, adjustmentMinor: 600 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
  });

  it("rejects a negative adjustment that would leave a participant owing a negative amount", async () => {
    // Total 1000, split between A and B. A's adjustment is -1500 (bigger
    // than the whole total). Remainder = 1000 - (-1500 + 0) = 2500, which
    // is still non-negative, so the "adjustments exceed the total" guard
    // alone does not catch this. But the equal base share of that
    // remainder is 1250 each, so A's own owed amount is 1250 + (-1500) =
    // -250: a false debt in A's favor rather than a rejected request. A
    // per-participant negative-share check is required to catch it.
    const { alice, bob, group } = await setupGroup("negadj");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Shopping", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "adjustment",
        participants: [{ userId: alice.userId, adjustmentMinor: -1500 }, { userId: bob.userId, adjustmentMinor: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_split");
  });

  it("rejects a non-member listed as a participant in a non-equal split", async () => {
    const { alice, group } = await setupGroup("nonmemberparticipant");
    const outsider = await createVerifiedUser(ctx, { email: "nonmemberparticipant-dave@example.com", password: "password123", displayName: "Dave" });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "exact",
        participants: [{ userId: alice.userId, amountMinor: 500 }, { userId: outsider.userId, amountMinor: 500 }],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_group_member");
  });

  it("supports a non-equal split on a direct (non-group) expense", async () => {
    const alice = await createVerifiedUser(ctx, { email: "directexact-alice@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "directexact-bob@example.com", password: "password123", displayName: "Bob" });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Direct dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 1000 }],
        splitMethod: "exact",
        participants: [{ userId: alice.userId, amountMinor: 300 }, { userId: bob.userId, amountMinor: 700 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const balancesRes = await ctx.app.inject({ method: "GET", url: `/api/balances/${bob.userId}`, headers: authHeader(alice.accessToken) });
    const balances = balancesRes.json() as Array<{ currency: string; netMinor: number }>;
    expect(balances).toEqual([{ currency: "USD", netMinor: 700 }]); // Alice paid 1000, owed 300 -> owed 700 by Bob
  });

  it("rejects a non-member listed as an extra payer", async () => {
    const { alice, group } = await setupGroup("nonmemberpayer");
    const outsider = await createVerifiedUser(ctx, { email: "nonmemberpayer-dave@example.com", password: "password123", displayName: "Dave" });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/expenses`,
      headers: authHeader(alice.accessToken),
      payload: {
        description: "Dinner", amountMinor: 1000, currency: "USD",
        payers: [{ userId: alice.userId, amountMinor: 500 }, { userId: outsider.userId, amountMinor: 500 }],
        splitMethod: "equal",
        participantUserIds: [alice.userId],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_group_member");
  });
});
