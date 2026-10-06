import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCaller } from "~/server/api/root";
import type { createTRPCContext } from "~/server/api/trpc";
import { db } from "~/server/db";
import { getStravaAccessToken } from "~/server/auth/token-utils";

const strava = vi.hoisted(() => ({
  constructedWith: [] as string[],
  listActivities: vi.fn(),
  getActivity: vi.fn(),
  getStreams: vi.fn(),
}));

/**
 * strava-v3 v4 exposes an authenticated client as `new stravaApi.client(token)`.
 * The router builds one per call, so the stand-in records the token it was
 * handed and the arguments that reach each endpoint.
 */
vi.mock("strava-v3", () => ({
  default: {
    client: class {
      athlete = { listActivities: strava.listActivities };
      activities = { get: strava.getActivity };
      streams = { activity: strava.getStreams };

      constructor(token: string) {
        strava.constructedWith.push(token);
      }
    },
  },
}));

vi.mock("~/server/auth/token-utils", () => ({
  getStravaAccessToken: vi.fn(),
}));

type Context = Awaited<ReturnType<typeof createTRPCContext>>;

function caller(session: Context["session"] = SIGNED_IN) {
  return createCaller({ db, session, headers: new Headers() });
}

const SIGNED_IN = {
  user: { id: "user-1", name: "Ada", email: null, image: null },
  expires: "2030-01-01T00:00:00.000Z",
} as unknown as Context["session"];

beforeEach(() => {
  strava.constructedWith.length = 0;
  vi.mocked(getStravaAccessToken).mockResolvedValue("access-token-1");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  strava.listActivities.mockReset();
  strava.getActivity.mockReset();
  strava.getStreams.mockReset();
});

describe("public procedures", () => {
  it("answers hello without a session", async () => {
    await expect(caller(null).hello({ text: "world" })).resolves.toEqual({
      greeting: "Hello world",
    });
  });

  it("rejects invalid input with a ZodError cause", async () => {
    const failure = await caller(null)
      .hello({ text: 42 as unknown as string })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(TRPCError);
    expect((failure as TRPCError).code).toBe("BAD_REQUEST");
    expect((failure as TRPCError).cause).toBeInstanceOf(ZodError);
  });
});

describe("protected procedures", () => {
  it("refuse anonymous callers", async () => {
    const failure = await caller(null)
      .strava.athlete.listActivities({})
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(TRPCError);
    expect((failure as TRPCError).code).toBe("UNAUTHORIZED");
    expect(strava.constructedWith).toEqual([]);
  });

  it("fail loudly when no Strava token can be obtained", async () => {
    vi.mocked(getStravaAccessToken).mockResolvedValue(null);

    await expect(caller().strava.athlete.listActivities({})).rejects.toThrow(
      /No valid access token/,
    );
  });
});

describe("strava.athlete.listActivities", () => {
  it("builds a client from the user's token and forwards the query", async () => {
    strava.listActivities.mockResolvedValue([{ id: 1 }]);

    const activities = await caller().strava.athlete.listActivities({
      page: 2,
      per_page: 50,
      before: 1_700_000_000,
      after: 1_600_000_000,
    });

    expect(getStravaAccessToken).toHaveBeenCalledWith("user-1");
    expect(strava.constructedWith).toEqual(["access-token-1"]);
    expect(strava.listActivities).toHaveBeenCalledWith({
      page: 2,
      per_page: 50,
      before: 1_700_000_000,
      after: 1_600_000_000,
    });
    expect(activities).toEqual([{ id: 1 }]);
  });

  it("sends an empty query when the input is omitted", async () => {
    strava.listActivities.mockResolvedValue([]);

    await caller().strava.athlete.listActivities();

    expect(strava.listActivities).toHaveBeenCalledWith({});
  });
});

describe("strava.athlete.getActivity", () => {
  it("fetches a single activity by id", async () => {
    strava.getActivity.mockResolvedValue({ id: 99, name: "Hill repeats" });

    const activity = await caller().strava.athlete.getActivity({ id: "99" });

    expect(strava.getActivity).toHaveBeenCalledWith({ id: "99" });
    expect(activity).toMatchObject({ id: 99 });
  });
});

describe("strava.athlete.getActivityStreams", () => {
  it("defaults to medium resolution", async () => {
    strava.getStreams.mockResolvedValue([]);

    await caller().strava.athlete.getActivityStreams({
      id: "99",
      keys: ["latlng", "altitude"],
      key_by_type: true,
    });

    expect(strava.getStreams).toHaveBeenCalledWith({
      id: "99",
      keys: ["latlng", "altitude"],
      key_by_type: true,
      resolution: "medium",
    });
  });

  it("passes an explicit resolution through", async () => {
    strava.getStreams.mockResolvedValue([]);

    await caller().strava.athlete.getActivityStreams({
      id: "99",
      resolution: "high",
    });

    expect(strava.getStreams).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: "high" }),
    );
  });

  it("rejects an unknown resolution before calling Strava", async () => {
    await expect(
      caller().strava.athlete.getActivityStreams({
        id: "99",
        resolution: "ultra" as unknown as "high",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(strava.getStreams).not.toHaveBeenCalled();
  });

  it("propagates a Strava failure", async () => {
    strava.getStreams.mockRejectedValue(new Error("rate limited"));

    await expect(
      caller().strava.athlete.getActivityStreams({ id: "99" }),
    ).rejects.toThrow(/rate limited/);
  });
});

describe("strava.athlete.getActivitiesBatch", () => {
  it("returns the activities it could fetch and reports the rest", async () => {
    strava.getActivity.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "bad") throw new Error("404 not found");
      return { id, name: `Activity ${id}` };
    });

    const result = await caller().strava.athlete.getActivitiesBatch({
      ids: ["1", "bad", "2"],
    });

    expect(result.activities).toEqual([
      { id: "1", name: "Activity 1" },
      { id: "2", name: "Activity 2" },
    ]);
    expect(result.failed).toEqual([{ id: "bad", error: "404 not found" }]);
  });

  it("reuses a single client for the whole batch", async () => {
    strava.getActivity.mockResolvedValue({ id: "1" });

    await caller().strava.athlete.getActivitiesBatch({ ids: ["1", "2", "3"] });

    expect(strava.constructedWith).toEqual(["access-token-1"]);
    expect(strava.getActivity).toHaveBeenCalledTimes(3);
  });

  it("handles an empty id list", async () => {
    await expect(
      caller().strava.athlete.getActivitiesBatch({ ids: [] }),
    ).resolves.toEqual({ activities: [], failed: [] });
  });
});
