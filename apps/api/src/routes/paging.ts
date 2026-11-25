import { desc, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

const MAX_LIMIT = 100;

const cursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\.\d{6})?_[0-9a-f-]{36}$/, "Malformed cursor")
  .transform((value) => {
    const split = value.lastIndexOf("_");
    return { at: value.slice(0, split), id: value.slice(split + 1) };
  })
  .refine((c) => z.string().uuid().safeParse(c.id).success, "Malformed cursor")
  // Also rejects dates that merely look right, which Postgres would error on.
  .refine((c) => {
    const date = new Date(c.at.length === 10 ? `${c.at}T00:00:00Z` : `${c.at}Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(c.at.slice(0, 10));
  }, "Malformed cursor");

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  cursor: cursorSchema.optional(),
  deleted: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  with: z.string().uuid().optional(),
});

export type ListQuery = z.infer<typeof querySchema>;

export function listQuery(request: FastifyRequest): ListQuery {
  return querySchema.parse(request.query);
}

/** Newest first by `at`, ties by `id`, continuing strictly after the cursor. */
export function newestFirst(at: AnyColumn, id: AnyColumn, query: ListQuery): { where: SQL | undefined; orderBy: [SQL, SQL]; limit: number } {
  const type = at.getSQLType().startsWith("timestamp") ? sql`timestamp` : sql`date`;
  const atUtc = at.getSQLType().startsWith("timestamp") ? sql`(${at} at time zone 'UTC')` : sql`${at}`;
  return {
    where: query.cursor && sql`(${atUtc}, ${id}) < (cast(${query.cursor.at} as ${type}), cast(${query.cursor.id} as uuid))`,
    orderBy: [desc(at), desc(id)],
    // One extra row tells whether there is a next page.
    limit: query.limit + 1,
  };
}

export function toPage<Row>(rows: Row[], query: ListQuery, cursorOf: (row: Row) => string): { rows: Row[]; nextCursor: string | null } {
  const page = rows.slice(0, query.limit);
  return { rows: page, nextCursor: rows.length > query.limit ? cursorOf(page.at(-1)!) : null };
}

/** The exact (microsecond) timestamp, as the cursor needs it. */
export function cursorTimestamp(at: AnyColumn): SQL<string> {
  return sql<string>`to_char(${at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
}
