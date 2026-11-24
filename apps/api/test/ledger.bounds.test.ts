import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR } from "@splitty/shared";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("amount bounds on ledger writes", () => {
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

  it("rejects amounts too large for exact arithmetic, so one entry can't break another user's balances", async () => {
    const users = [];
    for (const name of ["a", "b", "c"]) {
      users.push(await createVerifiedUser(ctx, { email: `${name}@example.com`, password: "password123", displayName: name }));
    }
    const [a, b, c] = users as [(typeof users)[0], (typeof users)[0], (typeof users)[0]];
    const post = (url: string, payload: object) => ctx.app.inject({ method: "POST", url, headers: authHeader(a.accessToken), payload });
    const expense = (amountMinor: number, split: object) => ({
      description: "x", amountMinor, currency: "USD", payers: [{ userId: a.userId, amountMinor }], ...split,
    });
    const equal = { splitMethod: "equal", participantUserIds: users.map((u) => u.userId) };
    const shares = (n: number) => ({ splitMethod: "shares", participants: users.map((u, i) => ({ userId: u.userId, shares: n + i })) });
    const adjustment = (n: number) => ({
      splitMethod: "adjustment",
      participants: [{ userId: a.userId, adjustmentMinor: n }, { userId: b.userId, adjustmentMinor: -n }],
    });

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post("/api/expenses", expense(2 ** 53 + i * 1_000_002, equal))).statusCode);
    statuses.push((await post("/api/expenses", expense(MAX_AMOUNT_MINOR + 1, equal))).statusCode);
    statuses.push((await post("/api/expenses", expense(1000, shares(1e15)))).statusCode);
    statuses.push((await post("/api/expenses", expense(1000, adjustment(2 ** 60)))).statusCode);
    statuses.push((await post("/api/settlements", { fromUserId: a.userId, toUserId: b.userId, amountMinor: MAX_AMOUNT_MINOR + 1, currency: "USD" })).statusCode);
    const balanceStatuses = [];
    for (const u of [b, c]) {
      balanceStatuses.push((await ctx.app.inject({ method: "GET", url: "/api/balances/people", headers: authHeader(u.accessToken) })).statusCode);
    }
    expect(balanceStatuses).toEqual([200, 200]);
    expect(new Set(statuses)).toEqual(new Set([400]));
    expect((await post("/api/expenses", expense(MAX_AMOUNT_MINOR, equal))).statusCode).toBe(201);
  });
});
