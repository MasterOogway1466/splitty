import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("currency validation on ledger writes", () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;
  let groupId: string;
  let otherId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await truncateAllTestTables(ctx.db);
    ctx.mailer.sent.length = 0;
    ({ accessToken: token, userId } = await createVerifiedUser(ctx, { email: "cur-a@example.com", password: "password123", displayName: "A" }));
    ({ userId: otherId } = await createVerifiedUser(ctx, { email: "cur-b@example.com", password: "password123", displayName: "B" }));
    groupId = (await send("/api/groups", { name: "Trip", defaultCurrency: "USD" })).json().id;
    await send(`/api/groups/${groupId}/members`, { email: "cur-b@example.com" });
  });

  function send(url: string, payload: object) {
    return ctx.app.inject({ method: "POST", url, headers: authHeader(token), payload });
  }
  const expense = (currency: string) => ({
    description: "x", amountMinor: 1000, currency, splitMethod: "equal",
    payers: [{ userId, amountMinor: 1000 }], participantUserIds: [userId, otherId],
  });
  const settlement = (currency: string) => ({ fromUserId: otherId, toUserId: userId, amountMinor: 1000, currency });

  it("rejects a group expense or settlement in a currency other than the group's", async () => {
    for (const res of [
      await send(`/api/groups/${groupId}/expenses`, expense("JPY")),
      await send(`/api/groups/${groupId}/settlements`, settlement("JPY")),
    ]) {
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("currency_mismatch");
    }
  });

  it("rejects unsupported currencies everywhere", async () => {
    for (const prefix of [`/api/groups/${groupId}`, "/api"]) {
      for (const res of [await send(`${prefix}/expenses`, expense("ZZZ")), await send(`${prefix}/settlements`, settlement("ZZZ"))]) {
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe("validation_error");
      }
    }
  });

  it("accepts the group's currency, and any supported currency on direct entries", async () => {
    expect((await send(`/api/groups/${groupId}/expenses`, expense("USD"))).statusCode).toBe(201);
    expect((await send(`/api/groups/${groupId}/settlements`, settlement("USD"))).statusCode).toBe(201);
    expect((await send("/api/expenses", expense("JPY"))).statusCode).toBe(201);
  });
});
