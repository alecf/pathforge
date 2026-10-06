import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "~/server/auth";
import { GET } from "~/app/api/trpc/[trpc]/route";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(async () => null),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * The route handler is typed for `NextRequest`, but at runtime it only touches
 * the standard `Request` surface (url, method, headers, body).
 */
function trpcRequest(path: string, params: Record<string, string>) {
  const url = new URL(`http://localhost:9300/api/trpc/${path}`);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return new Request(url) as unknown as NextRequest;
}

/** superjson wraps every payload in a `json` envelope. */
function superjson(value: unknown) {
  return JSON.stringify({ json: value });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Exercises the same path the browser takes: the Next route handler, the tRPC
 * fetch adapter, the superjson transformer and the Zod error formatter.
 */
describe("POST/GET /api/trpc", () => {
  it("serves a query through the superjson transformer", async () => {
    const response = await GET(
      trpcRequest("hello", { input: superjson({ text: "world" }) }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { data: { json: { greeting: "Hello world" } } },
    });
  });

  it("serves a batched query, the shape httpBatchStreamLink sends", async () => {
    const response = await GET(
      trpcRequest("hello,hello", {
        batch: "1",
        input: JSON.stringify({
          0: { json: { text: "one" } },
          1: { json: { text: "two" } },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { result: { data: { json: { greeting: "Hello one" } } } },
      { result: { data: { json: { greeting: "Hello two" } } } },
    ]);
  });

  it("returns the flattened Zod error the error formatter adds", async () => {
    const response = await GET(trpcRequest("hello", { input: superjson({}) }));

    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      error: {
        json: {
          data: {
            code: "BAD_REQUEST",
            httpStatus: 400,
            zodError: { fieldErrors: { text: expect.any(Array) } },
          },
        },
      },
    });
  });

  it("answers 401 for a protected procedure without a session", async () => {
    const response = await GET(
      trpcRequest("strava.athlete.getActivity", {
        input: superjson({ id: "1" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { json: { data: { code: "UNAUTHORIZED" } } },
    });
  });

  it("builds the request context from the Auth.js session", async () => {
    await GET(trpcRequest("hello", { input: superjson({ text: "world" }) }));

    expect(auth).toHaveBeenCalled();
  });
});
