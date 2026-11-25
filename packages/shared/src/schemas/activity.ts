import { z } from "zod";

export const activityTypeValues = [
  "expense_created",
  "expense_updated",
  "expense_deleted",
  "expense_restored",
  "comment_added",
  "settlement_created",
  "settlement_updated",
  "settlement_deleted",
  "settlement_restored",
  "group_updated",
  "group_archived",
  "group_unarchived",
  "group_deleted",
  "group_restored",
  "member_added",
  "member_removed",
] as const;

export const activityItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(activityTypeValues),
  actorId: z.string().uuid(),
  actorDisplayName: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  // Null once the reader can no longer open the entity.
  entityLabel: z.string().nullable(),
  groupId: z.string().uuid().nullable(),
  groupName: z.string().nullable(),
  createdAt: z.string(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
