import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherSourceError } from "../weather/errors.ts";
import { AUSTIN_PLACE, AUSTRALIA_PLACE } from "./fixtures.ts";
import {
  OPEN_METEO_GEOCODING_DEFAULT_BASE_URL,
  OpenMeteoGeocoder,
  StaticGeocoder,
  describePlace,
  normalizeQuery,
  type FetchLike,
} from "./geocode.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sampleBody(): Record<string, unknown> {
  return {
    results: [
      {
        id: 4671654,
        name: "Austin",
        latitude: 30.26715,
        longitude: -97.74306,
        country_code: "US",
        timezone: "America/Chicago",
        country: "United States",
        admin1: "Texas",
      },
      { id: 1, name: "Austin", latitude: 44.6, longitude: -92.98, country: "United States", admin1: "Minnesota" },
    ],
    generationtime_ms: 0.6,
  };
}

function recordingFetch(response: Response | (() => Response)): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (input) => {
      calls.push(input);
      return typeof response === "function" ? response() : response;
    },
  };
}

describe("normalizeQuery", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizeQuery("  Paris,   France ", "t"), "Paris, France");
  });

  it("rejects queries shorter than two characters", () => {
    assert.throws(() => normalizeQuery("", "t"), (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-input");
    assert.throws(() => normalizeQuery(" a ", "t"), WeatherSourceError);
  });
});

describe("describePlace", () => {
  it("joins the known parts with commas", () => {
    assert.equal(describePlace(AUSTIN_PLACE), "Austin, Texas, United States");
    assert.equal(describePlace(AUSTRALIA_PLACE), "Austral, Australia");
    assert.equal(describePlace({ name: "Nowhere", region: undefined, country: undefined, location: { latitude: 0, longitude: 0 } }), "Nowhere");
  });
});

describe("OpenMeteoGeocoder", () => {
  it("builds a request against the default endpoint with the normalised query", () => {
    const geocoder = new OpenMeteoGeocoder();
    const url = new URL(geocoder.buildUrl("Paris, France", 5));
    assert.equal(url.origin + url.pathname, OPEN_METEO_GEOCODING_DEFAULT_BASE_URL);
    assert.equal(url.searchParams.get("name"), "Paris, France");
    assert.equal(url.searchParams.get("count"), "5");
    assert.equal(url.searchParams.get("language"), "en");
    assert.equal(url.searchParams.get("format"), "json");
  });

  it("parses places from a successful response", async () => {
    const { fetch, calls } = recordingFetch(jsonResponse(sampleBody()));
    const geocoder = new OpenMeteoGeocoder({ fetch });

    const places = await geocoder.searchPlaces("  austin ", { count: 2 });

    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]!).searchParams.get("name"), "austin");
    assert.equal(new URL(calls[0]!).searchParams.get("count"), "2");
    assert.deepEqual(places, [
      { name: "Austin", region: "Texas", country: "United States", location: { latitude: 30.26715, longitude: -97.74306 } },
      { name: "Austin", region: "Minnesota", country: "United States", location: { latitude: 44.6, longitude: -92.98 } },
    ]);
  });

  it("treats a body without results as no match, not an error", async () => {
    const { fetch } = recordingFetch(jsonResponse({ generationtime_ms: 0.2 }));
    const geocoder = new OpenMeteoGeocoder({ fetch });

    assert.deepEqual(await geocoder.searchPlaces("zzzzzz"), []);
  });

  it("omits region and country when the provider leaves them out", async () => {
    const { fetch } = recordingFetch(jsonResponse({ results: [{ name: "X", latitude: 1, longitude: 2, admin1: "" }] }));
    const geocoder = new OpenMeteoGeocoder({ fetch });

    const [place] = await geocoder.searchPlaces("xx");
    assert.deepEqual(place, { name: "X", region: undefined, country: undefined, location: { latitude: 1, longitude: 2 } });
  });

  it("validates input before making any request", async () => {
    const { fetch, calls } = recordingFetch(jsonResponse(sampleBody()));
    const geocoder = new OpenMeteoGeocoder({ fetch });

    await assert.rejects(geocoder.searchPlaces("a"), (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-input");
    await assert.rejects(geocoder.searchPlaces("austin", { count: 0 }), (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-input");
    await assert.rejects(geocoder.searchPlaces("austin", { count: 21 }), WeatherSourceError);
    assert.equal(calls.length, 0);
  });

  it("classifies transport failures as network errors", async () => {
    const geocoder = new OpenMeteoGeocoder({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await assert.rejects(geocoder.searchPlaces("austin"), (error: unknown) => {
      assert.ok(error instanceof WeatherSourceError);
      assert.equal(error.kind, "network");
      assert.equal(error.source, "open-meteo-geocoding");
      assert.ok(error.cause instanceof TypeError);
      return true;
    });
  });

  it("classifies non-success statuses as upstream errors with the reason", async () => {
    const { fetch } = recordingFetch(jsonResponse({ error: true, reason: "rate limited" }, 429));
    const geocoder = new OpenMeteoGeocoder({ fetch });

    await assert.rejects(geocoder.searchPlaces("austin"), (error: unknown) => {
      assert.ok(error instanceof WeatherSourceError);
      assert.equal(error.kind, "upstream");
      assert.equal(error.status, 429);
      assert.match(error.message, /rate limited/);
      return true;
    });
  });

  it("classifies non-JSON and malformed bodies as invalid responses", async () => {
    const nonJson = new OpenMeteoGeocoder({ fetch: async () => new Response("<html>", { status: 200 }) });
    await assert.rejects(nonJson.searchPlaces("austin"), (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-response");

    const badShape = new OpenMeteoGeocoder({ fetch: async () => jsonResponse({ results: [{ name: "Austin" }] }) });
    await assert.rejects(badShape.searchPlaces("austin"), (error: unknown) => {
      assert.ok(error instanceof WeatherSourceError);
      assert.equal(error.kind, "invalid-response");
      assert.match(error.message, /results\[0\]\.latitude/);
      return true;
    });

    const notArray = new OpenMeteoGeocoder({ fetch: async () => jsonResponse({ results: "nope" }) });
    await assert.rejects(notArray.searchPlaces("austin"), /results to be an array/);

    const notObject = new OpenMeteoGeocoder({ fetch: async () => jsonResponse(["Austin"]) });
    await assert.rejects(notObject.searchPlaces("austin"), /response body to be an object/);
  });

  it("names the offending field when a result entry is malformed", () => {
    const geocoder = new OpenMeteoGeocoder();
    const invalid = (pattern: RegExp) => (error: unknown) => {
      assert.ok(error instanceof WeatherSourceError);
      assert.equal(error.kind, "invalid-response");
      assert.match(error.message, pattern);
      return true;
    };
    assert.throws(() => geocoder.parsePlaces({ results: ["Austin"] }), invalid(/results\[0\] to be an object/));
    assert.throws(() => geocoder.parsePlaces({ results: [{ name: "", latitude: 1, longitude: 2 }] }), invalid(/results\[0\]\.name/));
    assert.throws(() => geocoder.parsePlaces({ results: [{ name: "A", latitude: "1", longitude: 2 }] }), invalid(/results\[0\]\.latitude/));
    assert.throws(() => geocoder.parsePlaces({ results: [{ name: "A", latitude: 1, longitude: Number.NaN }] }), invalid(/results\[0\]\.longitude/));
    assert.throws(() => geocoder.parsePlaces({ results: [{}, { name: "A", latitude: 1 }] }), invalid(/results\[0\]\.name/));
  });

  it("falls back to a generic reason when an upstream error has none", async () => {
    const geocoder = new OpenMeteoGeocoder({ fetch: async () => jsonResponse({}, 500) });
    await assert.rejects(geocoder.searchPlaces("austin"), (error: unknown) => {
      assert.ok(error instanceof WeatherSourceError);
      assert.equal(error.kind, "upstream");
      assert.equal(error.status, 500);
      assert.match(error.message, /HTTP 500: no error reason provided/);
      return true;
    });
  });

  it("passes the abort signal through to fetch", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const geocoder = new OpenMeteoGeocoder({
      fetch: async (_input, init) => {
        received = init?.signal;
        return jsonResponse(sampleBody());
      },
    });

    await geocoder.searchPlaces("austin", { signal: controller.signal });
    assert.equal(received, controller.signal);
  });
});

describe("StaticGeocoder", () => {
  const geocoder = new StaticGeocoder([AUSTIN_PLACE, AUSTRALIA_PLACE]);

  it("matches by case-insensitive name prefix, in registration order", async () => {
    assert.deepEqual(await geocoder.searchPlaces("AUST"), [AUSTIN_PLACE, AUSTRALIA_PLACE]);
    assert.deepEqual(await geocoder.searchPlaces("austin"), [AUSTIN_PLACE]);
    assert.deepEqual(await geocoder.searchPlaces("Austral"), [AUSTRALIA_PLACE]);
  });

  it("honours count and returns an empty list for no match", async () => {
    assert.deepEqual(await geocoder.searchPlaces("aust", { count: 1 }), [AUSTIN_PLACE]);
    assert.deepEqual(await geocoder.searchPlaces("paris"), []);
  });

  it("applies the same input validation as the real provider", async () => {
    await assert.rejects(geocoder.searchPlaces("a"), (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-input");
  });
});
