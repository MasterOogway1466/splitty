import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invites, users } from "../src/db/schema.js";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

type User = { userId: string; accessToken: string };

describe("access and abuse hardening (docs/PLAN-PUBLIC.md §0b D4–D9)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await truncateAllTestTables(ctx.db);
    ctx.mailer.sent.length = 0;
  });

  const verified = (name: string) => createVerifiedUser(ctx, { email: `${name}@example.com`, password: "password123", displayName: name });
  const call = (user: User, method: "GET" | "POST" | "DELETE" | "PATCH", url: string, payload?: object) =>
    ctx.app.inject({ method, url, headers: authHeader(user.accessToken), ...(payload ? { payload } : {}) });
  const open = (url: string, payload: object) => ctx.app.inject({ method: "POST", url, payload });
  const makeGroup = async (user: User, name = "G"): Promise<string> =>
    (await call(user, "POST", "/api/groups", { name, defaultCurrency: "USD" })).json().id;
  const add = (user: User, groupId: string, email: string) => call(user, "POST", `/api/groups/${groupId}/members`, { email });
  const equal = (payer: User, people: User[]) => ({
    description: "x", amountMinor: 1000, currency: "USD", splitMethod: "equal",
    payers: [{ userId: payer.userId, amountMinor: 1000 }], participantUserIds: people.map((p) => p.userId),
  });
  const lastToken = () => ctx.mailer.sent.at(-1)!.text.match(/token=([\w-]+)/)![1]!;

  async function unverified(name: string): Promise<User> {
    const { userId } = (await open("/api/auth/signup", { email: `${name}@example.com`, password: "password123", displayName: name })).json();
    const { accessToken } = (await open("/api/auth/login", { email: `${name}@example.com`, password: "password123" })).json();
    return { userId, accessToken };
  }

  describe("D4: invite email caps", () => {
    it("counts invites against the sender, even when sent concurrently, and creates nothing once capped", async () => {
      const a = await verified("a");
      const groupId = await makeGroup(a);
      ctx.mailer.sent.length = 0;
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => add(a, groupId, `v${i}@example.com`)));
      expect(ctx.mailer.sent).toHaveLength(20);
      expect(results.filter((r) => r.statusCode === 429)).toHaveLength(10);
      expect((await call(a, "GET", `/api/groups/${groupId}`)).json().memberCount).toBe(21);
    });

    it("caps how often one address can be emailed, across senders", async () => {
      const senders = [await verified("a"), await verified("b")];
      ctx.mailer.sent.length = 0;
      for (const sender of senders) {
        const groupId = await makeGroup(sender);
        for (let i = 0; i < 4; i++) await add(sender, groupId, "victim@example.com");
      }
      expect(ctx.mailer.sent).toHaveLength(5);
    });
  });

  describe("D5: direct entries need an existing relationship", () => {
    it("refuses strangers and unknown ids identically, for expenses and settlements", async () => {
      const a = await verified("a");
      const b = await verified("b");
      const ghost = { userId: "00000000-0000-4000-8000-000000000001", accessToken: "" };
      for (const other of [b, ghost]) {
        const res = await call(a, "POST", "/api/expenses", equal(a, [a, other]));
        expect([res.statusCode, res.json().error]).toEqual([403, "not_connected"]);
        const settle = await call(a, "POST", "/api/settlements", { fromUserId: a.userId, toUserId: other.userId, amountMinor: 1, currency: "USD" });
        expect([settle.statusCode, settle.json().error]).toEqual([403, "not_connected"]);
      }
    });

    it("allows co-members, and people you have split with even after the group is gone", async () => {
      const a = await verified("a");
      const b = await verified("b");
      const groupId = await makeGroup(a);
      await add(a, groupId, "b@example.com");
      expect((await call(a, "POST", "/api/expenses", equal(a, [a, b]))).statusCode).toBe(201);
      await call(a, "DELETE", `/api/groups/${groupId}`);
      expect((await call(b, "POST", "/api/settlements", { fromUserId: b.userId, toUserId: a.userId, amountMinor: 500, currency: "USD" })).statusCode).toBe(201);
    });

    it("does not let a shared acquaintance connect two strangers to each other", async () => {
      const a = await verified("a");
      const b = await verified("b");
      const c = await verified("c");
      for (const other of ["b", "c"]) await add(a, await makeGroup(a), `${other}@example.com`);
      expect((await call(a, "POST", "/api/expenses", equal(a, [a, b, c]))).statusCode).toBe(201);
      expect((await call(b, "POST", "/api/expenses", equal(b, [c]))).statusCode).toBe(403);
    });
  });

  describe("D6: verified email required", () => {
    it("blocks group and ledger routes, including reads, until verified", async () => {
      const u = await unverified("u");
      const a = await verified("a");
      const groupId = await makeGroup(a);
      await add(a, groupId, "u@example.com");
      for (const res of [
        await call(u, "POST", "/api/groups", { name: "G", defaultCurrency: "USD" }),
        await call(u, "GET", `/api/groups/${groupId}`),
        await call(u, "GET", `/api/groups/${groupId}/expenses`),
        await call(u, "GET", "/api/balances/people"),
        await call(u, "GET", "/api/activity"),
        await call(u, "POST", "/api/expenses", equal(u, [u])),
        await call(u, "GET", "/api/settlements"),
      ]) {
        expect([res.statusCode, res.json().error]).toEqual([403, "email_not_verified"]);
      }
      expect((await call(u, "PATCH", "/api/auth/me", { displayName: "U" })).statusCode).toBe(200);
    });

    it("can resend the verification email, rate-limited, and the new link works", async () => {
      const u = await unverified("u");
      ctx.mailer.sent.length = 0;
      expect((await call(u, "POST", "/api/auth/resend-verification")).statusCode).toBe(204);
      expect(ctx.mailer.sent).toHaveLength(1);
      const token = lastToken();
      for (let i = 0; i < 2; i++) await call(u, "POST", "/api/auth/resend-verification");
      expect((await call(u, "POST", "/api/auth/resend-verification")).statusCode).toBe(429);
      expect((await open("/api/auth/verify-email", { token })).statusCode).toBe(200);
      expect((await call(u, "GET", "/api/groups")).statusCode).toBe(200);
    });

    it("sends nothing to an already verified account, and a password reset counts as verification", async () => {
      const a = await verified("a");
      ctx.mailer.sent.length = 0;
      expect((await call(a, "POST", "/api/auth/resend-verification")).statusCode).toBe(204);
      expect(ctx.mailer.sent).toHaveLength(0);

      const u = await unverified("u");
      await open("/api/auth/request-password-reset", { email: "u@example.com" });
      await open("/api/auth/confirm-password-reset", { token: lastToken(), newPassword: "another-password" });
      expect((await call(u, "GET", "/api/auth/me")).json().emailVerified).toBe(true);
    });
  });

  it("D7: a deleted group rejects every read and write", async () => {
    const a = await verified("a");
    const b = await verified("b");
    const groupId = await makeGroup(a);
    await add(a, groupId, "b@example.com");
    await call(a, "DELETE", `/api/groups/${groupId}`);
    for (const res of [
      await call(a, "GET", `/api/groups/${groupId}`),
      await call(a, "GET", `/api/groups/${groupId}/expenses`),
      await call(a, "POST", `/api/groups/${groupId}/expenses`, equal(a, [a, b])),
      await call(a, "POST", `/api/groups/${groupId}/settlements`, { fromUserId: a.userId, toUserId: b.userId, amountMinor: 1, currency: "USD" }),
      await call(a, "POST", `/api/groups/${groupId}/leave`),
    ]) {
      expect(res.statusCode).toBe(404);
    }
    expect((await call(a, "POST", "/api/expenses", equal(a, [a, b]))).statusCode).toBe(403);
    expect((await call(a, "GET", "/api/balances/people")).json()).toEqual([]);
  });

  describe("D8: invites", () => {
    async function invited() {
      const a = await verified("a");
      const groupId = await makeGroup(a);
      await add(a, groupId, "n@example.com");
      return { a, groupId, firstToken: lastToken() };
    }
    const accept = (token: string, password = "claimed-password") => open(`/api/invites/${token}/accept`, { displayName: "N", password });

    it("re-adding a pending invitee resends a working link, even after the first expired", async () => {
      const { a, groupId, firstToken } = await invited();
      await ctx.db.update(invites).set({ expiresAt: new Date(0) });
      expect((await accept(firstToken)).statusCode).toBe(400);
      expect((await add(a, groupId, "n@example.com")).statusCode).toBe(204);
      expect((await accept(lastToken())).statusCode).toBe(201);
      expect((await add(a, groupId, "n@example.com")).statusCode).toBe(409);
    });

    it("adding a pending invitee to a second group emails them too", async () => {
      const { a } = await invited();
      ctx.mailer.sent.length = 0;
      expect((await add(a, await makeGroup(a, "Second"), "n@example.com")).statusCode).toBe(204);
      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(["n@example.com"]);
    });

    it("signup with an invited email sends a claim link and never sets the password itself", async () => {
      await invited();
      ctx.mailer.sent.length = 0;
      const signup = { email: "n@example.com", password: "attacker-password", displayName: "Mallory" };
      expect((await open("/api/auth/signup", signup)).statusCode).toBe(201);
      expect((await open("/api/auth/login", signup)).statusCode).toBe(401);
      expect(ctx.mailer.sent.map((m) => m.to)).toEqual(["n@example.com"]);
      const claimed = (await accept(lastToken())).json();
      expect((await call(claimed, "GET", "/api/groups")).json()).toHaveLength(1);
      expect((await open("/api/auth/login", { email: "n@example.com", password: "claimed-password" })).statusCode).toBe(200);
      expect((await open("/api/auth/signup", signup)).statusCode).toBe(409);
    });

    it("password reset for a pending invitee sends a claim link rather than a reset link", async () => {
      await invited();
      await open("/api/auth/request-password-reset", { email: "n@example.com" });
      expect(ctx.mailer.sent.at(-1)!.text).toContain("/accept-invite?token=");
    });

    it("once claimed, no other outstanding invite link can take the account over", async () => {
      const { a, groupId, firstToken } = await invited();
      await add(a, groupId, "n@example.com");
      const results = await Promise.all([accept(firstToken, "password-one"), accept(lastToken(), "password-two")]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    });

    it("a suspended placeholder cannot be claimed", async () => {
      const { firstToken } = await invited();
      await ctx.db.update(users).set({ status: "suspended" }).where(eq(users.email, "n@example.com"));
      expect((await accept(firstToken)).statusCode).toBe(400);
    });
  });

  it("D9: a removed member can be re-added, as a plain member", async () => {
    const a = await verified("a");
    const b = await verified("b");
    const groupId = await makeGroup(a);
    await add(a, groupId, "b@example.com");
    await call(a, "POST", `/api/groups/${groupId}/leave`); // b becomes owner
    expect((await add(b, groupId, "a@example.com")).statusCode).toBe(204);
    const detail = (await call(a, "GET", `/api/groups/${groupId}`)).json();
    expect(detail.members.find((m: { userId: string }) => m.userId === a.userId).role).toBe("member");
  });

  it("only the owner can remove someone else; anyone can remove themselves", async () => {
    const a = await verified("a");
    const b = await verified("b");
    const c = await verified("c");
    const groupId = await makeGroup(a);
    for (const name of ["b", "c"]) await add(a, groupId, `${name}@example.com`);
    const remove = (by: User, target: User) => call(by, "DELETE", `/api/groups/${groupId}/members/${target.userId}`);
    expect((await remove(b, c)).statusCode).toBe(403);
    expect((await remove(b, a)).statusCode).toBe(403);
    expect((await remove(b, b)).statusCode).toBe(204);
    expect((await remove(a, c)).statusCode).toBe(204);
  });
});
