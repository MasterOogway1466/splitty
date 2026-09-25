import { z } from "zod";
import { passwordSchema } from "./auth.js";

export const inviteInfoSchema = z.object({
  inviteeEmail: z.string().email(),
  inviterDisplayName: z.string(),
  groupName: z.string().nullable(),
  expired: z.boolean(),
  alreadyAccepted: z.boolean(),
});
export type InviteInfo = z.infer<typeof inviteInfoSchema>;

export const acceptInviteRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;
