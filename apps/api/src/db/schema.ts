import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Users, sessions, tokens — docs/PLAN-PUBLIC.md §6
// ---------------------------------------------------------------------------

export const userStatusValues = ["active", "invited", "suspended", "deleted"] as const;
export type UserStatus = (typeof userStatusValues)[number];

// `is_admin`/`suspended` exist for exactly one purpose at this scale: the
// operator can flip a bad-actor account to `suspended` directly against
// the database — no admin UI planned through Phase 4.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Nullable: §2's tombstone rule clears it on deletion, and an invited
    // placeholder's email lives here as soon as the invite is created.
    email: text("email"),
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    defaultCurrency: text("default_currency").notNull().default("USD"),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status", { enum: userStatusValues }).notNull().default("active"),
    isAdmin: boolean("is_admin").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    // Partial unique index: tombstoned users have email cleared (§2), so
    // multiple deleted rows with null email must not collide.
    uniqueIndex("users_email_unique").on(table.email).where(sql`email is not null`),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("refresh_tokens_user_idx").on(table.userId),
    uniqueIndex("refresh_tokens_token_hash_idx").on(table.tokenHash),
  ],
);

export const emailTokenPurposeValues = ["verify", "reset"] as const;
export type EmailTokenPurpose = (typeof emailTokenPurposeValues)[number];

export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: text("purpose", { enum: emailTokenPurposeValues }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("email_tokens_token_hash_idx").on(table.tokenHash),
    index("email_tokens_user_purpose_idx").on(table.userId, table.purpose),
  ],
);

// ---------------------------------------------------------------------------
// Abuse surface — docs/PLAN-PUBLIC.md §4/§5: Postgres-backed, not Redis or
// an in-process counter (which wouldn't survive a container restart).
// ---------------------------------------------------------------------------

// One generic append-only event log, windowed by the caller: signup/login/
// password-reset-request per-IP and per-account, and the per-account
// email-send cap. `key` is whatever the caller is limiting by (an IP
// address, a user id, an email address).
export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("rate_limit_events_scope_key_time_idx").on(table.scope, table.key, table.createdAt)],
);

// Separate from the event log because lockout needs explicit state
// (escalating `locked_until`), not just a trailing-window count.
export const accountLockouts = pgTable("account_lockouts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Groups and membership — docs/PLAN-PUBLIC.md §6
// ---------------------------------------------------------------------------

export const groupTypeValues = ["trip", "house", "couple", "other"] as const;
export const splitMethodValues = ["equal", "exact", "percentage", "shares", "adjustment", "itemized"] as const;
export const groupRoleValues = ["member", "admin"] as const;
// A fixed palette rather than free-form hex: keeps every color legible
// (no picking near-white/unreadable values) and lets the frontend render
// a swatch from a small lookup table.
export const memberColorValues = ["red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink", "slate"] as const;

// Group membership is the access boundary for group-scoped data (§5) —
// whether `role` needs to be more than a plain member/admin split is
// still open (§16).
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  groupType: text("group_type", { enum: groupTypeValues }).notNull().default("other"),
  coverPhotoUrl: text("cover_photo_url"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  simplifyDebts: boolean("simplify_debts").notNull().default(false),
  defaultSplitMethod: text("default_split_method", { enum: splitMethodValues }).notNull().default("equal"),
  defaultSplitConfig: jsonb("default_split_config"),
  // Nullable: groups created before this column existed have no recorded
  // creator. Who may delete a group (below) is gated on this, so such a
  // group simply can't be deleted by anyone — acceptable since it only
  // affects pre-existing rows, never a newly created group.
  createdBy: uuid("created_by").references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: groupRoleValues }).notNull().default("member"),
    // Self-service only (§ member color) — lets someone tell two
    // same-named members apart; null means no color chosen yet.
    color: text("color", { enum: memberColorValues }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().default(sql`now()`),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

// Canonical ordering (userAId < userBId) is enforced at the application
// layer, not a DB constraint — unused until Phase 1's direct-expense/IOU
// path exists.
export const friendLinks = pgTable(
  "friend_links",
  {
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [primaryKey({ columns: [table.userAId, table.userBId] })],
);

// An invite creates a placeholder account (`placeholder_user_id`,
// status='invited') that group memberships and expense participants
// attach to immediately, and merges into a real account when the invitee
// completes signup with this token (§5).
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id),
    inviteeEmail: text("invitee_email").notNull(),
    placeholderUserId: uuid("placeholder_user_id")
      .notNull()
      .references(() => users.id),
    groupId: uuid("group_id").references(() => groups.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex("invites_token_hash_idx").on(table.tokenHash)],
);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
  name: text("name").notNull(),
  icon: text("icon"),
});

// Must match packages/shared/src/currency.ts's CURRENCY_MINOR_UNIT_EXPONENT
// table — seeded from the same list (apps/api/src/db/seed.ts).
export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  minorUnitExponent: integer("minor_unit_exponent").notNull(),
});

export const fxRateCache = pgTable(
  "fx_rate_cache",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [primaryKey({ columns: [table.base, table.quote] })],
);

// ---------------------------------------------------------------------------
// Recurring expense series
// ---------------------------------------------------------------------------

export const recurringFrequencyValues = ["weekly", "fortnightly", "monthly", "yearly"] as const;

export const recurringSeries = pgTable("recurring_series", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: uuid("group_id").references(() => groups.id),
  template: jsonb("template").notNull(),
  frequency: text("frequency", { enum: recurringFrequencyValues }).notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

// ---------------------------------------------------------------------------
// The ledger — docs/PLAN-PUBLIC.md §6/§7/§8
// ---------------------------------------------------------------------------

export const changeTypeValues = ["create", "update", "delete", "restore"] as const;

// An expense decomposes into payer rows and participant rows that sum to
// zero — balances are always an aggregation over these, never a stored
// column (§7). `id` is client-generated UUIDv7 (no DB default), not
// server-assigned: offline-created child rows (payers/participants/
// comments) need to reference it before any server round-trip (§8).
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id").references(() => groups.id),
    description: text("description").notNull(),
    notes: text("notes"),
    categoryId: uuid("category_id").references(() => categories.id),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    baseCurrency: text("base_currency").notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "number" }).notNull(),
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }).notNull(),
    fxRateFetchedAt: timestamp("fx_rate_fetched_at", { withTimezone: true }).notNull(),
    expenseDate: timestamp("expense_date", { withTimezone: true }).notNull(),
    splitMethod: text("split_method", { enum: splitMethodValues }).notNull(),
    recurringSeriesId: uuid("recurring_series_id").references(() => recurringSeries.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("expenses_group_idx").on(table.groupId)],
);

export const expensePayers = pgTable(
  "expense_payers",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.userId] })],
);

export const expenseParticipants = pgTable(
  "expense_participants",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    owedAmountMinor: bigint("owed_amount_minor", { mode: "number" }).notNull(),
    shareInput: jsonb("share_input"),
  },
  (table) => [primaryKey({ columns: [table.expenseId, table.userId] })],
);

export const expenseLineItems = pgTable("expense_line_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  expenseId: uuid("expense_id")
    .notNull()
    .references(() => expenses.id),
  description: text("description").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
});

export const expenseLineItemAssignments = pgTable(
  "expense_line_item_assignments",
  {
    lineItemId: uuid("line_item_id")
      .notNull()
      .references(() => expenseLineItems.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    share: numeric("share", { precision: 10, scale: 4 }).notNull().default("1"),
  },
  (table) => [primaryKey({ columns: [table.lineItemId, table.userId] })],
);

export const expenseComments = pgTable("expense_comments", {
  id: uuid("id").primaryKey(), // client-generated UUIDv7, see §8
  expenseId: uuid("expense_id")
    .notNull()
    .references(() => expenses.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const expenseEditHistory = pgTable("expense_edit_history", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  expenseId: uuid("expense_id")
    .notNull()
    .references(() => expenses.id),
  editedBy: uuid("edited_by")
    .notNull()
    .references(() => users.id),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull().default(sql`now()`),
  changeType: text("change_type", { enum: changeTypeValues }).notNull(),
  diff: jsonb("diff"),
});

export const settlementMethodValues = ["cash", "bank_transfer", "upi", "other"] as const;

// Kept in its own table/history view from expenses, per spec, even though
// it shares the payer→participant shape conceptually. `id` is
// client-generated UUIDv7, same rule as `expenses.id`.
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id").references(() => groups.id),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    baseCurrency: text("base_currency").notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "number" }).notNull(),
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }).notNull(),
    method: text("method", { enum: settlementMethodValues }).notNull(),
    note: text("note"),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("settlements_group_idx").on(table.groupId)],
);

// ---------------------------------------------------------------------------
// Activity feed and notifications
// ---------------------------------------------------------------------------

export const activityTypeValues = [
  "expense_created",
  "expense_updated",
  "expense_deleted",
  "comment_added",
  "settlement_created",
  "settlement_deleted",
] as const;

export const activityFeed = pgTable(
  "activity_feed",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    type: text("type", { enum: activityTypeValues }).notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    groupId: uuid("group_id").references(() => groups.id),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("activity_feed_recipient_idx").on(table.recipientId)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventType: text("event_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.userId, table.eventType] })],
);
