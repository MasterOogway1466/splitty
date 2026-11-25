import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { groupMembers, groups } from "../src/db/schema.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };

describe("direct entries and settlements (docs/PLAN-PUBLIC.md Phase 2C)", () => {
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
  beforeEach(async () => {
    await truncateAllTestTables(ctx.db);
    const make = (name: string) => createVerifiedUser(ctx, { email: `${name}@example.com`, password: "password123", displayName: name });
    a = await make("a");
    b = await make("b");
    c = await make("c");
    groupId = await newGroup(["b", "c"]);
  });

  const call = (user: User, method: "GET" | "POST" | "DELETE" | "PUT", url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: authHeader(user.accessToken), ...(payload ? { payload } : {}) });
  const get = async (user: User, url: string) => (await call(user, "GET", url)).json();
  async function newGroup(members: string[], name = "G"): Promise<string> {
    const id = (await call(a, "POST", "/api/groups", { name, defaultCurrency: "USD" })).json().id;
    for (const m of members) await call(a, "POST", `/api/groups/${id}/members`, { email: `${m}@example.com` });
    return id;
  }
  async function owe(debtor: User, creditor: User, amountMinor: number, url = `/api/groups/${groupId}/expenses`, by = a) {
    const res = await call(by, "POST", url, {
      description: "x", amountMinor, currency: "USD", splitMethod: "equal",
      payers: [{ userId: creditor.userId, amountMinor }], participantUserIds: [debtor.userId],
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }
  async function pay(from: User, to: User, amountMinor: number, url = `/api/groups/${groupId}/settlements`, extra: object = {}) {
    const res = await call(from, "POST", url, { fromUserId: from.userId, toUserId: to.userId, amountMinor, currency: "USD", ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }
  const edit = (user: User, id: string, version: number, extra: object) =>
    call(user, "PUT", `/api/settlements/${id}`, { version, amountMinor: 300, method: "cash", settledAt: "2026-01-02", ...extra });
  const del = (user: User, id: string, version: number) => call(user, "POST", `/api/settlements/${id}/delete`, { version });
  const restore = (user: User, id: string, version: number) => call(user, "POST", `/api/settlements/${id}/restore`, { version });
  const net = async (user: User) => (await get(user, "/api/balances")).reduce((s: number, x: { netMinor: number }) => s + x.netMinor, 0);

  describe("settlement lifecycle", () => {
    it("edit, delete and restore move balances, keep history, and reach the group's activity", async () => {
      await owe(b, a, 1000);
      const { id } = await pay(b, a, 400, undefined, { note: "n", settledAt: "2026-01-01" });
      expect(await net(b)).toBe(-600);
      const edited = (await edit(c, id, 1, {})).json();
      expect(edited).toMatchObject({ amountMinor: 300, method: "cash", settledAt: "2026-01-02", note: null, version: 2, fromDisplayName: "b", toDisplayName: "a" });
      expect(await net(b)).toBe(-700);
      expect((await del(a, id, 2)).json().deletedAt).not.toBeNull();
      expect(await net(b)).toBe(-1000);
      expect((await get(a, `/api/groups/${groupId}/settlements`)).items).toEqual([]);
      expect((await get(a, `/api/groups/${groupId}/settlements?deleted=true`)).items).toHaveLength(1);
      expect((await restore(b, id, 3)).statusCode).toBe(200);
      expect(await net(b)).toBe(-700);

      const history = await get(a, `/api/settlements/${id}/history`);
      expect(history.map((h: { changeType: string }) => h.changeType)).toEqual(["restore", "delete", "update", "create"]);
      expect(history[2]).toMatchObject({ editedByName: "c", before: { amountMinor: 400, note: "n" }, after: { amountMinor: 300, note: null } });
      const types = (await get(c, "/api/activity")).items.map((i: { type: string }) => i.type);
      expect(types.slice(0, 4)).toEqual(["settlement_restored", "settlement_deleted", "settlement_updated", "settlement_created"]);
      expect((await get(c, "/api/activity")).items[0].entityLabel).toBe("$3.00");
    });

    it("refuses stale versions and wrong states, and applies concurrent edits once", async () => {
      const { id } = await pay(b, a, 400);
      const codes = (await Promise.all([1, 2, 3].map((n) => edit(a, id, 1, { amountMinor: n })))).map((r) => r.statusCode);
      expect(codes.sort()).toEqual([200, 409, 409]);
      const stale = await del(a, id, 1);
      expect([stale.statusCode, stale.json().error, stale.json().current.version]).toEqual([409, "version_conflict", 2]);
      expect((await restore(a, id, 2)).statusCode).toBe(409);
    });

    it("is closed to outsiders, former members, deleted groups and uninvolved people", async () => {
      const grouped = await pay(b, a, 400);
      await pay(a, b, 400);
      const direct = await pay(b, a, 1, "/api/settlements");
      const denied = async (user: User, id: string) => {
        for (const res of [
          await call(user, "GET", `/api/settlements/${id}`),
          await call(user, "GET", `/api/settlements/${id}/history`),
          await edit(user, id, 1, {}),
          await del(user, id, 1),
          await restore(user, id, 1),
        ]) {
          expect(res.statusCode).toBe(404);
        }
      };
      await denied(c, direct.id);
      await call(c, "POST", `/api/groups/${groupId}/leave`);
      await denied(c, grouped.id);
      await ctx.db.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, groupId));
      await denied(a, grouped.id);
    });

    it("cannot move a former member's balance, but notes can still change", async () => {
      await owe(c, a, 500);
      const { id } = await pay(c, a, 500, undefined, { settledAt: "2026-01-01" });
      expect((await call(c, "POST", `/api/groups/${groupId}/leave`)).statusCode).toBe(204);
      for (const res of [await del(a, id, 1), await edit(a, id, 1, { amountMinor: 499 })]) {
        expect([res.statusCode, res.json().error]).toEqual([409, "affects_former_member"]);
      }
      expect((await edit(a, id, 1, { amountMinor: 500, note: "thanks" })).statusCode).toBe(200);
    });

    it("someone removed while their edit waits is refused", async () => {
      const { id } = await pay(b, a, 400);
      let pending!: ReturnType<typeof call>;
      await ctx.db.transaction(async (tx) => {
        await tx.select().from(groups).where(eq(groups.id, groupId)).for("no key update");
        await tx.update(groupMembers).set({ removedAt: new Date() }).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, c.userId)));
        pending = edit(c, id, 1, {});
        await Promise.race([pending as Promise<unknown>, new Promise((resolve) => setTimeout(resolve, 400))]);
      });
      expect((await pending).statusCode).toBe(404);
    });

    it("between people connected only by a mutual contact's entry, edits and restores cannot exceed the debt", async () => {
      const g2 = await newGroup([]);
      const x = await createVerifiedUser(ctx, { email: "x@example.com", password: "password123", displayName: "x" });
      await call(a, "POST", `/api/groups/${g2}/members`, { email: "x@example.com" });
      const res = await call(a, "POST", "/api/expenses", {
        description: "x", amountMinor: 1000, currency: "USD", splitMethod: "equal",
        payers: [{ userId: b.userId, amountMinor: 1000 }], participantUserIds: [a.userId, x.userId],
      });
      expect(res.statusCode).toBe(201); // x owes b 500
      const { id } = await pay(x, b, 200, "/api/settlements");
      expect((await edit(x, id, 1, { amountMinor: 501 })).statusCode).toBe(403);
      expect((await edit(x, id, 1, { amountMinor: 500 })).statusCode).toBe(200);
      expect((await del(x, id, 2)).statusCode).toBe(200);
      await pay(x, b, 400, "/api/settlements");
      expect((await restore(x, id, 3)).statusCode).toBe(403);
      expect(await net(x)).toBe(-100);
    });

    it("keeps the calendar date as entered", async () => {
      expect((await pay(b, a, 1, undefined, { settledAt: "2026-12-31" })).settledAt).toBe("2026-12-31");
      const res = await call(b, "POST", "/api/settlements", { fromUserId: b.userId, toUserId: a.userId, amountMinor: 1, currency: "USD", settledAt: "2026-02-30" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("who owes whom", () => {
    it("suggests payments in a group that clear every balance, around people who have left", async () => {
      await owe(c, b, 700);
      await owe(b, a, 700);
      expect((await get(c, `/api/groups/${groupId}/debts`)).debts).toEqual(
        expect.arrayContaining([
          { fromUserId: c.userId, toUserId: b.userId, amountMinor: 700 },
          { fromUserId: b.userId, toUserId: a.userId, amountMinor: 700 },
        ]),
      );
      expect((await call(b, "POST", `/api/groups/${groupId}/leave`)).statusCode).toBe(204);
      expect((await get(c, `/api/groups/${groupId}/debts`)).debts).toEqual([{ fromUserId: c.userId, toUserId: a.userId, amountMinor: 700 }]);
      await pay(c, a, 700);
      expect((await get(a, `/api/groups/${groupId}/debts`)).debts).toEqual([]);
      expect((await call(b, "GET", `/api/groups/${groupId}/debts`)).statusCode).toBe(404);
    });

    it("breaks a person's balance down by where it can be settled", async () => {
      const second = await newGroup(["b"], "Second");
      await owe(b, a, 1000);
      await owe(a, b, 300, `/api/groups/${second}/expenses`);
      await owe(b, a, 50, "/api/expenses");
      const person = await get(a, `/api/balances/people/${b.userId}`);
      expect(person).toMatchObject({ userId: b.userId, displayName: "b" });
      expect(person.contexts).toEqual(
        expect.arrayContaining([
          { groupId, groupName: "G", currency: "USD", netMinor: 1000 },
          { groupId: second, groupName: "Second", currency: "USD", netMinor: -300 },
          { groupId: null, groupName: null, currency: "USD", netMinor: 50 },
        ]),
      );
      expect(person.contexts).toHaveLength(3);
    });

    it("folds what is left from a group you no longer share into the direct balance", async () => {
      await owe(b, a, 700);
      await owe(c, b, 700);
      await call(b, "POST", `/api/groups/${groupId}/leave`);
      expect((await get(a, `/api/balances/people/${b.userId}`)).contexts).toEqual([{ groupId: null, groupName: null, currency: "USD", netMinor: 700 }]);
      await pay(b, a, 700, "/api/settlements");
      expect((await get(a, `/api/balances/people/${b.userId}`)).contexts).toEqual([]);
    });

    it("does not reveal strangers, unknown ids or yourself", async () => {
      const x = await createVerifiedUser(ctx, { email: "x@example.com", password: "password123", displayName: "x" });
      for (const id of [x.userId, uuidv7(), a.userId]) {
        expect((await call(a, "GET", `/api/balances/people/${id}`)).statusCode).toBe(404);
      }
    });
  });

  describe("lists", () => {
    async function pages(user: User, url: string): Promise<{ id: string }[][]> {
      const result: { id: string }[][] = [];
      let cursor: string | null = null;
      do {
        const sep = url.includes("?") ? "&" : "?";
        const page: { items: { id: string }[]; nextCursor: string | null } = await get(
          user,
          `${url}${sep}limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        result.push(page.items);
        cursor = page.nextCursor;
      } while (cursor && result.length < 10);
      return result;
    }

    it("pages through every list without gaps or repeats, including ties", async () => {
      for (let i = 0; i < 5; i++) {
        await owe(b, a, 10 + i);
        await owe(b, a, 10 + i, "/api/expenses");
        await pay(b, a, 1);
        await pay(b, a, 1, "/api/settlements");
      }
      for (const url of [`/api/groups/${groupId}/expenses`, "/api/expenses", `/api/groups/${groupId}/settlements`, "/api/settlements"]) {
        const result = await pages(a, url);
        expect(result.map((p) => p.length)).toEqual([2, 2, 1]);
        expect(new Set(result.flat().map((r) => r.id)).size).toBe(5);
      }
      const activity = (await pages(a, "/api/activity?x=1")).flat();
      expect(new Set(activity.map((r) => r.id)).size).toBe(activity.length);
      expect(activity.length).toBeGreaterThanOrEqual(20);
      expect(await pages(a, `/api/groups/${groupId}/activity`)).toHaveLength(6);
    });

    it("rejects a malformed cursor or limit", async () => {
      for (const query of ["cursor=nope", "cursor=%27%3B--", "limit=0", "limit=1000", "limit=x"]) {
        for (const url of ["/api/expenses", "/api/settlements", "/api/activity", `/api/groups/${groupId}/expenses`]) {
          expect((await call(a, "GET", `${url}?${query}`)).statusCode, `${url}?${query}`).toBe(400);
        }
      }
    });

    it("filters direct entries to one person, and never shows other people's", async () => {
      const withB = await owe(b, a, 10, "/api/expenses");
      await owe(c, a, 10, "/api/expenses");
      const payB = await pay(b, a, 1, "/api/settlements");
      await pay(c, a, 1, "/api/settlements");
      const ids = async (user: User, url: string) => (await get(user, url)).items.map((r: { id: string }) => r.id);
      expect(await ids(a, `/api/expenses?with=${b.userId}`)).toEqual([withB.id]);
      expect(await ids(a, `/api/settlements?with=${b.userId}`)).toEqual([payB.id]);
      expect(await ids(b, `/api/expenses?with=${c.userId}`)).toEqual([]);
      await call(a, "POST", `/api/expenses/${withB.id}/delete`, { version: 1 });
      expect(await ids(a, `/api/expenses?with=${b.userId}`)).toEqual([]);
      expect(await ids(a, `/api/expenses?with=${b.userId}&deleted=true`)).toEqual([withB.id]);
    });

    it("group summaries stay correct when computed together", async () => {
      const second = await newGroup(["b"], "Second");
      await owe(b, a, 1000);
      await owe(a, b, 300, `/api/groups/${second}/expenses`);
      const summaries = await get(a, "/api/groups");
      const of = (id: string) => summaries.find((g: { id: string }) => g.id === id);
      expect([of(groupId).yourBalanceMinor, of(groupId).memberCount]).toEqual([1000, 3]);
      expect([of(second).yourBalanceMinor, of(second).memberCount]).toEqual([-300, 2]);
    });
  });
});
