import cookie from "@fastify/cookie";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AuthService } from "./auth/service.js";
import {
  AccountLockedError,
  AccountSuspendedError,
  AuthError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidOrExpiredTokenError,
  InvalidRefreshTokenError,
  RateLimitedError,
  UnauthenticatedError,
} from "./auth/errors.js";
import type { Database } from "./db/client.js";
import type { Env } from "./env.js";
import type { Mailer } from "./mail/mailer.js";
import { registerAuthRoutes } from "./routes/auth.js";

export interface BuildAppOptions {
  db: Database;
  mailer: Mailer;
  env: Env;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  // trustProxy: true because production traffic arrives via Caddy
  // (docs/PLAN-PUBLIC.md §11) — request.ip must reflect the real client
  // address for per-IP rate limiting to mean anything.
  const app = Fastify({
    logger: opts.env.NODE_ENV !== "test",
    trustProxy: true,
  });

  await app.register(cookie);

  app.decorate("db", opts.db);
  app.decorate("env", opts.env);
  app.decorate("authService", new AuthService(opts.db, opts.mailer, opts.env));

  // Registered before any routes: awaiting a plugin registration (below)
  // finalizes that plugin's routing tree immediately, so a handler added
  // afterward would not reliably apply to routes registered before it.
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "validation_error", message: error.issues.map((i) => i.message).join("; ") });
    }
    if (error instanceof RateLimitedError) {
      reply.header("Retry-After", String(error.retryAfterSeconds));
      return reply.status(429).send({ error: error.code, message: error.message });
    }
    if (error instanceof AccountLockedError) {
      const retryAfterSeconds = Math.max(0, Math.ceil((error.lockedUntil.getTime() - Date.now()) / 1000));
      reply.header("Retry-After", String(retryAfterSeconds));
      return reply.status(423).send({ error: error.code, message: error.message, retryAfterSeconds });
    }
    if (error instanceof AccountSuspendedError) {
      return reply.status(403).send({ error: error.code, message: error.message });
    }
    if (error instanceof EmailAlreadyRegisteredError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }
    if (error instanceof InvalidCredentialsError || error instanceof InvalidRefreshTokenError || error instanceof UnauthenticatedError) {
      return reply.status(401).send({ error: error.code, message: error.message });
    }
    if (error instanceof InvalidOrExpiredTokenError) {
      return reply.status(400).send({ error: error.code, message: error.message });
    }
    if (error instanceof AuthError) {
      return reply.status(400).send({ error: error.code, message: error.message });
    }
    if ("validation" in error && error.validation) {
      return reply.status(400).send({ error: "validation_error", message: error.message });
    }
    // Fastify's own internal errors (malformed JSON body, unsupported
    // media type, payload too large, etc.) already carry a correct
    // client-error statusCode — respect it instead of defaulting
    // everything unrecognized to 500. Only a genuinely uncaught error
    // (no statusCode at all) falls through to a real 500.
    const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    request.log.error(error);
    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: "bad_request", message: error.message });
    }
    return reply.status(500).send({ error: "internal_error", message: "Something went wrong" });
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(registerAuthRoutes, { prefix: "/api/auth" });

  return app;
}
