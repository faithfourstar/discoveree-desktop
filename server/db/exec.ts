/**
 * Raw-SQL result normalisation (ADR 001 risk 4).
 *
 * Typed through the seam's base-class `Db`, `db.execute()` returns an
 * driver-generic result, and the two drivers' result objects differ beyond
 * `.rows` (pglite: `affectedRows`; pg: `rowCount`). Ported raw-SQL call
 * sites must use this helper instead of depending on driver result shapes.
 */
import type { SQL } from "drizzle-orm";
import type { Db } from "./types.js";

export async function execRows<T extends Record<string, unknown> = Record<string, unknown>>(
  database: Db,
  query: SQL,
): Promise<T[]> {
  const result = (await database.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] }).rows;
  return rows ?? [];
}
