import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherSourceError } from "../weather/errors.ts";
import { StaticWeatherDataSource } from "../weather/static.ts";
import type { WeatherDataSource, WeatherReport } from "../weather/types.ts";
import {
  BadRequestError,
  HTML_CONTENT_TYPE,
  JSON_CONTENT_TYPE,
  createWeatherApp,
  parseCoordinates,
  parseDays,
  parseSearchState,
  statusForSourceError,
  type AppResponse,
  type WeatherApp,
} from "./app.ts";
import { AUSTIN_PLACE, AUSTIN_REPORT, AUSTRALIA_PLACE } from "./fixtures.ts";
import { StaticGeocoder, type Geocoder } from "./geocode.ts";

function buildApp(overrides: { weather?: WeatherDataSource; geocoder?: Geocoder } = {}): WeatherApp {
  return createWeatherApp({
    weather: overrides.weather ?? new StaticWeatherDataSource([AUSTIN_REPORT]),
    geocoder: overrides.geocoder ?? new StaticGeocoder([AUSTIN_PLACE, AUSTRALIA_PLACE]),
  });
}

function get(app: WeatherApp, path: string, method = "GET"): Promise<AppResponse> {
  return app.handle({ method, url: new URL(path, "http://weather.test") });
}

function parseJson(response: AppResponse): unknown {
  assert.equal(response.headers["content-type"], JSON_CONTENT_TYPE);
  return JSON.parse(response.body);
}

function failingSource(error: Error): WeatherDataSource {
  return {
    name: "failing",
    fetchWeather: async () => {
      throw error;
    },
  };
}

describe("parameter parsing", () => {
  it("parses the search form with defaults", () => {
    assert.deepEqual(parseSearchState(new URLSearchParams("")), { query: "", days: 7, units: "metric" });
    assert.deepEqual(parseSearchState(new URLSearchParams("q=+Austin+&days=3&units=imperial")), {
      query: "Austin",
      days: 3,
      units: "imperial",
    });
    assert.deepEqual(parseSearchState(new URLSearchParams("days=&units=")), { query: "", days: 7, units: "metric" });
  });

  it("rejects unknown units and out-of-range or fractional days", () => {
    assert.throws(() => parseSearchState(new URLSearchParams("units=kelvin")), BadRequestError);
    assert.throws(() => parseDays(new URLSearchParams("days=0")), /between 1 and 16/);
    assert.throws(() => parseDays(new URLSearchParams("days=17")), BadRequestError);
    assert.throws(() => parseDays(new URLSearchParams("days=2.5")), /must be an integer/);
    assert.throws(() => parseDays(new URLSearchParams("days=soon")), BadRequestError);
  });

  it("parses coordinates and rejects missing or non-numeric values", () => {
    assert.deepEqual(parseCoordinates(new URLSearchParams("lat=30.27&lon=-97.74")), { latitude: 30.27, longitude: -97.74 });
    assert.throws(() => parseCoordinates(new URLSearchParams("lat=30.27")), /lon is required/);
    assert.throws(() => parseCoordinates(new URLSearchParams("lat=north&lon=1")), /lat must be a number/);
  });
});

describe("statusForSourceError", () => {
  it("maps caller mistakes to 400, missing data to 404, and provider trouble to 502", () => {
    assert.equal(statusForSourceError(new WeatherSourceError("invalid-input", "s", "m")), 400);
    assert.equal(statusForSourceError(new WeatherSourceError("upstream", "s", "m", { status: 404 })), 404);
    assert.equal(statusForSourceError(new WeatherSourceError("upstream", "s", "m", { status: 500 })), 502);
    assert.equal(statusForSourceError(new WeatherSourceError("network", "s", "m")), 502);
    assert.equal(statusForSourceError(new WeatherSourceError("invalid-response", "s", "m")), 502);
  });
});

describe("GET /", () => {
  it("serves the landing page when there is no search", async () => {
    const response = await get(buildApp(), "/");
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], HTML_CONTENT_TYPE);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /<p class="hint">/);
    assert.doesNotMatch(response.body, /<section class="current"/);
  });

  it("geocodes a place query and renders its weather with the resolved name", async () => {
    const response = await get(buildApp(), "/?q=austin&days=2");
    assert.equal(response.status, 200);
    assert.match(response.body, /<title>Austin, Texas, United States · Weather<\/title>/);
    assert.match(response.body, /<span class="temp">24°C<\/span>/);
    assert.match(response.body, /2-day forecast/);
    assert.match(response.body, /value="austin"/, "the query is echoed back into the form");
  });

  it("renders weather for explicit coordinates, titled by the coordinates", async () => {
    const response = await get(buildApp(), "/?lat=30.27&lon=-97.74&units=imperial");
    assert.equal(response.status, 200);
    assert.match(response.body, /<h2 id="place">30\.27°N, 97\.74°W<\/h2>/);
    assert.match(response.body, /<span class="temp">75°F<\/span>/);
  });

  it("prefers coordinates over a place query when both are given", async () => {
    let geocodeCalls = 0;
    const geocoder: Geocoder = {
      name: "counting",
      searchPlaces: async () => {
        geocodeCalls += 1;
        return [AUSTIN_PLACE];
      },
    };
    const response = await get(buildApp({ geocoder }), "/?q=anything&lat=30.27&lon=-97.74");
    assert.equal(response.status, 200);
    assert.equal(geocodeCalls, 0);
  });

  it("returns 404 with a helpful message when no place matches", async () => {
    const response = await get(buildApp(), "/?q=atlantis");
    assert.equal(response.status, 404);
    assert.match(response.body, /role="alert"/);
    assert.match(response.body, /Nothing matched &quot;atlantis&quot;/);
    assert.match(response.body, /value="atlantis"/);
  });

  it("returns 400 for bad form values without calling any source", async () => {
    let calls = 0;
    const weather: WeatherDataSource = {
      name: "counting",
      fetchWeather: async () => {
        calls += 1;
        return AUSTIN_REPORT;
      },
    };
    const app = buildApp({ weather });

    for (const path of ["/?q=austin&days=99", "/?q=austin&units=kelvin", "/?lat=abc&lon=1", "/?lat=30.27"]) {
      const response = await get(app, path);
      assert.equal(response.status, 400, path);
      assert.match(response.body, /Invalid request/);
    }
    assert.equal(calls, 0);
  });

  it("returns 400 for a place query the geocoder rejects", async () => {
    const response = await get(buildApp(), "/?q=a");
    assert.equal(response.status, 400);
    assert.match(response.body, /at least 2 characters/);
  });

  it("returns 400 when the weather source rejects the coordinates", async () => {
    const response = await get(buildApp(), "/?lat=95&lon=0");
    assert.equal(response.status, 400);
    assert.match(response.body, /latitude must be/);
  });

  it("returns 502 and explains when the weather service is unreachable", async () => {
    const weather = failingSource(new WeatherSourceError("network", "open-meteo", "Request to Open-Meteo failed: offline"));
    const response = await get(buildApp({ weather }), "/?q=austin");
    assert.equal(response.status, 502);
    assert.match(response.body, /Weather service unreachable/);
    assert.match(response.body, /offline/);
  });

  it("returns 502 when the geocoder fails upstream", async () => {
    const geocoder: Geocoder = {
      name: "broken",
      searchPlaces: async () => {
        throw new WeatherSourceError("upstream", "broken", "HTTP 503", { status: 503 });
      },
    };
    const response = await get(buildApp({ geocoder }), "/?q=austin");
    assert.equal(response.status, 502);
    assert.match(response.body, /Weather service error/);
  });

  it("returns 502 and explains when the provider sends unusable data", async () => {
    const weather = failingSource(new WeatherSourceError("invalid-response", "open-meteo", "expected daily to be an object"));
    const response = await get(buildApp({ weather }), "/?q=austin");
    assert.equal(response.status, 502);
    assert.equal(response.headers["content-type"], HTML_CONTENT_TYPE);
    assert.match(response.body, /Unexpected weather data/);
    assert.match(response.body, /expected daily to be an object/);
  });

  it("rethrows unexpected errors so the transport can report a 500", async () => {
    const weather = failingSource(new RangeError("boom"));
    await assert.rejects(get(buildApp({ weather }), "/?q=austin"), RangeError);
  });
});

describe("GET /api/weather", () => {
  it("returns the report as JSON", async () => {
    const response = await get(buildApp(), "/api/weather?lat=30.27&lon=-97.74&days=1");
    assert.equal(response.status, 200);
    const report = parseJson(response) as WeatherReport;
    assert.equal(report.source, "static");
    assert.equal(report.current.temperatureC, 24.1);
    assert.equal(report.daily.length, 1);
  });

  it("returns a structured 400 for missing or invalid parameters", async () => {
    const missing = await get(buildApp(), "/api/weather?lat=30.27");
    assert.equal(missing.status, 400);
    assert.deepEqual(parseJson(missing), { error: { kind: "invalid-input", message: "lon is required" } });

    const outOfRange = await get(buildApp(), "/api/weather?lat=95&lon=0");
    assert.equal(outOfRange.status, 400);
    const body = parseJson(outOfRange) as { error: { kind: string; source: string } };
    assert.equal(body.error.kind, "invalid-input");
    assert.equal(body.error.source, "static");
  });

  it("returns 404 when the source has no data for the location", async () => {
    const response = await get(buildApp(), "/api/weather?lat=0&lon=0");
    assert.equal(response.status, 404);
    const body = parseJson(response) as { error: { kind: string } };
    assert.equal(body.error.kind, "upstream");
  });

  it("returns 502 with the error kind when the provider fails", async () => {
    const weather = failingSource(new WeatherSourceError("invalid-response", "open-meteo", "expected current to be an object"));
    const response = await get(buildApp({ weather }), "/api/weather?lat=30.27&lon=-97.74");
    assert.equal(response.status, 502);
    assert.deepEqual(parseJson(response), {
      error: { kind: "invalid-response", source: "open-meteo", message: "expected current to be an object" },
    });
  });

  it("rethrows unexpected errors instead of disguising them as provider failures", async () => {
    const weather = failingSource(new RangeError("boom"));
    await assert.rejects(get(buildApp({ weather }), "/api/weather?lat=30.27&lon=-97.74"), RangeError);
  });
});

describe("GET /api/geocode", () => {
  it("returns matching places with a display label", async () => {
    const response = await get(buildApp(), "/api/geocode?q=aust&count=1");
    assert.equal(response.status, 200);
    assert.deepEqual(parseJson(response), {
      results: [
        {
          name: "Austin",
          region: "Texas",
          country: "United States",
          label: "Austin, Texas, United States",
          latitude: 30.27,
          longitude: -97.74,
        },
      ],
    });
  });

  it("returns an empty list, not an error, for no match", async () => {
    const response = await get(buildApp(), "/api/geocode?q=nowhere");
    assert.equal(response.status, 200);
    assert.deepEqual(parseJson(response), { results: [] });
  });

  it("returns 400 for a missing or too-short query and for a bad count", async () => {
    const missing = await get(buildApp(), "/api/geocode");
    assert.equal(missing.status, 400);
    assert.match((parseJson(missing) as { error: { message: string } }).error.message, /at least 2 characters/);

    const badCount = await get(buildApp(), "/api/geocode?q=austin&count=x");
    assert.equal(badCount.status, 400);
    assert.match((parseJson(badCount) as { error: { message: string } }).error.message, /count must be an integer/);
  });
});

describe("other routes", () => {
  it("answers the health check with the configured source names", async () => {
    const response = await get(buildApp(), "/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(parseJson(response), { status: "ok", weatherSource: "static", geocoder: "static-geocoding" });
  });

  it("returns 404 for unknown paths, as JSON under /api and HTML elsewhere", async () => {
    const api = await get(buildApp(), "/api/nope");
    assert.equal(api.status, 404);
    assert.deepEqual(parseJson(api), { error: { kind: "not-found", message: "no route for /api/nope" } });

    const page = await get(buildApp(), "/nope");
    assert.equal(page.status, 404);
    assert.equal(page.headers["content-type"], HTML_CONTENT_TYPE);
    assert.match(page.body, /Not found/);
  });

  it("rejects non-GET methods with 405 and an Allow header", async () => {
    const api = await get(buildApp(), "/api/weather?lat=1&lon=1", "POST");
    assert.equal(api.status, 405);
    assert.equal(api.headers["allow"], "GET, HEAD");

    const page = await get(buildApp(), "/", "DELETE");
    assert.equal(page.status, 405);
    assert.match(page.body, /Method not allowed/);
  });

  it("treats HEAD like GET", async () => {
    const response = await get(buildApp(), "/healthz", "HEAD");
    assert.equal(response.status, 200);
  });
});
