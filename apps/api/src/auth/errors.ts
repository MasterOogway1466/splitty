export class AuthError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("Invalid email or password", "invalid_credentials");
  }
}

export class AccountLockedError extends AuthError {
  readonly lockedUntil: Date;
  constructor(lockedUntil: Date) {
    super("Account temporarily locked after repeated failed attempts", "account_locked");
    this.lockedUntil = lockedUntil;
  }
}

export class AccountSuspendedError extends AuthError {
  constructor() {
    super("Account suspended", "account_suspended");
  }
}

export class EmailAlreadyRegisteredError extends AuthError {
  constructor() {
    super("Email is already registered", "email_already_registered");
  }
}

export class InvalidOrExpiredTokenError extends AuthError {
  constructor() {
    super("Invalid or expired token", "invalid_token");
  }
}

export class InvalidRefreshTokenError extends AuthError {
  constructor() {
    super("Invalid or expired refresh token", "invalid_refresh_token");
  }
}

export class UnauthenticatedError extends AuthError {
  constructor() {
    super("Authentication required", "unauthenticated");
  }
}

export class RateLimitedError extends AuthError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super("Too many requests", "rate_limited");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
