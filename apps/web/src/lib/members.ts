import type { MemberColor } from "@splitty/shared";

// A muted, paper-friendly palette distinct from the app's own ledger
// green / rust semantic colors, so a member's chosen color is never
// mistaken for a balance direction.
export const COLOR_SWATCH_CLASS: Record<MemberColor, string> = {
  red: "bg-[#c1443a]",
  orange: "bg-[#c97a35]",
  amber: "bg-[#c99a3b]",
  green: "bg-[#3f7d5c]",
  teal: "bg-[#2f8f80]",
  blue: "bg-[#3b6fa6]",
  indigo: "bg-[#5a5fa6]",
  purple: "bg-[#7a5aa6]",
  pink: "bg-[#b85a8a]",
  slate: "bg-[#6b7280]",
};

export interface Person {
  userId: string;
  displayName: string;
  color?: MemberColor | null;
}

export function personLabel(person: Person, currentUserId: string | undefined): string {
  const tags = [person.userId === currentUserId ? "you" : null, person.color ?? null].filter((t): t is string => t !== null);
  return tags.length ? `${person.displayName} (${tags.join(", ")})` : person.displayName;
}
