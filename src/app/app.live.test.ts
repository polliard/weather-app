/**
 * Live end-to-end test of the application interface against the real
 * Open-Meteo forecast and geocoding APIs, served over a real HTTP socket.
 *
 * Skipped by default so `npm test` stays deterministic and offline. Opt in
 * with `WEATHER_LIVE_TESTS=1 npm test` (or `npm run test:live`).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { OpenMeteoDataSource } from "../weather/open-meteo.ts";
import type { WeatherReport } from "../weather/types.ts";
import { createWeatherApp } from "./app.ts";
import { OpenMeteoGeocoder } from "./geocode.ts";
import { startServer, type RunningServer } from "./server.ts";

const LIVE = process.env["WEATHER_LIVE_TESTS"] === "1";
const TIMEOUT_MS = 20_000;

describe("weather app (live)", { skip: LIVE ? false : "set WEATHER_LIVE_TESTS=1 to run" }, () => {
  let running: RunningServer;

  before(async () => {
    const app = createWeatherApp({ weather: new OpenMeteoDataSource(), geocoder: new OpenMeteoGeocoder() });
    running = await startServer(app, { port: 0 });
  });

  after(async () => {
    await running.close();
  });

  it("geocodes a real place name", async () => {
    const response = await fetch(`${running.url}/api/geocode?q=Austin&count=3`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { results: { name: string; label: string; latitude: number; longitude: number }[] };
    assert.ok(body.results.length >= 1);
    const [best] = body.results;
    assert.equal(best?.name, "Austin");
    assert.match(best?.label ?? "", /Austin, Texas, United States/);
    assert.ok(Math.abs((best?.latitude ?? 0) - 30.27) < 0.1);
  });

  it("serves a real report through the JSON API", async () => {
    const response = await fetch(`${running.url}/api/weather?lat=30.2672&lon=-97.7431&days=3`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    assert.equal(response.status, 200);
    const report = (await response.json()) as WeatherReport;
    assert.equal(report.source, "open-meteo");
    assert.equal(report.timezone, "America/Chicago");
    assert.equal(report.daily.length, 3);
    assert.ok(report.current.temperatureC > -30 && report.current.temperatureC < 55);
  });

  it("renders the HTML interface for a place searched by name", async () => {
    const response = await fetch(`${running.url}/?q=Paris%2C%20France&days=5&units=imperial`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await response.text();
    // The region label is provider-owned ("Île-de-France Region" today), so only pin the name and country.
    assert.match(html, /<title>Paris, [^<]*France · Weather<\/title>/);
    assert.match(html, /Europe\/Paris/);
    assert.match(html, /<span class="temp">-?\d+°F<\/span>/);
    assert.match(html, /<h2 id="forecast-heading">5-day forecast<\/h2>/);
    assert.match(html, /<time datetime="\d{4}-\d{2}-\d{2}">Today<\/time>/);
    assert.match(html, /<time datetime="\d{4}-\d{2}-\d{2}">Tomorrow<\/time>/);
    assert.equal((html.match(/<time datetime=/g) ?? []).length, 5);
  });

  it("returns 404 with an explanation for a place nobody has heard of", async () => {
    const response = await fetch(`${running.url}/?q=zzzzqqqxxwwv`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    assert.equal(response.status, 404);
    assert.match(await response.text(), /No matching place/);
  });
});
