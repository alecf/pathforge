import {
  default as stravaApi,
  type DetailedActivityResponse,
  type Strava,
} from "strava-v3";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getStravaAccessToken } from "~/server/auth/token-utils";

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

        // Get a valid access token (with automatic refresh if needed)
        const accessToken = await getStravaAccessToken(session.user.id);

        if (!accessToken) {
          throw new Error(
            "No valid Strava access token found. Please sign in again.",
          );
        }

        // Initialize Strava client with the user's access token
        const strava = createStravaClient(accessToken);

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
