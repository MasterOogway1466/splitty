import { Button } from "./Button.js";

export function LoadMore({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!query.hasNextPage) return null;
  return (
    <div className="border-t border-line p-3">
      <Button icon="chevronDown" className="w-full" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
        {query.isFetchingNextPage ? "Loading…" : "Show more"}
      </Button>
    </div>
  );
}
