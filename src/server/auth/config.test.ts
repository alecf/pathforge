import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accounts, users } from "~/server/db/schema";
import { authConfig } from "./config";

/**
 * `~/server/db` normally opens a postgres-js pool against DATABASE_URL. Swap it
 * for an in-process Postgres so the adapter wiring and the raw `sql` fragments
 * in the callbacks run against a real engine instead of a spy.
 */
vi.mock("~/server/db", async () => {
  const { createTestDatabase } = await import("~/test/pglite");
  const testDb = await createTestDatabase();
  return { db: testDb.db };
});

const { db } = await import("~/server/db");

type Callbacks = NonNullable<typeof authConfig.callbacks>;
type JwtArgs = Parameters<NonNullable<Callbacks["jwt"]>>[0];
type SessionArgs = Parameters<NonNullable<Callbacks["session"]>>[0];
type SignInArgs = Parameters<NonNullable<Callbacks["signIn"]>>[0];

/**
 * Auth.js hands these callbacks a wide union (trigger, profile, isNewUser and
 * friends) that the implementations never read. Narrowing in one place keeps
 * each test to the fields under test.
 */
function jwtArgs(args: Record<string, unknown>): JwtArgs {
  return args as unknown as JwtArgs;
}
function sessionArgs(args: Record<string, unknown>): SessionArgs {
  return args as unknown as SessionArgs;
}
function signInArgs(args: Record<string, unknown>): SignInArgs {
  return args as unknown as SignInArgs;
}

const NOW_SECONDS = 1_700_000_000;

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    access_token: "fresh-access",
    refresh_token: "fresh-refresh",
    expires_in: 21_600,
    ...overrides,
  });
}

async function seedAccount(providerAccountId: string) {
  const [user] = await db
    .insert(users)
    .values({ name: "Strava Athlete", email: null })
    .returning();

  await db.insert(accounts).values({
    userId: user!.id,
    type: "oauth",
    provider: "strava",
    providerAccountId,
    access_token: "stale-access",
    refresh_token: "stale-refresh",
    expires_at: NOW_SECONDS - 60,
  });

  return user!;
}

function readAccount(userId: string) {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .then((rows) => rows[0]!);
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
});

describe("Strava provider", () => {
  const provider = authConfig.providers[0]!;

  it("is the Auth.js Strava OAuth provider", () => {
    expect(provider).toMatchObject({
      id: "strava",
      name: "Strava",
      type: "oauth",
    });
  });

  it("talks to Strava's v3 OAuth endpoints", () => {
    expect(provider).toMatchObject({
      authorization: { url: "https://www.strava.com/api/v3/oauth/authorize" },
      token: { url: "https://www.strava.com/api/v3/oauth/token" },
      userinfo: "https://www.strava.com/api/v3/athlete",
    });
  });

  it("requests the activity scopes the app needs", () => {
    // Auth.js merges `options` over the provider defaults at request time; the
    // default scope is just "read", which would break every activity query.
    expect(provider.options?.authorization).toMatchObject({
      params: {
        scope: "read,profile:read_all,activity:read_all",
        approval_prompt: "auto",
      },
    });
  });

  it("maps a Strava athlete to a user with a null email", () => {
    // Strava never returns an email, which is why `user.email` is nullable in
    // the schema.
    expect(
      provider.profile?.(
        {
          id: 987,
          firstname: "Ada",
          lastname: "Lovelace",
          profile: "https://example.test/avatar.png",
        },
        {},
      ),
    ).toEqual({
      id: 987,
      name: "Ada Lovelace",
      email: null,
      image: "https://example.test/avatar.png",
    });
  });
});

describe("Drizzle adapter wiring", () => {
  it("exposes the adapter methods Auth.js calls during a database session", () => {
    expect(Object.keys(authConfig.adapter)).toEqual(
      expect.arrayContaining([
        "createUser",
        "getUser",
        "getUserByEmail",
        "getUserByAccount",
        "updateUser",
        "linkAccount",
        "createSession",
        "getSessionAndUser",
        "updateSession",
        "deleteSession",
        "createVerificationToken",
        "useVerificationToken",
      ]),
    );
  });
});

describe("session callback", () => {
  it("copies the database user id onto session.user", () => {
    const session = authConfig.callbacks.session(
      sessionArgs({
        session: {
          user: { name: "Ada", email: null, image: null },
          expires: "2030-01-01T00:00:00.000Z",
        },
        user: { id: "user-1" },
      }),
    );

    expect(session.user.id).toBe("user-1");
    expect(session.user.name).toBe("Ada");
  });
});

describe("jwt callback", () => {
  it("stores the Strava tokens on first sign in", async () => {
    const token = await authConfig.callbacks.jwt(
      jwtArgs({
        token: { sub: "user-1" },
        user: { id: "user-1" },
        account: {
          provider: "strava",
          providerAccountId: "strava-1",
          type: "oauth",
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_at: NOW_SECONDS + 3600,
        },
      }),
    );

    expect(token).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessTokenExpires: NOW_SECONDS + 3600,
    });
  });

  it("returns the token untouched while the access token is still valid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const existing = {
      sub: "user-1",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      accessTokenExpires: NOW_SECONDS + 3600,
    };

    const token = await authConfig.callbacks.jwt(jwtArgs({ token: existing }));

    expect(token).toBe(existing);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and writes it back to the account row", async () => {
    const user = await seedAccount("strava-jwt-refresh");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      tokenResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await authConfig.callbacks.jwt(
      jwtArgs({
        token: {
          sub: user.id,
          refreshToken: "stale-refresh",
          accessTokenExpires: NOW_SECONDS - 60,
        },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.strava.com/oauth/token",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    if (typeof init.body !== "string") {
      throw new Error(
        "expected the refresh request to send a JSON string body",
      );
    }
    expect(JSON.parse(init.body)).toMatchObject({
      client_id: "test-strava-client-id",
      client_secret: "test-strava-client-secret",
      grant_type: "refresh_token",
      refresh_token: "stale-refresh",
    });

    expect(token).toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      accessTokenExpires: NOW_SECONDS + 21_600,
    });
    await expect(readAccount(user.id)).resolves.toMatchObject({
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      expires_at: NOW_SECONDS + 21_600,
    });
  });

  it("flags a refresh failure instead of throwing", async () => {
    const user = await seedAccount("strava-jwt-failure");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );

    const token = await authConfig.callbacks.jwt(
      jwtArgs({
        token: {
          sub: user.id,
          refreshToken: "stale-refresh",
          accessTokenExpires: NOW_SECONDS - 60,
        },
      }),
    );

    expect(token).toMatchObject({ error: "RefreshAccessTokenError" });
    await expect(readAccount(user.id)).resolves.toMatchObject({
      access_token: "stale-access",
    });
  });
});

describe("signIn callback", () => {
  it("refreshes a token that expires within the hour", async () => {
    const user = await seedAccount("strava-signin-refresh");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => tokenResponse()),
    );

    const allowed = await authConfig.callbacks.signIn(
      signInArgs({
        user: { id: user.id },
        account: {
          provider: "strava",
          providerAccountId: "strava-signin-refresh",
          type: "oauth",
          refresh_token: "stale-refresh",
          expires_at: NOW_SECONDS + 60,
        },
      }),
    );

    expect(allowed).toBe(true);
    await expect(readAccount(user.id)).resolves.toMatchObject({
      access_token: "fresh-access",
      expires_at: NOW_SECONDS + 21_600,
    });
  });

  it("leaves a token that is good for more than an hour alone", async () => {
    const user = await seedAccount("strava-signin-fresh");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const allowed = await authConfig.callbacks.signIn(
      signInArgs({
        user: { id: user.id },
        account: {
          provider: "strava",
          providerAccountId: "strava-signin-fresh",
          type: "oauth",
          refresh_token: "stale-refresh",
          expires_at: NOW_SECONDS + 7200,
        },
      }),
    );

    expect(allowed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readAccount(user.id)).resolves.toMatchObject({
      access_token: "stale-access",
    });
  });

  it("still lets the user in when the refresh call fails", async () => {
    const user = await seedAccount("strava-signin-failure");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const allowed = await authConfig.callbacks.signIn(
      signInArgs({
        user: { id: user.id },
        account: {
          provider: "strava",
          providerAccountId: "strava-signin-failure",
          type: "oauth",
          refresh_token: "stale-refresh",
          expires_at: NOW_SECONDS + 60,
        },
      }),
    );

    expect(allowed).toBe(true);
  });

  it("ignores accounts from other providers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const allowed = await authConfig.callbacks.signIn(
      signInArgs({
        user: { id: "user-1" },
        account: {
          provider: "github",
          providerAccountId: "gh-1",
          type: "oauth",
          refresh_token: "refresh-1",
          expires_at: NOW_SECONDS + 60,
        },
      }),
    );

    expect(allowed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
