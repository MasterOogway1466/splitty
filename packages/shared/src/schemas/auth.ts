import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(320);
// Length only — no composition rules. Composition rules push users toward
// predictable patterns; argon2id + rate limiting (docs/PLAN-PUBLIC.md §5)
// carry the actual security weight here.
export const passwordSchema = z.string().min(8).max(200);

export const signupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const signupResponseSchema = z.object({
  userId: z.string().uuid(),
  message: z.literal("verification email sent"),
});
export type SignupResponse = z.infer<typeof signupResponseSchema>;

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  defaultCurrency: z.string().length(3),
  timezone: z.string(),
  emailVerified: z.boolean(),
  isAdmin: z.boolean(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: userProfileSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
export type RequestPasswordReset = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ConfirmPasswordReset = z.infer<typeof confirmPasswordResetSchema>;

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
