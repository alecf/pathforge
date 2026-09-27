/**
 * Vitest runs this before every test file, which is early enough for `~/env`
 * (imported transitively by the db, auth and tRPC modules) to validate.
 * These are throwaway values: nothing in the suite talks to a real database or
 * to Strava.
 */
process.env.AUTH_SECRET ??= "test-auth-secret";
process.env.STRAVA_CLIENT_ID ??= "test-strava-client-id";
process.env.STRAVA_CLIENT_SECRET ??= "test-strava-client-secret";
process.env.DATABASE_URL ??=
  "postgresql://pathforge:pathforge@127.0.0.1:5432/pathforge_test";
