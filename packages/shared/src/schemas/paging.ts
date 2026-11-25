/** One page of a list; pass `nextCursor` back for the next. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
