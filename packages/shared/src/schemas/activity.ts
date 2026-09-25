import { z } from "zod";

export const activityTypeValues = [
  "expense_created",
  "expense_updated",
  "expense_deleted",
  "comment_added",
  "settlement_created",
  "settlement_deleted",
] as const;

export const activityItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(activityTypeValues),
  actorId: z.string().uuid(),
  actorDisplayName: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  groupName: z.string().nullable(),
  createdAt: z.string(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
