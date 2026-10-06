import type { Config } from "drizzle-kit";

import { env } from "~/env";

if (!env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL to run drizzle-kit.");
}

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  tablesFilter: ["strava-raceways_*"],
} satisfies Config;
