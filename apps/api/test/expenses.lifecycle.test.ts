import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { categories, groupMembers, groups } from "../src/db/schema.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };

describe("expense lifecycle (docs/PLAN-PUBLIC.md Phase 2B)", () => {
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
  async function newGroup(members: string[]): Promise<string> {
    const id = (await call(a, "POST", "/api/groups", { name: "G", defaultCurrency: "USD" })).json().id;
    for (const m of members) await call(a, "POST", `/api/groups/${id}/members`, { email: `${m}@example.com` });
    return id;
  }
  const body = (extra: object = {}) => ({
    description: "Dinner", amountMinor: 900, currency: "USD", splitMethod: "equal",
    payers: [{ userId: a.userId, amountMinor: 900 }], participantUserIds: [a.userId, b.userId, c.userId], ...extra,
  });
  const create = async (extra: object = {}, url = `/api/groups/${groupId}/expenses`) => (await call(a, "POST", url, body(extra))).json();
  const edit = (user: User, id: string, version: number, extra: object = {}) => call(user, "PUT", `/api/expenses/${id}`, { version, ...body(extra) });
  const del = (user: User, id: string, version: number) => call(user, "POST", `/api/expenses/${id}/delete`, { version });
  const restore = (user: User, id: string, version: number) => call(user, "POST", `/api/expenses/${id}/restore`, { version });
  async function nets(): Promise<number[]> {
    const { members } = (await call(a, "GET", `/api/groups/${groupId}`)).json();
    return [a, b, c].map((u) => members.find((m: { userId: string }) => m.userId === u.userId)?.netBalanceMinor);
  }

  it("shows one expense with what was entered for each share", async () => {
    const [category] = await ctx.db.select().from(categories).limit(1);
    const { id } = await create({
      splitMethod: "percentage", notes: "n", expenseDate: "2026-03-01", categoryId: category?.id ?? null,
      participants: [{ userId: a.userId, percentage: 70 }, { userId: b.userId, percentage: 30 }],
    });
    const expense = (await call(b, "GET", `/api/expenses/${id}`)).json();
    expect(expense).toMatchObject({ version: 1, notes: "n", expenseDate: "2026-03-01", deletedAt: null, categoryId: category?.id ?? null });
    expect(expense.participants.find((p: { userId: string }) => p.userId === b.userId).shareInput).toEqual({ type: "percentage", percentage: 30 });
  });

  it("lists categories", async () => {
    expect((await call(a, "GET", "/api/categories")).statusCode).toBe(200);
  });

  it("keeps the calendar date exactly as entered and rejects anything else", async () => {
    expect((await create({ expenseDate: "2026-12-31" })).expenseDate).toBe("2026-12-31");
    for (const expenseDate of ["2026-02-30", "2026-12-31T23:00:00Z", "soon"]) {
      expect((await call(a, "POST", `/api/groups/${groupId}/expenses`, body({ expenseDate }))).statusCode).toBe(400);
    }
  });

  it("any member can edit; balances follow and other people's details are replaced", async () => {
    const { id } = await create();
    expect(await nets()).toEqual([600, -300, -300]);
    const res = await edit(b, id, 1, { description: "Lunch", amountMinor: 500, payers: [{ userId: b.userId, amountMinor: 500 }], participantUserIds: [a.userId] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ description: "Lunch", version: 2, createdBy: a.userId });
    expect(await nets()).toEqual([-500, 500, 0]);
  });

  it("delete and restore move balances out and back, and hide/show the expense", async () => {
    const { id } = await create();
    expect((await del(c, id, 1)).statusCode).toBe(200);
    expect(await nets()).toEqual([0, 0, 0]);
    expect((await call(a, "GET", `/api/groups/${groupId}/expenses`)).json().items).toEqual([]);
    expect((await call(a, "GET", `/api/groups/${groupId}/expenses?deleted=true`)).json().items).toHaveLength(1);
    expect((await call(a, "GET", `/api/expenses/${id}`)).json().deletedAt).not.toBeNull();
    expect((await edit(a, id, 2)).statusCode).toBe(409);
    expect((await del(a, id, 2)).statusCode).toBe(409);
    expect((await restore(a, id, 2)).json().version).toBe(3);
    expect((await restore(a, id, 3)).statusCode).toBe(409);
    expect(await nets()).toEqual([600, -300, -300]);
  });

  it("a stale version is refused with the current row, and concurrent edits apply once", async () => {
    const { id } = await create();
    await edit(a, id, 1, { description: "New" });
    for (const res of [await edit(b, id, 1), await del(b, id, 1)]) {
      expect([res.statusCode, res.json().error]).toEqual([409, "version_conflict"]);
      expect(res.json().current).toMatchObject({ description: "New", version: 2 });
    }
    const codes = (await Promise.all([1, 2, 3].map((n) => edit(a, id, 2, { description: `d${n}` })))).map((r) => r.statusCode);
    expect(codes.sort()).toEqual([200, 409, 409]);
  });

  it("history can reconstruct every version", async () => {
    const { id } = await create();
    await edit(b, id, 1, { description: "Lunch", amountMinor: 500, payers: [{ userId: b.userId, amountMinor: 500 }], participantUserIds: [a.userId] });
    await del(c, id, 2);
    await restore(a, id, 3);
    const history = (await call(a, "GET", `/api/expenses/${id}/history`)).json();
    expect(history.map((h: { changeType: string }) => h.changeType)).toEqual(["restore", "delete", "update", "create"]);
    expect(history.map((h: { editedByName: string }) => h.editedByName)).toEqual(["a", "c", "b", "a"]);
    const [, , update, created] = history;
    expect(created.before).toBeNull();
    expect(created.after).toMatchObject({ description: "Dinner", amountMinor: 900, payers: [{ userId: a.userId, amountMinor: 900 }] });
    expect(created.after.participants).toHaveLength(3);
    expect(update.before).toEqual(created.after);
    expect(update.after).toMatchObject({ description: "Lunch", participants: [{ userId: a.userId, owedAmountMinor: 500 }] });
  });

  it("replaying the original create after an edit returns the expense without undoing the edit", async () => {
    const id = uuidv7();
    await create({ id });
    await edit(b, id, 1, { description: "Edited" });
    const replay = await call(a, "POST", `/api/groups/${groupId}/expenses`, body({ id }));
    expect([replay.statusCode, replay.json().description]).toEqual([200, "Edited"]);
  });

  describe("who may touch what", () => {
    it("outsiders, former members and deleted groups get nothing", async () => {
      const outsider = await createVerifiedUser(ctx, { email: "o@example.com", password: "password123", displayName: "o" });
      const { id } = await create({ payers: [{ userId: a.userId, amountMinor: 900 }], participantUserIds: [a.userId] });
      const denied = async (user: User) => {
        for (const res of [
          await call(user, "GET", `/api/expenses/${id}`),
          await call(user, "GET", `/api/expenses/${id}/history`),
          await edit(user, id, 1),
          await del(user, id, 1),
          await restore(user, id, 1),
        ]) {
          expect(res.statusCode).toBe(404);
        }
      };
      await denied(outsider);
      await call(c, "POST", `/api/groups/${groupId}/leave`);
      await denied(c);
      await ctx.db.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, groupId));
      await denied(a);
    });

    it("someone removed while their edit waits is refused", async () => {
      const { id } = await create({ participantUserIds: [a.userId] });
      let pending!: ReturnType<typeof call>;
      await ctx.db.transaction(async (tx) => {
        await tx.select().from(groups).where(eq(groups.id, groupId)).for("no key update");
        await tx
          .update(groupMembers)
          .set({ removedAt: new Date() })
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, c.userId)));
        pending = edit(c, id, 1, { participantUserIds: [a.userId], description: "Sneaky" });
        await Promise.race([pending as Promise<unknown>, new Promise((resolve) => setTimeout(resolve, 400))]);
      });
      expect((await pending).statusCode).toBe(404);
    });

    it("validates an edit like a new expense", async () => {
      const outsider = await createVerifiedUser(ctx, { email: "o@example.com", password: "password123", displayName: "o" });
      const { id } = await create();
      expect((await edit(a, id, 1, { currency: "EUR" })).statusCode).toBe(400);
      expect((await edit(a, id, 1, { participantUserIds: [outsider.userId] })).statusCode).toBe(404);
      expect((await edit(a, id, 1, { amountMinor: 901 })).statusCode).toBe(400);
      expect((await edit(a, id, 1, { categoryId: uuidv7() })).statusCode).toBe(400);
      expect(await nets()).toEqual([600, -300, -300]);
    });

    it("refuses changes that alter a departed member's balance, but allows others", async () => {
      const { id } = await create();
      await call(c, "POST", `/api/groups/${groupId}/settlements`, { fromUserId: c.userId, toUserId: a.userId, amountMinor: 300, currency: "USD" });
      expect((await call(c, "POST", `/api/groups/${groupId}/leave`)).statusCode).toBe(204);

      for (const res of [await del(a, id, 1), await edit(a, id, 1, { participantUserIds: [a.userId, b.userId] })]) {
        expect([res.statusCode, res.json().error]).toEqual([409, "affects_former_member"]);
      }
      expect((await edit(a, id, 1, { description: "Renamed" })).statusCode).toBe(200);
      const reshuffled = await edit(a, id, 2, {
        splitMethod: "exact",
        participants: [{ userId: a.userId, amountMinor: 100 }, { userId: b.userId, amountMinor: 500 }, { userId: c.userId, amountMinor: 300 }],
      });
      expect(reshuffled.statusCode).toBe(200);
      await call(a, "POST", `/api/groups/${groupId}/members`, { email: "c@example.com" });
      expect((await del(a, id, 3)).statusCode).toBe(200);
    });

    it("refuses restoring an expense that would put a departed member back in debt", async () => {
      const { id } = await create();
      await del(a, id, 1);
      expect((await call(c, "POST", `/api/groups/${groupId}/leave`)).statusCode).toBe(204);
      expect((await restore(a, id, 2)).statusCode).toBe(409);
    });

    it("direct expenses: a party cannot change what a stranger owes", async () => {
      const x = await createVerifiedUser(ctx, { email: "x@example.com", password: "password123", displayName: "x" });
      const g2 = await newGroup(["x"]);
      expect(g2).toBeTruthy();
      // b and x are connected only through a.
      const { id } = await create({ payers: [{ userId: a.userId, amountMinor: 900 }], participantUserIds: [a.userId, b.userId, x.userId] }, "/api/expenses");
      const same = { participantUserIds: [a.userId, b.userId, x.userId] };
      const shift = {
        payers: [{ userId: x.userId, amountMinor: 900 }],
        splitMethod: "exact",
        participants: [{ userId: b.userId, amountMinor: 900 }],
      };
      expect((await edit(x, id, 1, shift)).statusCode).toBe(403);
      expect((await del(x, id, 1)).statusCode).toBe(403);
      expect((await edit(x, id, 1, { ...same, description: "Renamed" })).statusCode).toBe(200);
      expect((await edit(a, id, 2, { participantUserIds: [b.userId, x.userId], payers: [{ userId: b.userId, amountMinor: 900 }] })).statusCode).toBe(404);
      expect((await del(a, id, 2)).statusCode).toBe(200);
      expect((await call(c, "GET", `/api/expenses/${id}`)).statusCode).toBe(404);
    });
  });

  describe("direct expenses between people who don't all know each other", () => {
    let x: User;
    const direct = (payers: [User, number][], owes: [User, number][]) => ({
      description: "D", amountMinor: payers.reduce((s, [, n]) => s + n, 0), currency: "USD", splitMethod: "exact",
      payers: payers.map(([u, amountMinor]) => ({ userId: u.userId, amountMinor })),
      participants: owes.map(([u, amountMinor]) => ({ userId: u.userId, amountMinor })),
    });
    const put = (user: User, id: string, version: number, payload: object) => call(user, "PUT", `/api/expenses/${id}`, { version, ...payload });
    beforeEach(async () => {
      x = await createVerifiedUser(ctx, { email: "x@example.com", password: "password123", displayName: "x" });
      // x shares a group with b only.
      const g = (await call(b, "POST", "/api/groups", { name: "BX", defaultCurrency: "USD" })).json().id;
      await call(b, "POST", `/api/groups/${g}/members`, { email: "x@example.com" });
    });

    it("an edit cannot add someone the creator isn't connected to", async () => {
      const { id } = (await call(a, "POST", "/api/expenses", direct([[a, 100]], [[b, 100]]))).json();
      const res = await put(b, id, 1, direct([[a, 100]], [[b, 50], [x, 50]]));
      expect([res.statusCode, res.json().error]).toEqual([403, "not_connected"]);
      expect((await call(x, "POST", "/api/expenses", direct([[x, 1]], [[a, 1]]))).statusCode).toBe(403);
    });

    it("an edit cannot shift who a stranger owes, even if their total stays the same", async () => {
      // Created by b: a and c pay; b and x owe. x is a stranger to a and c.
      const { id } = (await call(b, "POST", "/api/expenses", direct([[a, 100], [c, 100]], [[b, 100], [x, 100]]))).json();
      const shifted = direct([[a, 150], [c, 50]], [[b, 100], [x, 100]]);
      expect((await put(a, id, 1, shifted)).statusCode).toBe(403);
      expect((await put(b, id, 1, shifted)).statusCode).toBe(200);
    });

    it("replaying a create after being removed from the expense reveals nothing", async () => {
      const id = uuidv7();
      const payload = { id, ...direct([[a, 100]], [[b, 60], [c, 40]]) };
      await call(a, "POST", "/api/expenses", payload);
      expect((await put(b, id, 1, { ...direct([[c, 100]], [[b, 100]]), description: "Private" })).statusCode).toBe(200);
      const replay = await call(a, "POST", "/api/expenses", payload);
      expect(replay.statusCode).toBe(404);
      expect(replay.body).not.toContain("Private");
    });

    it("history shows only the versions the reader was part of", async () => {
      const { id } = (await call(a, "POST", "/api/expenses", { ...direct([[a, 100]], [[b, 100]]), notes: "private" })).json();
      await put(a, id, 1, direct([[a, 100]], [[b, 60], [c, 40]]));
      const history = (await call(c, "GET", `/api/expenses/${id}/history`)).json();
      expect(JSON.stringify(history)).not.toContain("private");
      expect([history[0].before, history[1].after]).toEqual([null, null]);
      expect(history[0].after).not.toBeNull();
      expect((await call(a, "GET", `/api/expenses/${id}/history`)).json()[1].after).not.toBeNull();
    });
  });

  describe("activity", () => {
    const feed = async (user: User, url = "/api/activity") => (await call(user, "GET", url)).json().items.filter((i: { entityType: string }) => i.entityType !== "member");

    it("reaches every group member, names the expense, and covers each change", async () => {
      const { id } = await create({ participantUserIds: [a.userId] });
      await edit(a, id, 1, { participantUserIds: [a.userId], description: "Lunch" });
      await del(a, id, 2);
      await restore(a, id, 3);
      for (const items of [await feed(c), await feed(c, `/api/groups/${groupId}/activity`)]) {
        expect(items.map((i: { type: string }) => i.type)).toEqual(["expense_restored", "expense_deleted", "expense_updated", "expense_created"]);
        expect(items[0]).toMatchObject({ entityLabel: "Lunch", groupName: "G", actorDisplayName: "a" });
      }
    });

    it("group settlements reach every member too", async () => {
      await call(a, "POST", `/api/groups/${groupId}/settlements`, { fromUserId: b.userId, toUserId: a.userId, amountMinor: 1, currency: "USD" });
      expect((await feed(c))[0].type).toBe("settlement_created");
    });

    it("someone removed by an edit hears about it, and a former member learns nothing new", async () => {
      const { id } = await create({}, "/api/expenses");
      await edit(a, id, 1, { participantUserIds: [a.userId, b.userId] });
      expect((await feed(c))[0]).toMatchObject({ type: "expense_updated", entityLabel: null });

      const grouped = await create({ participantUserIds: [a.userId] });
      await call(c, "POST", `/api/groups/${groupId}/leave`);
      await edit(a, grouped.id, 1, { participantUserIds: [a.userId], description: "Secret" });
      expect(JSON.stringify(await feed(c))).not.toContain("Secret");
    });
  });
});
