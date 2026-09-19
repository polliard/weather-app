/**
 * Live integration test against the real Open-Meteo API.
 *
 * Skipped by default so `npm test` stays deterministic and offline. Opt in
 * with `WEATHER_LIVE_TESTS=1 npm test` (or `npm run test:live`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OpenMeteoDataSource } from "./open-meteo.ts";
import { DEFAULT_FORECAST_DAYS } from "./validation.ts";

const LIVE = process.env["WEATHER_LIVE_TESTS"] === "1";
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

describe("OpenMeteoDataSource (live)", { skip: LIVE ? false : "set WEATHER_LIVE_TESTS=1 to run" }, () => {
  it("fetches a real current report and forecast for Austin, TX", async () => {
    const source = new OpenMeteoDataSource();
    const signal = AbortSignal.timeout(15_000);

    const report = await source.fetchWeather(AUSTIN, { forecastDays: 3, signal });

    assert.equal(report.source, "open-meteo");
    assert.equal(report.timezone, "America/Chicago");
    assert.deepEqual(report.location, AUSTIN);
    assert.ok(Date.now() - Date.parse(report.fetchedAt) < 60_000, "fetchedAt is recent");

    const { current } = report;
    assert.match(current.observedAt, ISO_LOCAL_MINUTE);
    assert.ok(current.temperatureC > -30 && current.temperatureC < 55, `plausible temperature: ${current.temperatureC}`);
    assert.ok(current.humidityPercent >= 0 && current.humidityPercent <= 100);
    assert.ok(current.windSpeedKph >= 0);
    assert.ok(current.windDirectionDeg >= 0 && current.windDirectionDeg <= 360);
    assert.notEqual(current.condition.category, "unknown", `WMO code ${current.condition.code} should be mapped`);

    assert.equal(report.daily.length, 3);
    for (const [i, day] of report.daily.entries()) {
      assert.match(day.date, ISO_DATE);
      assert.ok(day.lowC <= day.highC, `day ${i} low <= high`);
      assert.ok(day.precipitationChancePercent >= 0 && day.precipitationChancePercent <= 100);
    }
    const dates = report.daily.map((d) => d.date);
    assert.deepEqual(dates, [...dates].sort(), "daily is in ascending date order");
  });

  it("defaults to the documented number of forecast days", async () => {
    const source = new OpenMeteoDataSource();

    const report = await source.fetchWeather(AUSTIN, { signal: AbortSignal.timeout(15_000) });

    assert.equal(report.daily.length, DEFAULT_FORECAST_DAYS);
  });
});
