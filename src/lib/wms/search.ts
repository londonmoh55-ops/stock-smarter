/** Case-insensitive match when query is non-empty; empty query matches everything. */
export function matchesSearch(query: string, ...parts: (string | number | undefined | null)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return parts.some((p) => String(p ?? "").toLowerCase().includes(q));
}

/** Filter table/object rows by stringifying all values. */
export function filterRecordRows<T extends Record<string, unknown>>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)),
  );
}
