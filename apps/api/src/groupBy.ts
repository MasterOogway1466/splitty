/** Linear, unlike filtering the whole list once per key. */
export function groupBy<Row>(rows: Row[], keyOf: (row: Row) => string): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  for (const row of rows) {
    const group = result.get(keyOf(row));
    if (group) group.push(row);
    else result.set(keyOf(row), [row]);
  }
  return result;
}
