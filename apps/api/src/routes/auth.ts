import type { FastifyInstance, FastifyReply } from "fastify";
import {
  confirmPasswordResetSchema,
  loginRequestSchema,
  requestPasswordResetSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from "@splitwise/shared";
import { checkAndRecordRateLimit } from "../auth/rateLimit.js";
import { toUserProfile } from "../auth/service.js";
import { InvalidRefreshTokenError, RateLimitedError } from "../auth/errors.js";
import { authenticate } from "../plugins/authenticate.js";

const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { authService, env, db } = app;

  function setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: "lax",
      path: REFRESH_COOKIE_PATH,
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    });
  }

  function clearRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  // §5 Phase 0 requirement: rate limiting on signup, per-IP.
  app.post("/signup", async (request, reply) => {
    const rl = await checkAndRecordRateLimit(db, "signup_ip", request.ip, { windowSeconds: 3600, maxEvents: 5 });
    if (!rl.allowed) throw new RateLimitedError();

    const body = signupRequestSchema.parse(request.body);
    const { user } = await authService.signup(body);
    reply.status(201);
    return { userId: user.id, message: "verification email sent" as const };
  });

  app.post("/verify-email", async (request) => {
    const rl = await checkAndRecordRateLimit(db, "verify_email_ip", request.ip, { windowSeconds: 3600, maxEvents: 20 });
    if (!rl.allowed) throw new RateLimitedError();

    const body = verifyEmailRequestSchema.parse(request.body);
    await authService.verifyEmail(body.token);
    return { message: "email verified" };
  });

  // §5 Phase 0 requirement: rate limiting on login, per-IP and per-account
  // (distinct from lockout, which is a separate escalating-backoff guard
  // on the account itself — see auth/lockout.ts).
  app.post("/login", async (request, reply) => {
    const body = loginRequestSchema.parse(request.body);

    const ipCheck = await checkAndRecordRateLimit(db, "login_ip", request.ip, { windowSeconds: 60, maxEvents: 10 });
    if (!ipCheck.allowed) throw new RateLimitedError(60);
    const accountCheck = await checkAndRecordRateLimit(db, "login_account", body.email, { windowSeconds: 600, maxEvents: 20 });
    if (!accountCheck.allowed) throw new RateLimitedError(600);

    const { user, accessToken, refreshTokenRaw } = await authService.login(body);
    setRefreshCookie(reply, refreshTokenRaw);
    return { accessToken, user: toUserProfile(user) };
  });

  app.post("/refresh", async (request, reply) => {
    const rl = await checkAndRecordRateLimit(db, "refresh_ip", request.ip, { windowSeconds: 60, maxEvents: 30 });
    if (!rl.allowed) throw new RateLimitedError(60);

    const raw = request.cookies[REFRESH_COOKIE_NAME];
    if (!raw) {
      clearRefreshCookie(reply);
      throw new InvalidRefreshTokenError();
    }
    const { accessToken, refreshTokenRaw } = await authService.refresh(raw);
    setRefreshCookie(reply, refreshTokenRaw);
    return { accessToken };
  });

  app.post("/logout", async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE_NAME];
    if (raw) await authService.logout(raw);
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });

  // §5 Phase 0 requirement: rate limiting on password-reset-request,
  // per-IP and per-account. Always responds the same generic message
  // regardless of whether the email exists (auth/service.ts) — rate
  // limiting the request volume doesn't reopen that enumeration gap.
  app.post("/request-password-reset", async (request) => {
    const body = requestPasswordResetSchema.parse(request.body);

    const ipCheck = await checkAndRecordRateLimit(db, "reset_request_ip", request.ip, { windowSeconds: 3600, maxEvents: 5 });
    const accountCheck = await checkAndRecordRateLimit(db, "reset_request_account", body.email, {
      windowSeconds: 3600,
      maxEvents: 5,
    });
    if (!ipCheck.allowed || !accountCheck.allowed) throw new RateLimitedError(3600);

    await authService.requestPasswordReset(body.email);
    return { message: "if an account with that email exists, a reset link was sent" };
  });

  app.post("/confirm-password-reset", async (request) => {
    const rl = await checkAndRecordRateLimit(db, "reset_confirm_ip", request.ip, { windowSeconds: 3600, maxEvents: 10 });
    if (!rl.allowed) throw new RateLimitedError(3600);

    const body = confirmPasswordResetSchema.parse(request.body);
    await authService.confirmPasswordReset(body.token, body.newPassword);
    return { message: "password updated" };
  });

  app.get(
    "/me",
    { preHandler: (request, reply) => authenticate(app, request, reply) },
    async (request) => toUserProfile(request.currentUser!),
  );
}
