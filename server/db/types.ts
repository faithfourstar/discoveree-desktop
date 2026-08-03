import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@shared/schema";

/**
 * The one database type the rest of the codebase is allowed to name.
 *
 * `drizzle-orm/pglite` returns `PgliteDatabase<TSchema>` and
 * `drizzle-orm/node-postgres` returns `NodePgDatabase<TSchema>`, but both
 * extend `PgDatabase<PgQueryResultHKT, TSchema>`, which carries the full
 * query builder, `execute()`, and `transaction()`. Typing the seam as the
 * common base class means storage code compiles identically against either
 * driver, and `tsc` enforces that nothing driver-specific leaks.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
