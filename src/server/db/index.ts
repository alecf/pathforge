import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as schema from "./schema";

function createDb(connectionString: string) {
  // Hyperdrive pools connections on its side; keep the Worker under its limit
  // of six concurrent connections per request.
  return drizzle(postgres(connectionString, { max: 5 }), { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Outside a Cloudflare request (tests, scripts, plain `next dev`) there is no
 * Hyperdrive binding, so share one client built from DATABASE_URL. Cache it on
 * globalThis so HMR doesn't open a new pool on every reload.
 */
const globalForDb = globalThis as unknown as { localDb: Db | undefined };

function getLocalDb(): Db {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set and there is no Hyperdrive binding to fall back on.",
    );
  }
  globalForDb.localDb ??= createDb(env.DATABASE_URL);
  return globalForDb.localDb;
}

function getCloudflareContextOrUndefined() {
  try {
    return getCloudflareContext();
  } catch {
    return undefined;
  }
}

// Workers can't reuse a socket opened by another request, so each request gets
// its own client, keyed on that request's ExecutionContext.
const requestDbs = new WeakMap<object, Db>();

export function getDb(): Db {
  const cloudflare = getCloudflareContextOrUndefined();
  if (!cloudflare) return getLocalDb();

  const existing = requestDbs.get(cloudflare.ctx);
  if (existing) return existing;

  const db = createDb(cloudflare.env.HYPERDRIVE.connectionString);
  requestDbs.set(cloudflare.ctx, db);
  return db;
}
