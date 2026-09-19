import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { StaticWeatherDataSource } from "../weather/static.ts";
import type { WeatherReport } from "../weather/types.ts";
import { npmScript, runNode, startNode } from "../testing/process.ts";
import { createWeatherApp, type WeatherApp } from "./app.ts";
import { AUSTIN_PLACE, AUSTIN_REPORT } from "./fixtures.ts";
import { StaticGeocoder } from "./geocode.ts";
import { DEFAULT_HOST, DEFAULT_PORT, optionsFromEnv, startServer, type RunningServer } from "./server.ts";

/** The script `npm start` runs, relative to the repository root. */
const SERVER_ENTRY = "src/app/server.ts";

describe("optionsFromEnv", () => {
  it("returns no overrides when PORT and HOST are unset or empty", () => {
    assert.deepEqual(optionsFromEnv({}), {});
    assert.deepEqual(optionsFromEnv({ PORT: "", HOST: "" }), {});
  });

  it("parses PORT and HOST", () => {
    assert.deepEqual(optionsFromEnv({ PORT: "8080", HOST: "0.0.0.0" }), { port: 8080, host: "0.0.0.0" });
  });

  it("rejects an unusable PORT", () => {
    assert.throws(() => optionsFromEnv({ PORT: "http" }), RangeError);
    assert.throws(() => optionsFromEnv({ PORT: "70000" }), RangeError);
    assert.throws(() => optionsFromEnv({ PORT: "80.5" }), RangeError);
  });

  it("documents the defaults the server falls back to", () => {
    assert.equal(DEFAULT_HOST, "127.0.0.1");
    assert.equal(DEFAULT_PORT, 3000);
  });
});

describe("startServer", () => {
  let running: RunningServer;

  before(async () => {
    const app = createWeatherApp({
      weather: new StaticWeatherDataSource([AUSTIN_REPORT]),
      geocoder: new StaticGeocoder([AUSTIN_PLACE]),
    });
    running = await startServer(app, { port: 0 });
  });

  after(async () => {
    await running.close();
  });

  it("reports a loopback URL with the assigned port", () => {
    const url = new URL(running.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.notEqual(url.port, "0");
  });

  it("serves the HTML interface over HTTP", async () => {
    const response = await fetch(`${running.url}/?q=austin`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await response.text();
    assert.match(html, /Austin, Texas, United States/);
    assert.match(html, /24°C/);
  });

  it("serves the JSON API over HTTP with a content-length", async () => {
    const response = await fetch(`${running.url}/api/weather?lat=30.27&lon=-97.74&days=2`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(await response.clone().text())));
    const report = (await response.json()) as WeatherReport;
    assert.equal(report.daily.length, 2);
  });

  it("propagates error statuses", async () => {
    const response = await fetch(`${running.url}/api/weather?lat=1`);
    assert.equal(response.status, 400);
    const notFound = await fetch(`${running.url}/missing`);
    assert.equal(notFound.status, 404);
  });

  it("answers HEAD requests without a body", async () => {
    const response = await fetch(`${running.url}/healthz`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  });

  it("returns 500 without crashing when the app throws unexpectedly", async () => {
    const broken: WeatherApp = {
      handle: async () => {
        throw new Error("unexpected");
      },
    };
    const brokenServer = await startServer(broken, { port: 0 });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const response = await fetch(`${brokenServer.url}/`);
      assert.equal(response.status, 500);
      assert.equal(await response.text(), "Internal server error\n");
      // The server is still alive after the failure.
      const again = await fetch(`${brokenServer.url}/`);
      assert.equal(again.status, 500);
    } finally {
      console.error = originalError;
      await brokenServer.close();
    }
  });
});

/**
 * Exercises the real `npm start` entry point as a separate process, the way
 * a user runs it. Only routes that never contact the weather provider are
 * requested, so this stays offline.
 */
describe("npm start entry point", { timeout: 30_000 }, () => {
  it("is the script these tests execute", () => {
    assert.equal(npmScript("start"), `node ${SERVER_ENTRY}`);
  });

  it("listens on the configured port, serves requests, and shuts down cleanly on SIGTERM", async () => {
    const started = await startNode(SERVER_ENTRY, [], { PORT: "0", HOST: "127.0.0.1" }, /weather app listening on (http:\/\/\S+)/);
    const url = started.ready[1];
    assert.ok(url !== undefined);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(new URL(url).port, "0");

    try {
      const health = await fetch(`${url}/healthz`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: "ok", weatherSource: "open-meteo", geocoder: "open-meteo-geocoding" });

      const landing = await fetch(`${url}/`);
      assert.equal(landing.status, 200);
      assert.equal(landing.headers.get("content-type"), "text/html; charset=utf-8");
      assert.match(await landing.text(), /<form/);

      const badRequest = await fetch(`${url}/api/weather?lat=abc&lon=0`);
      assert.equal(badRequest.status, 400);
    } finally {
      started.child.kill("SIGTERM");
    }

    const result = await started.exited();
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /received SIGTERM, shutting down/);
  });

  it("refuses to start with an unusable PORT and says why", async () => {
    const result = await runNode(SERVER_ENTRY, [], { PORT: "not-a-port" });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /PORT must be an integer in \[0, 65535\], got "not-a-port"/);
  });
});
