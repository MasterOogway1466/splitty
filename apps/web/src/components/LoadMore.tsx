import { linkButtonClass } from "./styles.js";

export function LoadMore({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!query.hasNextPage) return null;
  return (
    <div className="px-4 py-3 border-t border-line">
      <button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage} className={linkButtonClass}>
        {query.isFetchingNextPage ? "Loading…" : "Show more"}
      </button>
    </div>
  );
}
