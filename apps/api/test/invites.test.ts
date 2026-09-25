import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, createTestContext, createVerifiedUser, truncateAllTestTables, type TestContext } from "./setup.js";

function extractToken(text: string): string {
  const match = text.match(/token=([\w-]+)/);
  if (!match?.[1]) throw new Error(`No token found in mail text: ${text}`);
  return match[1];
}

describe("invites: placeholder account + claim flow (docs/PLAN-PUBLIC.md §5)", () => {
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

  it("adding an unknown email creates a placeholder member immediately and emails a claim link; accepting activates it with access already granted", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice7@example.com", password: "password123", displayName: "Alice" });
    ctx.mailer.sent.length = 0; // clear Alice's own verification email

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "New friend's trip", defaultCurrency: "USD" } })
    ).json();

    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/members`,
      headers: authHeader(alice.accessToken),
      payload: { email: "newperson@example.com" },
    });
    expect(addRes.statusCode).toBe(204);

    // The placeholder is attached to the group right away — before the
    // invite is ever accepted.
    const detailRes = await ctx.app.inject({ method: "GET", url: `/api/groups/${group.id}`, headers: authHeader(alice.accessToken) });
    expect(detailRes.json().memberCount).toBe(2);

    expect(ctx.mailer.sent).toHaveLength(1);
    expect(ctx.mailer.sent[0]!.to).toBe("newperson@example.com");
    const token = extractToken(ctx.mailer.sent[0]!.text);

    const infoRes = await ctx.app.inject({ method: "GET", url: `/api/invites/${token}` });
    expect(infoRes.statusCode).toBe(200);
    const info = infoRes.json();
    expect(info.inviteeEmail).toBe("newperson@example.com");
    expect(info.inviterDisplayName).toBe("Alice");
    expect(info.groupName).toBe("New friend's trip");
    expect(info.expired).toBe(false);
    expect(info.alreadyAccepted).toBe(false);

    const acceptRes = await ctx.app.inject({
      method: "POST",
      url: `/api/invites/${token}/accept`,
      payload: { displayName: "New Person", password: "brand-new-password-1" },
    });
    expect(acceptRes.statusCode).toBe(201);
    const accepted = acceptRes.json();
    expect(accepted.user.displayName).toBe("New Person");
    expect(accepted.user.emailVerified).toBe(true); // clicking the emailed link counts as verification
    expect(accepted.accessToken).toBeDefined();

    // The claimed account can immediately see the group it was invited into.
    const myGroupsRes = await ctx.app.inject({ method: "GET", url: "/api/groups", headers: authHeader(accepted.accessToken) });
    expect(myGroupsRes.json()).toHaveLength(1);

    // And can now log in normally with the password they just set.
    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "newperson@example.com", password: "brand-new-password-1" },
    });
    expect(loginRes.statusCode).toBe(200);

    // The token is single-use.
    const secondAcceptRes = await ctx.app.inject({
      method: "POST",
      url: `/api/invites/${token}/accept`,
      payload: { displayName: "Again", password: "another-password-1" },
    });
    expect(secondAcceptRes.statusCode).toBe(400);
  });

  it("adding an email that already has an active account attaches them directly, with no invite email sent", async () => {
    const alice = await createVerifiedUser(ctx, { email: "alice8@example.com", password: "password123", displayName: "Alice" });
    const bob = await createVerifiedUser(ctx, { email: "bob8@example.com", password: "password123", displayName: "Bob" });
    ctx.mailer.sent.length = 0; // clear the two verification emails from signup

    const group = (
      await ctx.app.inject({ method: "POST", url: "/api/groups", headers: authHeader(alice.accessToken), payload: { name: "Existing friend", defaultCurrency: "USD" } })
    ).json();

    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/groups/${group.id}/members`,
      headers: authHeader(alice.accessToken),
      payload: { email: "bob8@example.com" },
    });
    expect(addRes.statusCode).toBe(204);
    expect(ctx.mailer.sent).toHaveLength(0);

    const bobGroupsRes = await ctx.app.inject({ method: "GET", url: "/api/groups", headers: authHeader(bob.accessToken) });
    expect(bobGroupsRes.json()).toHaveLength(1);
  });
});
