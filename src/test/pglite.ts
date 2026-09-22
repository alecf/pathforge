import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import * as schema from "~/server/db/schema";

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Boot an in-process Postgres (PGlite) and bring it up to the committed
 * migrations. Tests get the real SQL engine, so drizzle and the Auth.js adapter
 * are exercised against the schema that actually ships rather than a stub.
 */
export async function createTestDatabase(): Promise<{
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = await PGlite.create();

  const migrations = readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    await client.exec(readFileSync(join(migrationsDir, migration), "utf8"));
  }

  return {
    client,
    db: drizzle(client, { schema }),
    close: () => client.close(),
  };
}
