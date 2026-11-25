import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { simplifyDebts, sumMinor } from "@splitty/shared";
import { groupMembers, groups } from "../src/db/schema.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };

describe("group settings, archive and friends (docs/PLAN-PUBLIC.md Phase 2D)", () => {
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
    ctx.mailer.sent.length = 0;
    a = await make("a");
    b = await make("b");
    c = await make("c");
    groupId = (await call(a, "POST", "/api/groups", { name: "G", defaultCurrency: "USD" })).json().id;
    for (const m of ["b", "c"]) await call(a, "POST", `/api/groups/${groupId}/members`, { email: `${m}@example.com` });
  });

  const call = (user: User, method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH", url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: authHeader(user.accessToken), ...(payload ? { payload } : {}) });
  const get = async (user: User, url: string) => (await call(user, "GET", url)).json();
  const patch = (user: User, payload: object) => call(user, "PATCH", `/api/groups/${groupId}`, payload);
  const expense = (debtor: User, creditor: User, amountMinor: number) => ({
    description: "x", amountMinor, currency: "USD", splitMethod: "equal",
    payers: [{ userId: creditor.userId, amountMinor }], participantUserIds: [debtor.userId],
  });
  const owe = async (debtor: User, creditor: User, amountMinor: number) => {
    const res = await call(a, "POST", `/api/groups/${groupId}/expenses`, expense(debtor, creditor, amountMinor));
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const pay = (from: User, to: User, amountMinor: number) =>
    call(from, "POST", `/api/groups/${groupId}/settlements`, { fromUserId: from.userId, toUserId: to.userId, amountMinor, currency: "USD" });
  const archive = (user: User) => call(user, "POST", `/api/groups/${groupId}/archive`);
  const unarchive = (user: User) => call(user, "POST", `/api/groups/${groupId}/unarchive`);

  describe("settings", () => {
    it("any member can rename and change the type; outsiders cannot", async () => {
      expect((await patch(b, { name: " New ", groupType: "trip" })).statusCode).toBe(200);
      expect(await get(a, `/api/groups/${groupId}`)).toMatchObject({ name: "New", groupType: "trip" });
      const o = await make("o");
      expect((await patch(o, { name: "Nope" })).statusCode).toBe(404);
      for (const bad of [{ name: "" }, { groupType: "cult" }, { defaultCurrency: "ZZZ" }, {}]) expect((await patch(a, bad)).statusCode).toBe(400);
    });

    it("locks the currency once anything has been recorded, even if deleted since", async () => {
      expect((await patch(a, { defaultCurrency: "EUR" })).statusCode).toBe(200);
      expect((await patch(a, { defaultCurrency: "USD" })).statusCode).toBe(200);
      const { id } = await owe(b, a, 100);
      await call(a, "POST", `/api/expenses/${id}/delete`, { version: 1 });
      const res = await patch(a, { defaultCurrency: "EUR" });
      expect([res.statusCode, res.json().error]).toEqual([409, "currency_locked"]);
      expect((await patch(a, { defaultCurrency: "USD", name: "Same currency is fine" })).statusCode).toBe(200);
    });

    it("saves a default split, checking it is complete and only names members", async () => {
      const shares = [a, b, c].map((u, i) => ({ userId: u.userId, value: i + 1 }));
      expect((await patch(a, { defaultSplit: { method: "shares", values: shares } })).statusCode).toBe(200);
      expect((await get(b, `/api/groups/${groupId}`)).defaultSplit).toEqual({ method: "shares", values: shares });
      expect((await patch(a, { defaultSplit: { method: "equal", values: [{ userId: a.userId, value: 1 }] } })).statusCode).toBe(200);
      expect((await patch(a, { defaultSplit: null })).statusCode).toBe(200);
      expect((await get(b, `/api/groups/${groupId}`)).defaultSplit).toBeNull();
      const o = await make("o");
      for (const defaultSplit of [
        { method: "percentage", values: [{ userId: a.userId, value: 60 }, { userId: b.userId, value: 30 }] },
        { method: "shares", values: [{ userId: o.userId, value: 1 }] },
        { method: "shares", values: [{ userId: a.userId, value: 1 }, { userId: a.userId, value: 2 }] },
        { method: "exact", values: [{ userId: a.userId, value: 1 }] },
        { method: "shares", values: [] },
      ]) {
        expect((await patch(a, { defaultSplit })).statusCode, JSON.stringify(defaultSplit)).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe("simplified debts", () => {
    it("reduces payments without changing anyone's net, and always shows the recorded debts too", async () => {
      await owe(b, a, 1000);
      await owe(c, b, 1000);
      const plain = await get(a, `/api/groups/${groupId}/debts`);
      expect(plain.simplified).toBe(false);
      expect(plain.debts).toHaveLength(2);
      await patch(b, { simplifyDebts: true });
      const simple = await get(a, `/api/groups/${groupId}/debts`);
      expect(simple.simplified).toBe(true);
      expect(simple.debts).toEqual([{ fromUserId: c.userId, toUserId: a.userId, amountMinor: 1000 }]);
      expect(simple.recordedDebts).toEqual(plain.debts);
      expect((await get(a, `/api/groups/${groupId}`)).members.map((m: { netBalanceMinor: number }) => m.netBalanceMinor).sort()).toEqual([-1000, 0, 1000]);
    });

    it("is exact, minimal enough, and order-independent for random nets", () => {
      for (let trial = 0; trial < 500; trial++) {
        const nets = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, () => Math.floor(Math.random() * 400) - 200);
        nets.push(-sumMinor(nets));
        const entries = nets.map((n, i) => [`p${i}`, n] as [string, number]);
        const payments = simplifyDebts(new Map(entries));
        const left = new Map(entries);
        for (const p of payments) {
          expect(p.amountMinor).toBeGreaterThan(0);
          left.set(p.fromId, left.get(p.fromId)! + p.amountMinor);
          left.set(p.toId, left.get(p.toId)! - p.amountMinor);
        }
        expect([...left.values()].every((v) => v === 0)).toBe(true);
        expect(payments.length).toBeLessThanOrEqual(Math.max(0, nets.filter((n) => n !== 0).length - 1));
        expect(simplifyDebts(new Map([...entries].reverse()))).toEqual(payments);
      }
    });
  });

  describe("archive", () => {
    it("needs everyone settled, and then makes the group read-only until unarchived", async () => {
      const kept = await owe(b, a, 500);
      const blocked = await archive(a);
      expect([blocked.statusCode, blocked.json().error]).toEqual([409, "group_not_settled"]);
      const payment = (await pay(b, a, 500)).json();
      expect((await archive(c)).statusCode).toBe(204);

      for (const res of [
        await call(a, "POST", `/api/groups/${groupId}/expenses`, expense(b, a, 1)),
        await pay(b, a, 1),
        await call(a, "PUT", `/api/expenses/${kept.id}`, { version: 1, ...expense(b, a, 600) }),
        await call(a, "POST", `/api/expenses/${kept.id}/delete`, { version: 1 }),
        await call(a, "POST", `/api/settlements/${payment.id}/delete`, { version: 1 }),
        await call(a, "POST", `/api/groups/${groupId}/members`, { email: "new@example.com" }),
        await call(a, "DELETE", `/api/groups/${groupId}/members/${b.userId}`),
        await patch(a, { name: "Nope" }),
        await archive(a),
      ]) {
        expect([res.statusCode, res.json().error]).toEqual([409, "group_archived"]);
      }
      expect(ctx.mailer.sent.some((m) => m.to === "new@example.com")).toBe(false);
      expect((await get(a, `/api/groups/${groupId}`)).archivedAt).not.toBeNull();
      expect((await get(a, `/api/groups/${groupId}/expenses`)).items).toHaveLength(1);
      expect(await get(a, "/api/groups")).toEqual([]);
      expect(await get(a, "/api/groups?archived=true")).toHaveLength(1);
      expect((await call(c, "POST", `/api/groups/${groupId}/leave`)).statusCode).toBe(204);

      expect((await unarchive(b)).statusCode).toBe(204);
      expect((await unarchive(b)).statusCode).toBe(409);
      await owe(b, a, 1);
    });

    it("cannot be raced by a new expense", async () => {
      for (let i = 0; i < 5; i++) {
        const [archived, added] = await Promise.all([archive(a), call(b, "POST", `/api/groups/${groupId}/expenses`, expense(b, a, 100))]);
        expect([archived.statusCode, added.statusCode].filter((s) => s < 300)).toHaveLength(1);
        if (archived.statusCode === 204) await unarchive(a);
        else await pay(b, a, 100);
      }
    });

    it("is closed to outsiders", async () => {
      const o = await make("o");
      expect((await archive(o)).statusCode).toBe(404);
      expect((await unarchive(o)).statusCode).toBe(404);
    });
  });

  it("the owner alone can see and restore a group they deleted", async () => {
    await call(a, "DELETE", `/api/groups/${groupId}`);
    expect(await get(a, "/api/groups?deleted=true")).toHaveLength(1);
    expect(await get(b, "/api/groups?deleted=true")).toEqual([]);
    expect((await call(b, "POST", `/api/groups/${groupId}/restore`)).statusCode).toBe(404);
    expect((await call(a, "POST", `/api/groups/${groupId}/restore`)).statusCode).toBe(204);
    expect((await call(a, "POST", `/api/groups/${groupId}/restore`)).statusCode).toBe(404);
    expect((await get(b, "/api/groups")).map((g: { id: string }) => g.id)).toEqual([groupId]);
  });

  it("group and membership changes appear in members' activity", async () => {
    await patch(a, { name: "Renamed" });
    await archive(a);
    await unarchive(a);
    await call(a, "DELETE", `/api/groups/${groupId}/members/${b.userId}`);
    const items = (await get(c, "/api/activity")).items;
    expect(items.map((i: { type: string }) => i.type)).toEqual(["member_removed", "group_unarchived", "group_archived", "group_updated", "member_added"]);
    expect(items[0]).toMatchObject({ entityLabel: "b", groupName: "Renamed" });
    const gone = (await get(b, "/api/activity")).items;
    expect(gone[0]).toMatchObject({ type: "member_removed", entityLabel: null });
  });

  it("a former member learns nothing newer, including the group's name", async () => {
    await call(a, "DELETE", `/api/groups/${groupId}/members/${b.userId}`);
    await patch(a, { name: "Secret name" });
    expect(JSON.stringify(await get(b, "/api/activity"))).not.toContain("Secret name");
  });

  it("someone removed while their add waits cannot add anyone", async () => {
    await make("o");
    for (const email of ["o@example.com", "brandnew@example.com"]) {
      let pending!: ReturnType<typeof call>;
      await ctx.db.transaction(async (tx) => {
        await tx.select().from(groups).where(eq(groups.id, groupId)).for("no key update");
        await tx.update(groupMembers).set({ removedAt: new Date() }).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, c.userId)));
        pending = call(c, "POST", `/api/groups/${groupId}/members`, { email });
        await Promise.race([pending as Promise<unknown>, new Promise((resolve) => setTimeout(resolve, 400))]);
      });
      expect((await pending).statusCode).toBe(404);
      await call(a, "POST", `/api/groups/${groupId}/members`, { email: "c@example.com" });
    }
    expect((await get(a, `/api/groups/${groupId}`)).memberCount).toBe(3);
  });

  describe("adding a friend by email", () => {
    const friend = (user: User, email: string) => call(user, "POST", "/api/friends", { email });
    const people = async (user: User) => (await get(user, "/api/balances/people")).map((p: { userId: string }) => p.userId);
    const direct = (from: User, to: string) =>
      call(from, "POST", "/api/expenses", {
        description: "x", amountMinor: 100, currency: "USD", splitMethod: "equal",
        payers: [{ userId: from.userId, amountMinor: 100 }], participantUserIds: [to],
      });

    it("connects to an existing account without email, idempotently", async () => {
      const o = await make("o");
      ctx.mailer.sent.length = 0;
      expect((await friend(a, "o@example.com")).statusCode).toBe(204);
      expect((await friend(a, "O@example.com ")).statusCode).toBe(204);
      expect(await people(a)).toContain(o.userId);
      expect(await people(o)).toContain(a.userId);
      expect((await direct(a, o.userId)).statusCode).toBe(201);
      expect(ctx.mailer.sent).toEqual([]);
    });

    it("invites someone new, who can claim the account and see the debt", async () => {
      ctx.mailer.sent.length = 0;
      expect((await friend(a, "new@example.com")).statusCode).toBe(204);
      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(["new@example.com"]);
      const id = (await people(a)).find((p: string) => ![b.userId, c.userId].includes(p))!;
      expect((await direct(a, id)).statusCode).toBe(201);
      const token = ctx.mailer.sent[0]!.text.match(/token=([\w-]+)/)![1];
      expect(await get(a, `/api/invites/${token}`)).toMatchObject({ groupName: null, inviterDisplayName: "a" });
      const claimed = (await call(a, "POST", `/api/invites/${token}/accept`, { displayName: "N", password: "password123" })).json();
      expect((await get({ userId: id, accessToken: claimed.accessToken }, "/api/balances"))[0].netMinor).toBe(-100);
    });

    it("shares the invite caps, and rejects yourself, bad emails and unavailable accounts", async () => {
      for (let i = 0; i < 5; i++) await friend(a, "flood@example.com");
      expect((await friend(a, "flood@example.com")).statusCode).toBe(429);
      expect((await friend(a, "a@example.com")).statusCode).toBe(400);
      expect((await friend(a, "nope")).statusCode).toBe(400);
    });
  });
});
