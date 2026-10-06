import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "~/test/pglite";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "~/server/db/schema";

/**
 * `@auth/drizzle-adapter` reads and writes the tables defined in
 * `src/server/db/schema.ts`. These tests run the adapter against a real
 * Postgres (PGlite) loaded with the committed migrations, which is the only way
 * to catch an adapter/ORM upgrade that stops lining up with the shipped schema.
 */
describe("Auth.js Drizzle adapter", () => {
  let adapter: Adapter;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await createTestDatabase();
    close = testDb.close;
    adapter = DrizzleAdapter(testDb.db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    });
  });

  afterAll(async () => {
    await close();
  });

  /**
   * `@auth/core`'s Strava provider maps every profile to `email: null`, which
   * `AdapterUser` does not allow at the type level but is what actually reaches
   * the adapter at runtime.
   */
  function stravaProfile(name: string): AdapterUser {
    return {
      id: "ignored-the-schema-generates-one",
      name,
      email: null,
      emailVerified: null,
      image: "https://example.test/avatar.png",
    } as unknown as AdapterUser;
  }

  async function captureError(run: () => Promise<void>): Promise<unknown> {
    try {
      await run();
      return null;
    } catch (error: unknown) {
      return error;
    }
  }

  /**
   * drizzle-orm wraps driver errors in a `DrizzleQueryError` whose message is
   * just the failed SQL, so the Postgres error text lives on `cause`.
   */
  function errorChain(error: unknown): string {
    const messages: string[] = [];
    let current = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }

  it("creates a user with the schema-generated id and a null email", async () => {
    const user = await adapter.createUser!(stravaProfile("Ada Lovelace"));

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(user.name).toBe("Ada Lovelace");
    expect(user.email).toBeNull();
    expect(user.emailVerified).toBeNull();
  });

  it("reads a user back by id", async () => {
    const created = await adapter.createUser!(stravaProfile("Grace Hopper"));

    await expect(adapter.getUser!(created.id)).resolves.toMatchObject({
      id: created.id,
      name: "Grace Hopper",
    });
    await expect(adapter.getUser!("does-not-exist")).resolves.toBeNull();
  });

  it("updates a user", async () => {
    const created = await adapter.createUser!(stravaProfile("Before"));

    const updated = await adapter.updateUser!({
      id: created.id,
      name: "After",
    });

    expect(updated.name).toBe("After");
  });

  it("links a Strava account and finds the user through it", async () => {
    const user = await adapter.createUser!(stravaProfile("Linked"));

    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "strava",
      providerAccountId: "strava-123",
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_at: 1_800_000_000,
      token_type: "bearer",
      scope: "read,activity:read_all",
    });

    await expect(
      adapter.getUserByAccount!({
        provider: "strava",
        providerAccountId: "strava-123",
      }),
    ).resolves.toMatchObject({ id: user.id, name: "Linked" });
  });

  it("round-trips the OAuth token columns the refresh flow depends on", async () => {
    const user = await adapter.createUser!(stravaProfile("Tokens"));
    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "strava",
      providerAccountId: "strava-tokens",
      access_token: "access-2",
      refresh_token: "refresh-2",
      expires_at: 1_900_000_000,
    });

    const account = await adapter.getAccount!("strava-tokens", "strava");

    expect(account).toMatchObject({
      userId: user.id,
      access_token: "access-2",
      refresh_token: "refresh-2",
      expires_at: 1_900_000_000,
    });
  });

  it("creates, joins, updates and deletes a database session", async () => {
    const user = await adapter.createUser!(stravaProfile("Session"));
    const expires = new Date("2030-01-01T00:00:00.000Z");

    const session = await adapter.createSession!({
      sessionToken: "token-1",
      userId: user.id,
      expires,
    });
    expect(session.sessionToken).toBe("token-1");

    const joined = await adapter.getSessionAndUser!("token-1");
    expect(joined?.user.id).toBe(user.id);
    expect(joined?.session.expires).toEqual(expires);

    const laterExpiry = new Date("2031-01-01T00:00:00.000Z");
    const updated = await adapter.updateSession!({
      sessionToken: "token-1",
      expires: laterExpiry,
    });
    expect(updated?.expires).toEqual(laterExpiry);

    await adapter.deleteSession!("token-1");
    await expect(adapter.getSessionAndUser!("token-1")).resolves.toBeNull();
  });

  it("burns a verification token on use", async () => {
    const expires = new Date("2030-01-01T00:00:00.000Z");
    await adapter.createVerificationToken!({
      identifier: "someone@example.test",
      token: "verify-1",
      expires,
    });

    await expect(
      adapter.useVerificationToken!({
        identifier: "someone@example.test",
        token: "verify-1",
      }),
    ).resolves.toMatchObject({ token: "verify-1" });

    await expect(
      adapter.useVerificationToken!({
        identifier: "someone@example.test",
        token: "verify-1",
      }),
    ).resolves.toBeNull();
  });

  it("unlinks an account", async () => {
    const user = await adapter.createUser!(stravaProfile("Unlink"));
    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "strava",
      providerAccountId: "strava-unlink",
    });

    await adapter.unlinkAccount!({
      provider: "strava",
      providerAccountId: "strava-unlink",
    });

    await expect(
      adapter.getUserByAccount!({
        provider: "strava",
        providerAccountId: "strava-unlink",
      }),
    ).resolves.toBeNull();
  });

  it("cannot delete a user while an account is still linked", async () => {
    // `src/server/db/schema.ts` declares the account -> user reference without
    // `onDelete: "cascade"`, so `deleteUser` hits a foreign key violation until
    // the account is unlinked first. Auth.js calls neither on its own; this
    // only bites a caller that wires up account deletion.
    const user = await adapter.createUser!(stravaProfile("Doomed"));
    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "strava",
      providerAccountId: "strava-doomed",
    });

    const failure = await captureError(async () => {
      await adapter.deleteUser!(user.id);
    });

    expect(errorChain(failure)).toMatch(/violates foreign key constraint/i);

    await adapter.unlinkAccount!({
      provider: "strava",
      providerAccountId: "strava-doomed",
    });
    await adapter.deleteUser!(user.id);

    await expect(adapter.getUser!(user.id)).resolves.toBeNull();
  });
});
