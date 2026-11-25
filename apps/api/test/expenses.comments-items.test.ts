import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expenseLineItems } from "../src/db/schema.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };
type Row = { userId: string; owedAmountMinor: number };

describe("comments and itemized splits (docs/PLAN-PUBLIC.md Phase 2E)", () => {
  let ctx: TestContext;
  let a: User;
  let b: User;
  let c: User;
  let groupId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  const make = (name: string) => createVerifiedUser(ctx, { email: `${name}@example.com`, password: "password123", displayName: name });
  beforeEach(async () => {
    await truncateAllTestTables(ctx.db);
    a = await make("a");
    b = await make("b");
    c = await make("c");
    groupId = (await call(a, "POST", "/api/groups", { name: "G", defaultCurrency: "USD" })).json().id;
    for (const m of ["b", "c"]) await call(a, "POST", `/api/groups/${groupId}/members`, { email: `${m}@example.com` });
  });

  const call = (user: User, method: "GET" | "POST" | "DELETE" | "PUT", url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: authHeader(user.accessToken), ...(payload ? { payload } : {}) });
  const get = async (user: User, url: string) => (await call(user, "GET", url)).json();
  const equal = (people: User[], extra: object = {}) => ({
    description: "x", amountMinor: 900, currency: "USD", splitMethod: "equal",
    payers: [{ userId: a.userId, amountMinor: 900 }], participantUserIds: people.map((p) => p.userId), ...extra,
  });
  const inGroup = () => `/api/groups/${groupId}/expenses`;

  describe("comments", () => {
    const say = (user: User, id: string, body: string, extra: object = {}) => call(user, "POST", `/api/expenses/${id}/comments`, { body, ...extra });
    const read = async (user: User, id: string) => (await get(user, `/api/expenses/${id}/comments`)).map((x: { body: string }) => x.body);
    let id: string;
    beforeEach(async () => {
      id = (await call(a, "POST", inGroup(), equal([a, b]))).json().id;
    });

    it("anyone in the group can comment, in order, and everyone hears about it", async () => {
      const first = await say(a, id, " hello ");
      expect([first.statusCode, first.json().body, first.json().displayName]).toEqual([201, "hello", "a"]);
      await say(c, id, "hi");
      expect(await read(b, id)).toEqual(["hello", "hi"]);
      expect((await get(b, "/api/activity")).items[0]).toMatchObject({ type: "comment_added", entityType: "expense", entityId: id, entityLabel: "x" });
      for (const bad of ["", "   ", "x".repeat(2001)]) expect((await say(a, id, bad)).statusCode).toBe(400);
    });

    it("only the author can delete a comment, and it disappears", async () => {
      const comment = (await say(a, id, "oops")).json();
      const remove = (user: User) => call(user, "DELETE", `/api/expenses/${id}/comments/${comment.id}`);
      expect((await remove(b)).statusCode).toBe(404);
      expect((await remove(a)).statusCode).toBe(204);
      expect((await remove(a)).statusCode).toBe(404);
      expect(await read(b, id)).toEqual([]);
    });

    it("a retry records once; the id cannot be reused", async () => {
      const commentId = uuidv7();
      const codes = (await Promise.all([1, 2, 3].map(() => say(a, id, "once", { id: commentId })))).map((r) => r.statusCode);
      expect(codes.sort()).toEqual([200, 200, 201]);
      expect(await read(a, id)).toEqual(["once"]);
      expect((await say(b, id, "once", { id: commentId })).statusCode).toBe(409);
      expect((await say(a, id, "different", { id: commentId })).statusCode).toBe(409);
      const other = (await call(a, "POST", inGroup(), equal([a, b]))).json().id;
      expect((await say(a, other, "once", { id: commentId })).statusCode).toBe(409);
    });

    it("is closed to outsiders and former members, and frozen when deleted or archived", async () => {
      const mine = (await say(a, id, "kept")).json();
      const o = await make("o");
      await call(c, "POST", `/api/groups/${groupId}/leave`);
      for (const user of [o, c]) {
        expect((await say(user, id, "x")).statusCode).toBe(404);
        expect((await call(user, "GET", `/api/expenses/${id}/comments`)).statusCode).toBe(404);
        expect((await call(user, "DELETE", `/api/expenses/${id}/comments/${mine.id}`)).statusCode).toBe(404);
      }
      await call(a, "POST", `/api/expenses/${id}/delete`, { version: 1 });
      expect((await say(a, id, "x")).statusCode).toBe(409);
      expect(await read(a, id)).toEqual(["kept"]);
      await call(a, "POST", `/api/groups/${groupId}/archive`);
      expect((await say(a, id, "x")).statusCode).toBe(409);
      expect((await call(a, "DELETE", `/api/expenses/${id}/comments/${mine.id}`)).statusCode).toBe(409);
    });

    it("on a direct expense, someone added later doesn't see earlier comments", async () => {
      const direct = (await call(a, "POST", "/api/expenses", equal([a, b]))).json().id;
      await say(a, direct, "private");
      await call(a, "PUT", `/api/expenses/${direct}`, { version: 1, ...equal([a, b, c]) });
      await say(b, direct, "welcome");
      expect(await read(c, direct)).toEqual(["welcome"]);
      expect(await read(b, direct)).toEqual(["private", "welcome"]);
    });
  });

  describe("itemized splits", () => {
    const item = (description: string, amountMinor: number, people: User[], shares = 1) => ({
      description, amountMinor, assignments: people.map((p) => ({ userId: p.userId, shares })),
    });
    const itemized = (items: object[], taxMinor: number, tipMinor: number, amountMinor: number, extra: object = {}) => ({
      description: "Dinner", amountMinor, currency: "USD", splitMethod: "itemized",
      payers: [{ userId: a.userId, amountMinor }], items, taxMinor, tipMinor, ...extra,
    });
    const owes = (expense: { participants: Row[] }, user: User) => expense.participants.find((p) => p.userId === user.userId)?.owedAmountMinor;
    const post = (payload: object) => call(a, "POST", inGroup(), payload);

    it("assigns items and spreads tax and tip in proportion", async () => {
      const res = await post(itemized([item("Steak", 3000, [a]), item("Salad", 1000, [b])], 400, 800, 5200));
      expect(res.statusCode, res.body).toBe(201);
      expect([owes(res.json(), a), owes(res.json(), b), owes(res.json(), c)]).toEqual([3900, 1300, undefined]);
      expect(res.json().itemization).toEqual({
        items: [item("Steak", 3000, [a]), item("Salad", 1000, [b])], taxMinor: 400, tipMinor: 800,
      });
      expect(await get(b, `/api/expenses/${res.json().id}`)).toMatchObject({ itemization: res.json().itemization });
    });

    it("is exact for uneven items, and reproducible", async () => {
      let seed = 7;
      const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
      for (let i = 0; i < 25; i++) {
        const items = Array.from({ length: 1 + rand(4) }, (_, k) => {
          const people = [a, b, c].filter(() => rand(1000) < 600);
          return item(`i${k}`, 1 + rand(999), people.length ? people : [c], 1 + rand(3));
        });
        const tax = rand(200);
        const tip = rand(200);
        const total = items.reduce((s, it) => s + it.amountMinor, 0) + tax + tip;
        const first = (await post(itemized(items, tax, tip, total))).json();
        const second = (await post(itemized(items, tax, tip, total))).json();
        expect(first.participants.reduce((s: number, p: Row) => s + p.owedAmountMinor, 0)).toBe(total);
        expect(first.participants).toEqual(second.participants);
        expect(first.participants.every((p: Row) => p.owedAmountMinor >= 0)).toBe(true);
      }
      const members = (await get(a, `/api/groups/${groupId}`)).members;
      expect(members.reduce((s: number, m: { netBalanceMinor: number }) => s + m.netBalanceMinor, 0)).toBe(0);
    });

    it("rejects totals that don't add up, bad assignments and outsiders", async () => {
      const o = await make("o");
      for (const [payload, code] of [
        [itemized([item("x", 100, [a])], 0, 0, 101), 400],
        [itemized([item("x", 100, [])], 0, 0, 100), 400],
        [itemized([], 50, 50, 100), 400],
        [itemized([item("x", 100, [a, a])], 0, 0, 100), 400],
        [itemized([item("x", 0, [a])], 0, 100, 100), 400],
        [itemized([item("x", 100, [a])], -10, 10, 100), 400],
        [itemized([item("x", 100, [o])], 0, 0, 100), 404],
      ] as const) {
        expect((await post(payload)).statusCode, JSON.stringify(payload)).toBe(code);
      }
    });

    it("can be edited to and from other methods without leaving items behind, with full history", async () => {
      const { id } = (await post(itemized([item("Steak", 600, [a]), item("Salad", 300, [b])], 0, 0, 900))).json();
      const put = (version: number, payload: object) => call(b, "PUT", `/api/expenses/${id}`, { version, ...payload });
      expect((await put(1, itemized([item("Soup", 900, [c])], 0, 0, 900))).json()).toMatchObject({ itemization: { items: [{ description: "Soup" }] } });
      expect(await ctx.db.select().from(expenseLineItems).where(eq(expenseLineItems.expenseId, id))).toHaveLength(1);
      expect((await put(2, equal([a, b, c]))).json().itemization).toBeNull();
      expect(await ctx.db.select().from(expenseLineItems).where(eq(expenseLineItems.expenseId, id))).toHaveLength(0);
      const history = await get(a, `/api/expenses/${id}/history`);
      expect(history.map((h: { after: { itemization: object | null } }) => h.after.itemization)).toEqual([
        null,
        { items: [item("Soup", 900, [c])], taxMinor: 0, tipMinor: 0 },
        { items: [item("Steak", 600, [a]), item("Salad", 300, [b])], taxMinor: 0, tipMinor: 0 },
      ]);
    });

    it("works for direct expenses, and keeps item order", async () => {
      const items = Array.from({ length: 12 }, (_, i) => item(`item ${i}`, 10, [i % 2 ? a : b]));
      const res = await call(a, "POST", "/api/expenses", itemized(items, 0, 0, 120));
      expect(res.statusCode).toBe(201);
      expect(res.json().itemization.items.map((i: { description: string }) => i.description)).toEqual(items.map((i) => i.description));
    });
  });
});
