import { sql } from "drizzle-orm";
import { env } from "~/env";
import { db } from "~/server/db";
import { accounts } from "~/server/db/schema";
import { auth } from "./index";

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Refresh Strava access token
 */
async function refreshStravaToken(refreshToken: string) {
  try {
    console.log("Refreshing Strava access token...");
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Strava token refresh failed:", response.status, errorText);
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = (await response.json()) as StravaTokenResponse;
    console.log(
      "Successfully refreshed Strava token, expires in:",
      data.expires_in,
      "seconds",
    );
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
    };
  } catch (error) {
    console.error("Error refreshing Strava token:", error);
    throw error;
  }
}

/**
 * Get a valid Strava access token for a user
 */
export async function getStravaAccessToken(
  userId: string,
): Promise<string | null> {
  try {
    console.log("Getting Strava access token for user:", userId);

    // Get the user's Strava account
    const account = await db
      .select()
      .from(accounts)
      .where(
        sql`${accounts.userId} = ${userId} AND ${accounts.provider} = 'strava'`,
      )
      .limit(1);

    if (!account.length) {
      console.log("No Strava account found for user:", userId);
      return null;
    }

    const stravaAccount = account[0];

    if (!stravaAccount) {
      console.log("No Strava account found for user:", userId);
      return null;
    }

    // Check if token is expired or about to expire (within 1 hour)
    const expiresAt = stravaAccount.expires_at;
    const now = Math.floor(Date.now() / 1000);
    const oneHour = 60 * 60;

    if (expiresAt) {
      const timeUntilExpiry = expiresAt - now;
      console.log("Token expires in:", timeUntilExpiry, "seconds");

      if (timeUntilExpiry < oneHour) {
        console.log("Token expired or expiring soon, refreshing");

        if (!stravaAccount.refresh_token) {
          console.error("No refresh token available");
          return null;
        }

        try {
          const refreshedTokens = await refreshStravaToken(
            stravaAccount.refresh_token,
          );

          // Update the account in the database
          await db
            .update(accounts)
            .set({
              access_token: refreshedTokens.access_token,
              refresh_token: refreshedTokens.refresh_token,
              expires_at: refreshedTokens.expires_at,
            })
            .where(
              sql`${accounts.userId} = ${userId} AND ${accounts.provider} = 'strava'`,
            );

          console.log("Successfully updated token in database");
          return refreshedTokens.access_token;
        } catch (error) {
          console.error("Error refreshing token:", error);
          return null;
        }
      } else {
        console.log("Token is still valid, using existing token");
      }
    } else {
      console.log("No expiry time found, using existing token");
    }

    return stravaAccount.access_token;
  } catch (error) {
    console.error("Error getting Strava access token:", error);
    return null;
  }
}

/**
 * Get the current session and ensure tokens are valid
 */
export async function getValidatedSession() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  // Get a valid access token
  const accessToken = await getStravaAccessToken(session.user.id);

  if (!accessToken) {
    console.log("No valid access token found for user:", session.user.id);
    return null;
  }

  return {
    ...session,
    accessToken,
  };
}
