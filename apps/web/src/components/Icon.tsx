// One stroke weight and one 16px grid, so icons read as a set beside 14px text.
const PATHS = {
  plus: "M8 3v10M3 8h10",
  close: "M4 4l8 8M12 4l-8 8",
  settings: "M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M10 3.5v3M6 9.5v3",
  archive: "M2.5 3.5h11v3h-11zM3.5 6.5v6.5h9V6.5M6.5 9h3",
  leave: "M6.5 2.5h-4v11h4M6 8h7.5M10.5 5l3 3-3 3",
  trash: "M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9M6.7 7v4M9.3 7v4",
  edit: "M3 13l.6-2.9L10.8 3l2.2 2.2-7.1 7.1zM9.3 4.5l2.2 2.2",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  restore: "M3 3v3.5h3.5M3.3 6.3A5.3 5.3 0 1 1 2.8 9",
  settle: "M2.5 5.5h9.5M9.5 3l2.5 2.5L9.5 8M13.5 10.5H4M6.5 8L4 10.5 6.5 13",
  chevronRight: "M6 3.5L10.5 8 6 12.5",
  chevronDown: "M3.5 6L8 10.5 12.5 6",
  chevronLeft: "M10 3.5L5.5 8l4.5 4.5",
  mail: "M2.5 3.5h11v9h-11zM2.5 4.5L8 9l5.5-4.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
