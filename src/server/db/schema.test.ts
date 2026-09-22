import { sql } from "drizzle-orm";
import { QueryBuilder, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { accounts, sessions, users, verificationTokens } from "./schema";

/**
 * These assertions pin the SQL that drizzle-orm generates for the Auth.js
 * tables. The column names are the ones already committed in `drizzle/*.sql`,
 * so a drizzle upgrade that changed naming or index/constraint emission would
 * silently diverge the ORM from the migrated database — and show up here.
 */
describe("users table", () => {
  const config = getTableConfig(users);

  it('maps to the "user" table', () => {
    expect(config.name).toBe("user");
  });

  it("keeps the committed column names and types", () => {
    expect(
      config.columns.map((column) => [column.name, column.getSQLType()]),
    ).toEqual([
      ["id", "varchar(255)"],
      ["name", "varchar(255)"],
      ["email", "varchar(255)"],
      ["emailVerified", "timestamp with time zone"],
      ["image", "varchar(255)"],
    ]);
  });

  it("keeps id as a client-generated primary key", () => {
    const id = config.columns.find((column) => column.name === "id")!;

    expect(id.primary).toBe(true);
    expect(id.notNull).toBe(true);
    expect(id.hasDefault).toBe(true);
  });

  it("allows a null email, because Strava does not hand one over", () => {
    const email = config.columns.find((column) => column.name === "email")!;

    expect(email.notNull).toBe(false);
  });
});

describe("accounts table", () => {
  const config = getTableConfig(accounts);

  it('maps to the "account" table', () => {
    expect(config.name).toBe("account");
  });

  it("stores the Strava OAuth token columns", () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      "userId",
      "type",
      "provider",
      "providerAccountId",
      "refresh_token",
      "access_token",
      "expires_at",
      "token_type",
      "scope",
      "id_token",
      "session_state",
    ]);
  });

  it("is keyed on (provider, providerAccountId)", () => {
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]!.columns.map((column) => column.name)).toEqual(
      ["provider", "providerAccountId"],
    );
    expect(config.primaryKeys[0]!.getName()).toBe(
      "account_provider_providerAccountId_pk",
    );
  });

  it("indexes userId, which every token lookup filters on", () => {
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "account_user_id_idx",
    ]);
  });

  it("references user.id", () => {
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey!.reference();

    expect(reference.columns.map((column) => column.name)).toEqual(["userId"]);
    expect(reference.foreignColumns.map((column) => column.name)).toEqual([
      "id",
    ]);
  });

  it("does not cascade on delete, so a user row cannot be removed while linked", () => {
    // Auth.js' adapter exposes deleteUser/unlinkAccount; without ON DELETE
    // CASCADE, deleting a user with a linked account raises a foreign key
    // violation. See the adapter test for the round trip.
    expect(config.foreignKeys[0]!.onDelete).toBe("no action");
  });
});

describe("sessions table", () => {
  const config = getTableConfig(sessions);

  it('maps to the "session" table keyed on sessionToken', () => {
    expect(config.name).toBe("session");
    const token = config.columns.find(
      (column) => column.name === "sessionToken",
    )!;
    expect(token.primary).toBe(true);
  });

  it("indexes userId under the committed index name", () => {
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "t_user_id_idx",
    ]);
  });
});

describe("verification tokens table", () => {
  const config = getTableConfig(verificationTokens);

  it('maps to the "verification_token" table keyed on (identifier, token)', () => {
    expect(config.name).toBe("verification_token");
    expect(config.primaryKeys[0]!.columns.map((column) => column.name)).toEqual(
      ["identifier", "token"],
    );
  });
});

describe("raw sql fragments used for Strava token lookups", () => {
  it("qualifies and parameterises the account lookup", () => {
    const query = new QueryBuilder()
      .select()
      .from(accounts)
      .where(
        sql`${accounts.userId} = ${"user-1"} AND ${accounts.provider} = 'strava'`,
      )
      .limit(1)
      .toSQL();

    expect(query.sql).toContain(
      `where "account"."userId" = $1 AND "account"."provider" = 'strava'`,
    );
    expect(query.params).toEqual(["user-1", 1]);
  });
});
