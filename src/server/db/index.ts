import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "~/env";
import * as schema from "./schema";

function createDb(connectionString: string) {
  return drizzle(
    postgres(connectionString, {
      // Hyperdrive pools connections on its side; stay under the Worker's
      // limit of six concurrent connections per request.
      max: 5,
      // Skip the extra round trip that looks up custom types on connect. Each
      // Worker request opens a fresh client, so it would run every time.
      fetch_types: false,
    }),
    { schema },
  );
}

export type Db = ReturnType<typeof createDb>;

declare global {
  // Survives HMR in `next dev`, so reloads don't open a new pool each time.
  var localDb: Db | undefined;
}

/** Node (tests, scripts, `next dev`): one shared client from DATABASE_URL. */
function getLocalDb(): Db {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }
  globalThis.localDb ??= createDb(env.DATABASE_URL);
  return globalThis.localDb;
}

// Workers can't reuse a socket opened by another request, so each request gets
// its own client, keyed on that request's ExecutionContext.
const requestDbs = new WeakMap<object, Db>();

/** Workers (deployed, or `npm run preview`): per-request Hyperdrive client. */
function getRequestDb(): Db {
  // Throws outside a request (e.g. module scope), which is a bug worth seeing.
  const { env: bindings, ctx } = getCloudflareContext();

  const existing = requestDbs.get(ctx);
  if (existing) return existing;

  const db = createDb(bindings.HYPERDRIVE.connectionString);
  requestDbs.set(ctx, db);
  return db;
}

const isWorkers = globalThis.navigator?.userAgent === "Cloudflare-Workers";

export function getDb(): Db {
  if (isWorkers) return getRequestDb();
  return getLocalDb();
}
