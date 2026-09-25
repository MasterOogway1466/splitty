import { z } from "zod";

export const groupTypeValues = ["trip", "house", "couple", "other"] as const;
export const groupRoleValues = ["member", "admin"] as const;

export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  groupType: z.enum(groupTypeValues).default("other"),
  defaultCurrency: z.string().length(3).default("USD"),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const addGroupMemberRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type AddGroupMemberRequest = z.infer<typeof addGroupMemberRequestSchema>;

export const groupMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(groupRoleValues),
  // This member's own net position within the group (paid - owed, adjusted
  // for settlements), in the group's default currency's minor units.
  // Positive = the group owes them; negative = they owe the group.
  netBalanceMinor: z.number().int(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  groupType: z.enum(groupTypeValues),
  defaultCurrency: z.string(),
  simplifyDebts: z.boolean(),
  memberCount: z.number().int(),
  // The requesting user's own net position within this group.
  yourBalanceMinor: z.number().int(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupDetailSchema = groupSummarySchema.extend({
  members: z.array(groupMemberSchema),
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;
