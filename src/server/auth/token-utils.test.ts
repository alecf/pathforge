import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accounts, users } from "~/server/db/schema";
import { getStravaAccessToken, getValidatedSession } from "./token-utils";

vi.mock("~/server/db", async () => {
  const { createTestDatabase } = await import("~/test/pglite");
  const testDb = await createTestDatabase();
  return { db: testDb.db };
});

// `./index` calls NextAuth() at import time; the token helpers only need
// `auth()`.
vi.mock("./index", () => ({ auth: vi.fn() }));

const { db } = await import("~/server/db");
const { auth } = await import("./index");

/**
 * `auth` is an overloaded Auth.js helper; the token utilities only ever call
 * the no-argument form, so narrow it before mocking.
 */
const authMock = vi.mocked(auth as unknown as () => Promise<Session | null>);

function sessionFixture(value: Record<string, unknown>): Session {
  return value as unknown as Session;
}

const NOW_SECONDS = 1_700_000_000;
const ONE_HOUR = 60 * 60;

interface AccountSeed {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
}

async function seedUserWithAccount(seed: AccountSeed = {}) {
  const {
    access_token = "stored-access",
    refresh_token = "stored-refresh",
    expires_at = NOW_SECONDS + 2 * ONE_HOUR,
  } = seed;

  const [user] = await db
    .insert(users)
    .values({ name: "Strava Athlete", email: null })
    .returning();

  await db.insert(accounts).values({
    userId: user!.id,
    type: "oauth",
    provider: "strava",
    providerAccountId: `strava-${user!.id}`,
    access_token,
    refresh_token,
    expires_at,
  });

  return user!.id;
}

function readAccount(userId: string) {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .then((rows) => rows[0]!);
}

function refreshResponse() {
  return Response.json({
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_in: 21_600,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_SECONDS * 1000);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  authMock.mockReset();
});

describe("getStravaAccessToken", () => {
  it("returns the stored token when it is good for more than an hour", async () => {
    const userId = await seedUserWithAccount();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStravaAccessToken(userId)).resolves.toBe("stored-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the stored token when the account has no expiry recorded", async () => {
    const userId = await seedUserWithAccount({ expires_at: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStravaAccessToken(userId)).resolves.toBe("stored-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a token that expires inside the hour and persists it", async () => {
    const userId = await seedUserWithAccount({
      expires_at: NOW_SECONDS + 60,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => refreshResponse()),
    );

    await expect(getStravaAccessToken(userId)).resolves.toBe("fresh-access");
    await expect(readAccount(userId)).resolves.toMatchObject({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_at: NOW_SECONDS + 21_600,
    });
  });

  it("refreshes a token that has already expired", async () => {
    const userId = await seedUserWithAccount({
      expires_at: NOW_SECONDS - 10_000,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => refreshResponse()),
    );

    await expect(getStravaAccessToken(userId)).resolves.toBe("fresh-access");
  });

  it("returns null when the user has no Strava account", async () => {
    await expect(getStravaAccessToken("no-such-user")).resolves.toBeNull();
  });

  it("returns null when the account has no refresh token to use", async () => {
    const userId = await seedUserWithAccount({
      refresh_token: null,
      expires_at: NOW_SECONDS + 60,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStravaAccessToken(userId)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null and leaves the row alone when Strava rejects the refresh", async () => {
    const userId = await seedUserWithAccount({
      expires_at: NOW_SECONDS + 60,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad refresh token", { status: 400 })),
    );

    await expect(getStravaAccessToken(userId)).resolves.toBeNull();
    await expect(readAccount(userId)).resolves.toMatchObject({
      access_token: "stored-access",
    });
  });

  it("returns null when the refresh request throws", async () => {
    const userId = await seedUserWithAccount({
      expires_at: NOW_SECONDS + 60,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(getStravaAccessToken(userId)).resolves.toBeNull();
  });
});

describe("getValidatedSession", () => {
  it("returns null when there is no session", async () => {
    authMock.mockResolvedValue(null);

    await expect(getValidatedSession()).resolves.toBeNull();
  });

  it("returns null when the session carries no user id", async () => {
    authMock.mockResolvedValue(
      sessionFixture({ user: {}, expires: "2030-01-01" }),
    );

    await expect(getValidatedSession()).resolves.toBeNull();
  });

  it("returns null when no access token can be produced", async () => {
    authMock.mockResolvedValue(
      sessionFixture({ user: { id: "no-such-user" }, expires: "2030-01-01" }),
    );

    await expect(getValidatedSession()).resolves.toBeNull();
  });

  it("returns the session with a usable access token attached", async () => {
    const userId = await seedUserWithAccount();
    authMock.mockResolvedValue(
      sessionFixture({
        user: { id: userId, name: "Ada" },
        expires: "2030-01-01",
      }),
    );

    await expect(getValidatedSession()).resolves.toMatchObject({
      user: { id: userId, name: "Ada" },
      accessToken: "stored-access",
    });
  });
});
