import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherSourceError } from "./errors.ts";
import { OPEN_METEO_DEFAULT_BASE_URL, OpenMeteoDataSource, type FetchLike } from "./open-meteo.ts";

const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };
const FIXED_NOW = new Date("2026-09-18T12:00:00.000Z");

function sampleBody(days = 3): Record<string, unknown> {
  const dates = Array.from({ length: days }, (_, i) => `2026-09-${String(18 + i).padStart(2, "0")}`);
  return {
    latitude: 30.25,
    longitude: -97.75,
    timezone: "America/Chicago",
    current: {
      time: "2026-09-18T07:00",
      temperature_2m: 24.1,
      apparent_temperature: 26.3,
      relative_humidity_2m: 78,
      weather_code: 2,
      wind_speed_10m: 9.4,
      wind_direction_10m: 160,
    },
    daily: {
      time: dates,
      weather_code: dates.map((_, i) => [2, 61, 95][i % 3]),
      temperature_2m_max: dates.map((_, i) => 33 + i),
      temperature_2m_min: dates.map((_, i) => 22 + i),
      precipitation_probability_max: dates.map((_, i) => (i === 1 ? null : 10 * i)),
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RecordedCall {
  url: string;
  signal: AbortSignal | undefined;
}

function fakeFetch(respond: (url: string) => Response | Promise<Response>): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, signal: init?.signal });
    return respond(url);
  };
  return { fetch, calls };
}

async function expectError(promise: Promise<unknown>, kind: WeatherSourceError["kind"]): Promise<WeatherSourceError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WeatherSourceError, `expected WeatherSourceError, got ${String(error)}`);
    assert.equal(error.kind, kind);
    assert.equal(error.source, "open-meteo");
    return error;
  }
  assert.fail(`expected promise to reject with ${kind}`);
}

describe("OpenMeteoDataSource", () => {
  it("requests the expected URL with metric units and auto timezone", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(sampleBody()));
    const source = new OpenMeteoDataSource({ fetch, now: () => FIXED_NOW });

    await source.fetchWeather(AUSTIN, { forecastDays: 3 });

    assert.equal(calls.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(`${url.origin}${url.pathname}`, OPEN_METEO_DEFAULT_BASE_URL);
    assert.equal(url.searchParams.get("latitude"), "30.2672");
    assert.equal(url.searchParams.get("longitude"), "-97.7431");
    assert.equal(url.searchParams.get("forecast_days"), "3");
    assert.equal(url.searchParams.get("timezone"), "auto");
    assert.equal(url.searchParams.get("temperature_unit"), "celsius");
    assert.equal(url.searchParams.get("wind_speed_unit"), "kmh");
    assert.ok(url.searchParams.get("current")?.includes("weather_code"));
    assert.ok(url.searchParams.get("daily")?.includes("temperature_2m_max"));
  });

  it("maps a successful response onto a WeatherReport", async () => {
    const { fetch } = fakeFetch(() => jsonResponse(sampleBody()));
    const source = new OpenMeteoDataSource({ fetch, now: () => FIXED_NOW });

    const report = await source.fetchWeather(AUSTIN, { forecastDays: 3 });

    assert.deepEqual(report.location, AUSTIN);
    assert.equal(report.timezone, "America/Chicago");
    assert.equal(report.source, "open-meteo");
    assert.equal(report.fetchedAt, FIXED_NOW.toISOString());

    assert.deepEqual(report.current, {
      observedAt: "2026-09-18T07:00",
      temperatureC: 24.1,
      apparentTemperatureC: 26.3,
      humidityPercent: 78,
      windSpeedKph: 9.4,
      windDirectionDeg: 160,
      condition: { category: "partly-cloudy", description: "Partly cloudy", code: 2 },
    });

    assert.equal(report.daily.length, 3);
    assert.deepEqual(report.daily[0], {
      date: "2026-09-18",
      highC: 33,
      lowC: 22,
      precipitationChancePercent: 0,
      condition: { category: "partly-cloudy", description: "Partly cloudy", code: 2 },
    });
    assert.equal(report.daily[1]!.condition.category, "rain");
    assert.equal(report.daily[1]!.precipitationChancePercent, 0, "null probability is reported as 0");
    assert.equal(report.daily[2]!.condition.category, "thunderstorm");
    assert.equal(report.daily[2]!.precipitationChancePercent, 20);
  });

  it("defaults to seven forecast days and truncates longer upstream arrays", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(sampleBody(10)));
    const source = new OpenMeteoDataSource({ fetch });

    const report = await source.fetchWeather(AUSTIN);

    assert.equal(new URL(calls[0]!.url).searchParams.get("forecast_days"), "7");
    assert.equal(report.daily.length, 7);
  });

  it("honours a custom base URL and forwards the abort signal", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(sampleBody()));
    const source = new OpenMeteoDataSource({ fetch, baseUrl: "http://localhost:8080/v1/forecast" });
    const controller = new AbortController();

    await source.fetchWeather(AUSTIN, { signal: controller.signal });

    assert.ok(calls[0]!.url.startsWith("http://localhost:8080/v1/forecast?"));
    assert.equal(calls[0]!.signal, controller.signal);
  });

  it("rejects out-of-range coordinates before making a request", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(sampleBody()));
    const source = new OpenMeteoDataSource({ fetch });

    await expectError(source.fetchWeather({ latitude: 91, longitude: 0 }), "invalid-input");
    await expectError(source.fetchWeather({ latitude: 0, longitude: -180.5 }), "invalid-input");
    await expectError(source.fetchWeather({ latitude: Number.NaN, longitude: 0 }), "invalid-input");
    assert.equal(calls.length, 0);
  });

  it("rejects invalid forecastDays before making a request", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(sampleBody()));
    const source = new OpenMeteoDataSource({ fetch });

    await expectError(source.fetchWeather(AUSTIN, { forecastDays: 0 }), "invalid-input");
    await expectError(source.fetchWeather(AUSTIN, { forecastDays: 17 }), "invalid-input");
    await expectError(source.fetchWeather(AUSTIN, { forecastDays: 2.5 }), "invalid-input");
    assert.equal(calls.length, 0);
  });

  it("classifies transport failures as network errors and preserves the cause", async () => {
    const boom = new TypeError("fetch failed");
    const { fetch } = fakeFetch(() => {
      throw boom;
    });
    const source = new OpenMeteoDataSource({ fetch });

    const error = await expectError(source.fetchWeather(AUSTIN), "network");
    assert.equal(error.cause, boom);
    assert.match(error.message, /fetch failed/);
  });

  it("classifies non-2xx responses as upstream errors with the status and reason", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: true, reason: "Latitude must be in range" }, 400));
    const source = new OpenMeteoDataSource({ fetch });

    const error = await expectError(source.fetchWeather(AUSTIN), "upstream");
    assert.equal(error.status, 400);
    assert.match(error.message, /HTTP 400/);
    assert.match(error.message, /Latitude must be in range/);
  });

  it("classifies a non-JSON body as an invalid response", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>gateway timeout</html>", { status: 504 }));
    const source = new OpenMeteoDataSource({ fetch });

    const error = await expectError(source.fetchWeather(AUSTIN), "invalid-response");
    assert.equal(error.status, 504);
  });

  it("rejects a 2xx body missing required fields", async () => {
    const body = sampleBody();
    delete (body["current"] as Record<string, unknown>)["temperature_2m"];
    const { fetch } = fakeFetch(() => jsonResponse(body));
    const source = new OpenMeteoDataSource({ fetch });

    const error = await expectError(source.fetchWeather(AUSTIN), "invalid-response");
    assert.match(error.message, /current\.temperature_2m/);
  });

  it("names the offending field when a section has the wrong shape", async () => {
    const source = new OpenMeteoDataSource();
    const invalid = (pattern: RegExp) => (error: unknown) => {
      assert.ok(error instanceof WeatherSourceError);
      assert.equal(error.kind, "invalid-response");
      assert.equal(error.source, "open-meteo");
      assert.match(error.message, pattern);
      return true;
    };

    assert.throws(() => source.parseReport(["not", "an", "object"], AUSTIN, 3), invalid(/response body to be an object/));
    assert.throws(() => source.parseReport(null, AUSTIN, 3), invalid(/response body to be an object/));

    const noTimezone = sampleBody();
    noTimezone["timezone"] = "";
    assert.throws(() => source.parseReport(noTimezone, AUSTIN, 3), invalid(/timezone to be a non-empty string/));

    const currentNotObject = sampleBody();
    currentNotObject["current"] = "sunny";
    assert.throws(() => source.parseReport(currentNotObject, AUSTIN, 3), invalid(/expected current to be an object/));

    const dailyNotArray = sampleBody();
    (dailyNotArray["daily"] as Record<string, unknown>)["time"] = "2026-09-18";
    assert.throws(() => source.parseReport(dailyNotArray, AUSTIN, 3), invalid(/daily\.time to be an array/));

    const dateNotString = sampleBody();
    (dateNotString["daily"] as Record<string, unknown[]>)["time"]![0] = 20260918;
    assert.throws(() => source.parseReport(dateNotString, AUSTIN, 3), invalid(/daily\.time\[0\] to be a non-empty string/));

    const highNotNumber = sampleBody();
    (highNotNumber["daily"] as Record<string, unknown[]>)["temperature_2m_max"]![1] = "33";
    assert.throws(() => source.parseReport(highNotNumber, AUSTIN, 3), invalid(/daily\.temperature_2m_max\[1\]/));

    // A well-formed body still parses through the same entry point.
    assert.equal(source.parseReport(sampleBody(), AUSTIN, 3).daily.length, 3);
  });

  it("falls back to a generic reason when an upstream error has none", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: true }, 503));
    const source = new OpenMeteoDataSource({ fetch });

    const error = await expectError(source.fetchWeather(AUSTIN), "upstream");
    assert.equal(error.status, 503);
    assert.match(error.message, /HTTP 503: no error reason provided/);
  });

  it("rejects daily arrays of mismatched length", async () => {
    const body = sampleBody();
    (body["daily"] as Record<string, unknown[]>)["temperature_2m_min"] = [22];
    const { fetch } = fakeFetch(() => jsonResponse(body));
    const source = new OpenMeteoDataSource({ fetch });

    const error = await expectError(source.fetchWeather(AUSTIN), "invalid-response");
    assert.match(error.message, /mismatched lengths/);
  });

  it("rejects an empty daily forecast", async () => {
    const body = sampleBody(0);
    const { fetch } = fakeFetch(() => jsonResponse(body));
    const source = new OpenMeteoDataSource({ fetch });

    await expectError(source.fetchWeather(AUSTIN), "invalid-response");
  });

  it("keeps unknown WMO codes rather than failing the report", async () => {
    const body = sampleBody();
    (body["current"] as Record<string, unknown>)["weather_code"] = 42;
    const { fetch } = fakeFetch(() => jsonResponse(body));
    const source = new OpenMeteoDataSource({ fetch });

    const report = await source.fetchWeather(AUSTIN);
    assert.equal(report.current.condition.category, "unknown");
    assert.equal(report.current.condition.code, 42);
  });
});
