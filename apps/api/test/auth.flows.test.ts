import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAuthTables, type TestContext } from "./setup.js";

function extractToken(text: string): string {
  const match = text.match(/token=([\w-]+)/);
  if (!match?.[1]) throw new Error(`No token found in mail text: ${text}`);
  return match[1];
}

describe("auth flows (docs/PLAN-PUBLIC.md §12)", () => {
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

  it("signup -> verify -> login -> me -> refresh (rotated) -> logout", async () => {
    const signupRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "alice@example.com", password: "correct horse battery staple", displayName: "Alice" },
    });
    expect(signupRes.statusCode).toBe(201);
    expect(signupRes.json().userId).toBeDefined();
    expect(ctx.mailer.sent).toHaveLength(1);
    const verifyToken = extractToken(ctx.mailer.sent[0]!.text);

    // Login works before verification — verification gates group actions
    // in Phase 1+, not the ability to log in at all.
    const preVerifyLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "alice@example.com", password: "correct horse battery staple" },
    });
    expect(preVerifyLogin.statusCode).toBe(200);
    expect(preVerifyLogin.json().user.emailVerified).toBe(false);

    const verifyRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/verify-email",
      payload: { token: verifyToken },
    });
    expect(verifyRes.statusCode).toBe(200);

    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "alice@example.com", password: "correct horse battery staple" },
    });
    expect(loginRes.statusCode).toBe(200);
    const { accessToken, user } = loginRes.json();
    expect(user.emailVerified).toBe(true);
    const refreshCookie = loginRes.cookies.find((c) => c.name === "refresh_token");
    expect(refreshCookie).toBeDefined();

    const meRes = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().email).toBe("alice@example.com");

    const refreshRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refresh_token: refreshCookie!.value },
    });
    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.json().accessToken).toBeDefined();
    const rotatedCookie = refreshRes.cookies.find((c) => c.name === "refresh_token");
    expect(rotatedCookie).toBeDefined();
    expect(rotatedCookie!.value).not.toBe(refreshCookie!.value);

    // Rotation means the OLD refresh token is now dead.
    const reuseOldRefresh = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refresh_token: refreshCookie!.value },
    });
    expect(reuseOldRefresh.statusCode).toBe(401);

    const logoutRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { refresh_token: rotatedCookie!.value },
    });
    expect(logoutRes.statusCode).toBe(204);

    const refreshAfterLogout = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refresh_token: rotatedCookie!.value },
    });
    expect(refreshAfterLogout.statusCode).toBe(401);
  });

  it("a bodyless POST with a JSON content-type header doesn't 500 (regression: browser session-restore sends Content-Type on every request, including bodyless ones)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      headers: { "content-type": "application/json" },
      // deliberately no payload — this is what a bodyless fetch() POST
      // with an explicit Content-Type header produces on the wire.
    });
    // Fastify's own body parser rejects this before the route even runs
    // ("Body cannot be empty when content-type is set to application/json"),
    // and that's a legitimate 400 — the bug this guards against was the
    // error handler's catch-all turning that into an unhandled 500
    // instead of passing through Fastify's own statusCode.
    expect(res.statusCode).toBe(400);
  });

  it("rejects signup with an already-registered email", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "bob@example.com", password: "password12345", displayName: "Bob" },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "bob@example.com", password: "password12345", displayName: "Bob Two" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("password reset: request -> confirm -> old password dead, old sessions revoked", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "carol@example.com", password: "original-password-1", displayName: "Carol" },
    });
    ctx.mailer.sent.length = 0;

    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "carol@example.com", password: "original-password-1" },
    });
    const oldRefreshCookie = loginRes.cookies.find((c) => c.name === "refresh_token")!;

    const resetReqRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "carol@example.com" },
    });
    expect(resetReqRes.statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(1);
    const resetToken = extractToken(ctx.mailer.sent[0]!.text);

    const confirmRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/confirm-password-reset",
      payload: { token: resetToken, newPassword: "brand-new-password-1" },
    });
    expect(confirmRes.statusCode).toBe(200);

    const oldPasswordLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "carol@example.com", password: "original-password-1" },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "carol@example.com", password: "brand-new-password-1" },
    });
    expect(newPasswordLogin.statusCode).toBe(200);

    // The session that existed before the reset must not survive it.
    const refreshOldSession = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { refresh_token: oldRefreshCookie.value },
    });
    expect(refreshOldSession.statusCode).toBe(401);
  });

  it("password-reset-request never reveals whether the email exists", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "nobody-registered@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(0);
  });
});
