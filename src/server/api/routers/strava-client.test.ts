import stravaApi, {
  type RequestOptions,
  type StravaClientInstance,
} from "strava-v3";
import { describe, expect, it, vi } from "vitest";

/**
 * strava-v3 jumped from 2.x to 4.x, which rewrote the HTTP layer (request ->
 * axios) and reshaped the published types. The router only uses three
 * endpoints; these tests pin the request each one produces by injecting the
 * client's optional request function instead of letting it reach the network.
 */
const ACCESS_TOKEN = "access-token-1";

function clientWith(response: unknown) {
  const request = vi.fn(async (_options: RequestOptions) => ({
    headers: {},
    body: response,
  }));

  // The published constructor signature takes (token, request); the router
  // calls it with the token only and gets the axios-backed default.
  const client: StravaClientInstance = new stravaApi.client(
    ACCESS_TOKEN,
    request,
  );

  return { client, request };
}

function lastOptions(request: { mock: { calls: [RequestOptions][] } }) {
  return request.mock.calls.at(-1)![0];
}

describe("strava-v3 client construction", () => {
  it("exposes a client constructor on the default export", () => {
    // The router casts the default export because the 2.x typings had no
    // `client`; 4.x publishes it, so the cast is no longer load-bearing.
    expect(typeof stravaApi.client).toBe("function");
  });

  it("gives the router the athlete, activities and streams namespaces", () => {
    const { client } = clientWith([]);

    expect(typeof client.athlete.listActivities).toBe("function");
    expect(typeof client.activities.get).toBe("function");
    expect(typeof client.streams.activity).toBe("function");
    expect(client.access_token).toBe(ACCESS_TOKEN);
  });

  it("sends the access token as a bearer header", async () => {
    const { client, request } = clientWith([]);

    await client.athlete.listActivities({});

    expect(lastOptions(request).headers).toMatchObject({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    });
  });
});

describe("athlete.listActivities", () => {
  it("puts pagination and the time window in the query string", async () => {
    const { client, request } = clientWith([]);

    await client.athlete.listActivities({
      page: 2,
      per_page: 50,
      before: 1_700_000_000,
      after: 1_600_000_000,
    });

    expect(lastOptions(request).url).toBe(
      "athlete/activities?page=2&per_page=50&before=1700000000&after=1600000000",
    );
  });

  it("asks for the default page when given no arguments", async () => {
    const { client, request } = clientWith([]);

    await client.athlete.listActivities({});

    expect(lastOptions(request).url).toBe("athlete/activities?");
  });

  it("returns the decoded body", async () => {
    const { client } = clientWith([{ id: 1, name: "Morning Ride" }]);

    await expect(client.athlete.listActivities({})).resolves.toEqual([
      { id: 1, name: "Morning Ride" },
    ]);
  });
});

describe("activities.get", () => {
  it("addresses the activity by id", async () => {
    const { client, request } = clientWith({ id: 99 });

    await client.activities.get({ id: "99" });

    expect(lastOptions(request).url).toBe("activities/99?");
  });

  it("refuses to build a request without an id", async () => {
    const { client, request } = clientWith({});

    await expect(
      client.activities.get({ id: undefined as unknown as string }),
    ).rejects.toThrow(/id/i);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("streams.activity", () => {
  it("passes the stream keys, grouping and resolution the router asks for", async () => {
    const { client, request } = clientWith([]);

    await client.streams.activity({
      id: "99",
      keys: ["latlng", "altitude"],
      key_by_type: true,
      resolution: "medium",
    });

    const url = lastOptions(request).url;
    expect(url.startsWith("activities/99/streams?")).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.getAll("keys")).toEqual(["latlng", "altitude"]);
    expect(query.get("key_by_type")).toBe("true");
    expect(query.get("resolution")).toBe("medium");
  });

  it("refuses to build a request without an id", async () => {
    const { client, request } = clientWith([]);

    await expect(
      client.streams.activity({ id: undefined as unknown as string }),
    ).rejects.toThrow(/id/i);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("response decoding", () => {
  it("parses a JSON string body", async () => {
    const { client } = clientWith(JSON.stringify([{ id: 42 }]));

    await expect(client.athlete.listActivities({})).resolves.toEqual([
      { id: 42 },
    ]);
  });

  it("keeps a 13-digit Strava activity id usable as a number", async () => {
    // v4 parses responses with json-bigint. Real Strava activity ids are well
    // inside Number.MAX_SAFE_INTEGER, and the map helpers call `.toString()`
    // on them.
    const { client } = clientWith(JSON.stringify([{ id: 1234567890123 }]));

    const [activity] = await client.athlete.listActivities({});

    expect(activity!.id.toString()).toBe("1234567890123");
  });
});
