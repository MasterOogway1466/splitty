import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rateLimitEvents, users } from "../src/db/schema.js";
import { createTestContext, truncateAuthTables, type TestContext } from "./setup.js";

describe("abuse surface (docs/PLAN-PUBLIC.md §5/§12)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await truncateAuthTables(ctx.db);
    ctx.mailer.sent.length = 0;
  });

  it("rate-limits rapid-fire login attempts from the same IP (10/60s)", async () => {
    let sawRateLimited = false;
    for (let i = 0; i < 15; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@example.com", password: "whatever-password" },
      });
      if (res.statusCode === 429) {
        sawRateLimited = true;
        expect(res.headers["retry-after"]).toBeDefined();
        break;
      }
      expect(res.statusCode).toBe(401);
    }
    expect(sawRateLimited).toBe(true);
  });

  it("locks the account out after repeated failed logins, independent of IP rate limiting", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "dana@example.com", password: "right-password-1", displayName: "Dana" },
    });

    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "dana@example.com", password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt, even with the CORRECT password, is locked out.
    const lockedRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "dana@example.com", password: "right-password-1" },
    });
    expect(lockedRes.statusCode).toBe(423);
    expect(lockedRes.headers["retry-after"]).toBeDefined();
  });

  it("rejects a suspended account's authenticated request outright, not just scoped to no data", async () => {
    const signupRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "erin@example.com", password: "password-one-two", displayName: "Erin" },
    });
    const { userId } = signupRes.json();

    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "erin@example.com", password: "password-one-two" },
    });
    const { accessToken } = loginRes.json();

    const meBefore = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meBefore.statusCode).toBe(200);

    // Operator suspends the account directly against the database (§6 —
    // no admin UI planned through Phase 4).
    await ctx.db.update(users).set({ status: "suspended" }).where(eq(users.id, userId));

    const meAfter = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meAfter.statusCode).toBe(403);

    const loginAfterSuspend = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "erin@example.com", password: "password-one-two" },
    });
    expect(loginAfterSuspend.statusCode).toBe(403);
  });

  it("suppresses email sends once the per-account email-send cap is hit", async () => {
    const signupRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "frank@example.com", password: "password-one-two", displayName: "Frank" },
    });
    const { userId } = signupRes.json();
    ctx.mailer.sent.length = 0;

    // Pre-seed the daily cap (20/day) as already exhausted for this user,
    // rather than actually sending 20 emails in the test.
    await ctx.db.insert(rateLimitEvents).values(Array.from({ length: 20 }, () => ({ scope: "email_send", key: userId })));

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "frank@example.com" },
    });
    // Still looks like success to the caller — the cap is an internal
    // guard and must not leak account state via a different response.
    expect(res.statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(0);
  });
});
