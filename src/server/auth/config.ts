import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { sql } from "drizzle-orm";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import StravaProvider from "next-auth/providers/strava";

import { env } from "~/env";
import { db } from "~/server/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "~/server/db/schema";

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Refresh Strava access token
 */
async function refreshStravaToken(refreshToken: string) {
  try {
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
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = (await response.json()) as StravaTokenResponse;
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
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  providers: [
    StravaProvider({
      clientId: env.STRAVA_CLIENT_ID,
      clientSecret: env.STRAVA_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "read,profile:read_all,activity:read_all",
          approval_prompt: "auto",
        },
      },
    }),
  ],
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
      },
    }),
    jwt: async ({ token, account, user }) => {
      // Initial sign in
      if (account && user) {
        console.log("Initial sign in - storing tokens");
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at,
          user,
        };
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires as number) * 1000) {
        console.log("Token still valid");
        return token;
      }

      // Access token has expired, try to update it
      console.log("Token expired, attempting refresh");
      try {
        const refreshedTokens = await refreshStravaToken(
          token.refreshToken as string,
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
            sql`${accounts.userId} = ${user?.id ?? token.sub} AND ${accounts.provider} = 'strava'`,
          );

        return {
          ...token,
          accessToken: refreshedTokens.access_token,
          refreshToken: refreshedTokens.refresh_token,
          accessTokenExpires: refreshedTokens.expires_at,
        };
      } catch (error) {
        console.error("Error refreshing token:", error);
        return {
          ...token,
          error: "RefreshAccessTokenError",
        };
      }
    },
    signIn: async ({ user, account, email, profile }) => {
      console.log("signIn", { user, account, email, profile });

      // If this is a Strava account, ensure we have valid tokens
      if (account?.provider === "strava" && account.refresh_token) {
        try {
          // Check if token is expired or about to expire (within 1 hour)
          const expiresAt = account.expires_at;
          const now = Math.floor(Date.now() / 1000);
          const oneHour = 60 * 60;

          if (expiresAt && expiresAt - now < oneHour) {
            console.log(
              "Token expired or expiring soon, refreshing on sign in",
            );
            const refreshedTokens = await refreshStravaToken(
              account.refresh_token,
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
                sql`${accounts.userId} = ${user.id} AND ${accounts.provider} = 'strava'`,
              );
          }
        } catch (error) {
          console.error("Error refreshing token on sign in:", error);
          // Don't block sign in, just log the error
        }
      }

      return true;
    },
  },
} satisfies NextAuthConfig;
