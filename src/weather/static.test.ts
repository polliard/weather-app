import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherSourceError } from "./errors.ts";
import { StaticWeatherDataSource, locationKey } from "./static.ts";
import type { WeatherReport } from "./types.ts";

const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };

const AUSTIN_REPORT: WeatherReport = {
  location: AUSTIN,
  timezone: "America/Chicago",
  source: "fixture",
  fetchedAt: "2026-09-18T12:00:00.000Z",
  current: {
    observedAt: "2026-09-18T07:00",
    temperatureC: 24,
    apparentTemperatureC: 26,
    humidityPercent: 70,
    windSpeedKph: 8,
    windDirectionDeg: 180,
    condition: { category: "clear", description: "Clear sky", code: 0 },
  },
  daily: Array.from({ length: 5 }, (_, i) => ({
    date: `2026-09-${18 + i}`,
    highC: 33,
    lowC: 22,
    precipitationChancePercent: 5,
    condition: { category: "clear", description: "Clear sky", code: 0 },
  })),
};

describe("locationKey", () => {
  it("rounds to two decimal places so nearby coordinates share a key", () => {
    assert.equal(locationKey({ latitude: 30.2672, longitude: -97.7431 }), "30.27,-97.74");
    assert.equal(locationKey({ latitude: 30.271, longitude: -97.744 }), "30.27,-97.74");
    assert.notEqual(locationKey({ latitude: 30.28, longitude: -97.74 }), locationKey(AUSTIN));
  });
});

describe("StaticWeatherDataSource", () => {
  it("serves a registered report, stamping its own source name", async () => {
    const source = new StaticWeatherDataSource([AUSTIN_REPORT]);

    const report = await source.fetchWeather({ latitude: 30.271, longitude: -97.744 });

    assert.equal(report.source, "static");
    assert.equal(report.timezone, "America/Chicago");
    assert.equal(report.daily.length, 5);
    assert.deepEqual(report.current, AUSTIN_REPORT.current);
  });

  it("truncates the daily forecast to forecastDays", async () => {
    const source = new StaticWeatherDataSource().add(AUSTIN_REPORT);

    const report = await source.fetchWeather(AUSTIN, { forecastDays: 2 });

    assert.equal(report.daily.length, 2);
  });

  it("fails with an upstream 404-style error for unknown locations", async () => {
    const source = new StaticWeatherDataSource([AUSTIN_REPORT]);

    await assert.rejects(
      source.fetchWeather({ latitude: 51.5, longitude: -0.12 }),
      (error: unknown) =>
        error instanceof WeatherSourceError &&
        error.kind === "upstream" &&
        error.status === 404 &&
        error.source === "static",
    );
  });

  it("validates input like a real provider", async () => {
    const source = new StaticWeatherDataSource([AUSTIN_REPORT]);

    await assert.rejects(
      source.fetchWeather({ latitude: 100, longitude: 0 }),
      (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-input",
    );
    await assert.rejects(
      source.fetchWeather(AUSTIN, { forecastDays: 0 }),
      (error: unknown) => error instanceof WeatherSourceError && error.kind === "invalid-input",
    );
  });

  it("honours an already-aborted signal", async () => {
    const source = new StaticWeatherDataSource([AUSTIN_REPORT]);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(source.fetchWeather(AUSTIN, { signal: controller.signal }), { name: "AbortError" });
  });
});
