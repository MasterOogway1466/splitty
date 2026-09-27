import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

describe("profile update (PATCH /api/auth/me)", () => {
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

  it("updates displayName, defaultCurrency, and timezone, and the change persists", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice@example.com", password: "password123", displayName: "Alice" });

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: authHeader(alice.accessToken),
      payload: { displayName: "Alicia", defaultCurrency: "EUR", timezone: "Europe/Berlin" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({ displayName: "Alicia", defaultCurrency: "EUR", timezone: "Europe/Berlin" });

    const meRes = await ctx.app.inject({ method: "GET", url: "/api/auth/me", headers: authHeader(alice.accessToken) });
    expect(meRes.json()).toMatchObject({ displayName: "Alicia", defaultCurrency: "EUR", timezone: "Europe/Berlin" });
  });

  it("supports a partial update, leaving other fields unchanged", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice2@example.com", password: "password123", displayName: "Alice" });

    const patchRes = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: authHeader(alice.accessToken),
      payload: { displayName: "Alicia" },
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json();
    expect(body.displayName).toBe("Alicia");
    expect(body.defaultCurrency).toBe("USD"); // unchanged default
  });

  it("requires authentication", async () => {
    const res = await ctx.app.inject({ method: "PATCH", url: "/api/auth/me", payload: { displayName: "Nobody" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed currency code", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice3@example.com", password: "password123", displayName: "Alice" });
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: authHeader(alice.accessToken),
      payload: { defaultCurrency: "EU" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a well-formed but unsupported currency code", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice5@example.com", password: "password123", displayName: "Alice" });
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: authHeader(alice.accessToken),
      payload: { defaultCurrency: "ZZZ" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty display name", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice4@example.com", password: "password123", displayName: "Alice" });
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: authHeader(alice.accessToken),
      payload: { displayName: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
