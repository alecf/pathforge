import {
  default as stravaApi,
  type DetailedActivityResponse,
  type Strava,
} from "strava-v3";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const stravaRouter = createTRPCRouter({
  athlete: createTRPCRouter({
    listActivities: protectedProcedure
      .input(
        z
          .object({
            page: z.number().optional(),
            per_page: z.number().optional(),
            before: z.number().optional(),
            after: z.number().optional(),
          })
          .optional(),
      )
      .query(async ({ input, ctx }) => {
        // Get the user's access token from the session
        const session = ctx.session;
        if (!session?.user?.id) {
          throw new Error("User not authenticated");
        }

        // Get the user's Strava access token from the database
        const account = await ctx.db.query.accounts.findFirst({
          where: (accounts, { eq, and }) =>
            and(
              eq(accounts.userId, session.user.id),
              eq(accounts.provider, "strava"),
            ),
        });

        if (!account?.access_token) {
          throw new Error("No Strava access token found");
        }

        // Initialize Strava client with the user's access token
        const strava = createStravaClient(account.access_token);

        // Call the Strava API with the provided arguments
        const activities = await strava.athlete.listActivities(input ?? {});

        return activities as DetailedActivityResponse[];
      }),
  }),
});

function createStravaClient(accessToken: string): Strava {
  // The TypeScript definitions are incomplete - the client constructor exists and works
  // but the types don't reflect this properly
  return new (
    stravaApi as unknown as { client: new (token: string) => Strava }
  ).client(accessToken);
}
