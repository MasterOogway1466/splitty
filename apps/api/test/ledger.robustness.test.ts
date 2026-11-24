import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { groupMembers, groups } from "../src/db/schema.js";
import { createExpense } from "../src/ledger/expenses.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000001";

describe("ledger robustness (docs/PLAN-PUBLIC.md §0b D10–D13)", () => {
  let ctx: TestContext;
  let a: User;
  let b: User;
  let groupId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await truncateAllTestTables(ctx.db);
    a = await createVerifiedUser(ctx, { email: "a@example.com", password: "password123", displayName: "a" });
    b = await createVerifiedUser(ctx, { email: "b@example.com", password: "password123", displayName: "b" });
    groupId = (await call(a, "POST", "/api/groups", { name: "G", defaultCurrency: "USD" })).json().id;
    await call(a, "POST", `/api/groups/${groupId}/members`, { email: "b@example.com" });
  });

  const call = (user: User, method: "GET" | "POST" | "DELETE" | "PATCH", url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: authHeader(user.accessToken), ...(payload ? { payload } : {}) });
  const expense = (extra: object = {}) => ({
    description: "x", amountMinor: 1000, currency: "USD", splitMethod: "equal",
    payers: [{ userId: a.userId, amountMinor: 1000 }], participantUserIds: [a.userId, b.userId], ...extra,
  });
  const settlement = (extra: object = {}) => ({ fromUserId: b.userId, toUserId: a.userId, amountMinor: 200, currency: "USD", ...extra });
  const balance = async (user: User) => (await call(user, "GET", "/api/balances")).json()[0]?.netMinor ?? 0;

  describe("D10: bad references are client errors", () => {
    it("rejects malformed ids in URLs", async () => {
      for (const res of [
        await call(a, "GET", "/api/groups/nope"),
        await call(a, "GET", "/api/groups/nope/expenses"),
        await call(a, "POST", "/api/groups/nope/expenses", expense()),
        await call(a, "GET", "/api/groups/nope/settlements"),
        await call(a, "GET", "/api/groups/nope/activity"),
        await call(a, "DELETE", "/api/groups/nope"),
        await call(a, "DELETE", `/api/groups/${groupId}/members/nope`),
        await call(a, "GET", "/api/balances/nope"),
      ]) {
        expect([res.statusCode, res.json().error]).toEqual([400, "validation_error"]);
      }
    });

    it("rejects an unknown category, in groups and directly", async () => {
      for (const url of [`/api/groups/${groupId}/expenses`, "/api/expenses"]) {
        const res = await call(a, "POST", url, expense({ categoryId: UNKNOWN_ID }));
        expect([res.statusCode, res.json().error]).toEqual([400, "unknown_category"]);
      }
    });
  });

  describe("D11: exact split inputs", () => {
    it("rejects percentages and shares finer than two decimals", async () => {
      const people = [a.userId, b.userId];
      for (const split of [
        { splitMethod: "percentage", participants: people.map((userId, i) => ({ userId, percentage: i ? 33.333 : 66.667 })) },
        { splitMethod: "shares", participants: people.map((userId) => ({ userId, shares: 1.001 })) },
      ]) {
        expect((await call(a, "POST", `/api/groups/${groupId}/expenses`, expense(split))).statusCode).toBe(400);
      }
      const ok = { splitMethod: "percentage", participants: people.map((userId, i) => ({ userId, percentage: i ? 33.33 : 66.67 })) };
      expect((await call(a, "POST", `/api/groups/${groupId}/expenses`, expense(ok))).statusCode).toBe(201);
    });
  });

  describe("D12: guards cannot be raced", () => {
    const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 300))]);

    it("leaving waits for an in-flight expense, then sees it", async () => {
      let leave!: ReturnType<typeof call>;
      await ctx.db.transaction(async (tx) => {
        await tx.select().from(groups).where(eq(groups.id, groupId)).for("no key update");
        await createExpense(tx, {
          groupId, description: "x", notes: null, amountMinor: 1000, currency: "USD", categoryId: null, expenseDate: new Date(),
          payers: [{ userId: a.userId, amountMinor: 1000 }], split: { splitMethod: "equal", participantUserIds: [b.userId] }, createdBy: a.userId,
        });
        leave = call(b, "POST", `/api/groups/${groupId}/leave`);
        expect(await settled(leave as Promise<unknown>)).toBe(false);
      });
      expect((await leave).statusCode).toBe(409);
    });

    it("an expense or settlement waits for an in-flight removal, then is refused", async () => {
      let writes!: ReturnType<typeof call>[];
      await ctx.db.transaction(async (tx) => {
        await tx.select().from(groups).where(eq(groups.id, groupId)).for("no key update");
        await tx
          .update(groupMembers)
          .set({ removedAt: new Date() })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, b.userId)));
        writes = [
          call(a, "POST", `/api/groups/${groupId}/expenses`, expense()),
          call(a, "POST", `/api/groups/${groupId}/settlements`, settlement()),
        ];
        expect(await settled(Promise.race(writes as Promise<unknown>[]))).toBe(false);
      });
      for (const write of writes) expect((await write).statusCode).toBe(404);
    });

    it("concurrent pay-downs of a debt a mutual contact recorded cannot overshoot it", async () => {
      const c = await createVerifiedUser(ctx, { email: "c@example.com", password: "password123", displayName: "c" });
      const other = (await call(a, "POST", "/api/groups", { name: "H", defaultCurrency: "USD" })).json().id;
      await call(a, "POST", `/api/groups/${other}/members`, { email: "c@example.com" });
      const owed = expense({ payers: [{ userId: b.userId, amountMinor: 1000 }], participantUserIds: [a.userId, c.userId] });
      expect((await call(a, "POST", "/api/expenses", owed)).statusCode).toBe(201);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => call(c, "POST", "/api/settlements", { fromUserId: c.userId, toUserId: b.userId, amountMinor: 500, currency: "USD" })),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(await balance(c)).toBe(0);
    });
  });

  describe("D13: client-supplied ids make retries safe", () => {
    const targets = () =>
      [
        [`/api/groups/${groupId}/expenses`, expense],
        ["/api/expenses", expense],
        [`/api/groups/${groupId}/settlements`, settlement],
        ["/api/settlements", settlement],
      ] as const;

    it("replaying the same request returns the original and changes nothing", async () => {
      for (const [url, body] of targets()) {
        const id = uuidv7();
        const first = await call(a, "POST", url, body({ id }));
        expect([first.statusCode, first.json().id]).toEqual([201, id]);
        const before = await balance(a);
        const replay = await call(a, "POST", url, body({ id }));
        expect(replay.statusCode).toBe(200);
        expect(replay.json()).toEqual(first.json());
        expect(await balance(a)).toBe(before);
      }
    });

    it("concurrent duplicates record once", async () => {
      for (const [url, body] of targets()) {
        const id = uuidv7();
        const codes = (await Promise.all(Array.from({ length: 4 }, () => call(a, "POST", url, body({ id }))))).map((r) => r.statusCode);
        expect(codes.sort()).toEqual([200, 200, 200, 201]);
      }
    });

    it("refuses an id reused by someone else, for different content, or elsewhere", async () => {
      for (const [url, body] of targets()) {
        const id = uuidv7();
        await call(a, "POST", url, body({ id }));
        expect((await call(b, "POST", url, body({ id }))).statusCode).toBe(409);
        expect((await call(a, "POST", url, body({ id, amountMinor: 1000, currency: "USD", note: "n", notes: "n" }))).statusCode).toBe(409);
      }
      const id = uuidv7();
      await call(a, "POST", "/api/expenses", expense({ id }));
      expect((await call(a, "POST", `/api/groups/${groupId}/expenses`, expense({ id }))).statusCode).toBe(409);
    });

    it("a replay still succeeds after a participant has left", async () => {
      const id = uuidv7();
      const body = expense({ id, participantUserIds: [a.userId] });
      const withB = { ...body, payers: [{ userId: b.userId, amountMinor: 1000 }], participantUserIds: [b.userId] };
      const url = `/api/groups/${groupId}/expenses`;
      expect((await call(a, "POST", url, withB)).statusCode).toBe(201);
      expect((await call(b, "POST", `/api/groups/${groupId}/leave`)).statusCode).toBe(204);
      expect((await call(a, "POST", url, withB)).statusCode).toBe(200);
    });

    it("only accepts version 7 ids, and still generates one when omitted", async () => {
      expect((await call(a, "POST", "/api/expenses", expense({ id: UNKNOWN_ID }))).statusCode).toBe(400);
      expect((await call(a, "POST", "/api/expenses", expense())).json().id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    });
  });
});
