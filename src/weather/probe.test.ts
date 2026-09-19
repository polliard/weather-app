import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { npmScript, runNode } from "../testing/process.ts";
import { WeatherSourceError } from "./errors.ts";
import { PROBE_USAGE, ProbeUsageError, parseProbeArgs, runProbe } from "./probe.ts";

/** The script `npm run probe` runs, relative to the repository root. */
const PROBE_ENTRY = "src/weather/probe.ts";
import { StaticWeatherDataSource } from "./static.ts";
import type { WeatherDataSource, WeatherReport } from "./types.ts";

const AUSTIN = { latitude: 30.27, longitude: -97.74 };

const REPORT: WeatherReport = {
  location: AUSTIN,
  timezone: "America/Chicago",
  current: {
    observedAt: "2026-09-18T07:00",
    temperatureC: 24.1,
    apparentTemperatureC: 26.3,
    humidityPercent: 78,
    windSpeedKph: 9.4,
    windDirectionDeg: 160,
    condition: { category: "partly-cloudy", description: "Partly cloudy", code: 2 },
  },
  daily: [
    {
      date: "2026-09-18",
      highC: 33,
      lowC: 22,
      precipitationChancePercent: 0,
      condition: { category: "partly-cloudy", description: "Partly cloudy", code: 2 },
    },
    {
      date: "2026-09-19",
      highC: 34,
      lowC: 23,
      precipitationChancePercent: 40,
      condition: { category: "rain", description: "Light rain", code: 61 },
    },
  ],
  source: "fixture",
  fetchedAt: "2026-09-18T12:00:00.000Z",
};

function fakeIo(): { io: { stdout: (l: string) => void; stderr: (l: string) => void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l) }, out, err };
}

describe("parseProbeArgs", () => {
  it("parses latitude and longitude with default options", () => {
    assert.deepEqual(parseProbeArgs(["30.27", "-97.74"]), { location: AUSTIN, options: {} });
  });

  it("parses an optional forecastDays", () => {
    assert.deepEqual(parseProbeArgs(["30.27", "-97.74", "5"]), { location: AUSTIN, options: { forecastDays: 5 } });
  });

  it("rejects the wrong number of arguments", () => {
    assert.throws(() => parseProbeArgs([]), ProbeUsageError);
    assert.throws(() => parseProbeArgs(["1"]), ProbeUsageError);
    assert.throws(() => parseProbeArgs(["1", "2", "3", "4"]), ProbeUsageError);
  });

  it("rejects non-numeric values", () => {
    assert.throws(() => parseProbeArgs(["north", "-97.74"]), /latitude must be a number/);
    assert.throws(() => parseProbeArgs(["30.27", ""]), /longitude is required/);
    assert.throws(() => parseProbeArgs(["30.27", "-97.74", "many"]), /forecastDays must be a number/);
  });
});

describe("runProbe", () => {
  it("prints the report as JSON and exits 0", async () => {
    const source = new StaticWeatherDataSource([REPORT]);
    const { io, out, err } = fakeIo();

    const code = await runProbe(["30.27", "-97.74"], source, io);

    assert.equal(code, 0);
    assert.deepEqual(err, []);
    assert.equal(out.length, 1);
    const printed = JSON.parse(out[0]!) as WeatherReport;
    assert.equal(printed.source, "static");
    assert.equal(printed.current.temperatureC, 24.1);
    assert.equal(printed.daily.length, 2);
  });

  it("passes forecastDays through to the source", async () => {
    const source = new StaticWeatherDataSource([REPORT]);
    const { io, out } = fakeIo();

    await runProbe(["30.27", "-97.74", "1"], source, io);

    const printed = JSON.parse(out[0]!) as WeatherReport;
    assert.equal(printed.daily.length, 1);
  });

  it("reports usage errors on stderr and exits 2 without calling the source", async () => {
    let calls = 0;
    const source: WeatherDataSource = {
      name: "counting",
      fetchWeather: async () => {
        calls += 1;
        return REPORT;
      },
    };
    const { io, out, err } = fakeIo();

    const code = await runProbe(["only-one"], source, io);

    assert.equal(code, 2);
    assert.equal(calls, 0);
    assert.deepEqual(out, []);
    assert.equal(err.at(-1), PROBE_USAGE);
  });

  it("reports weather source failures on stderr and exits 1", async () => {
    const source = new StaticWeatherDataSource();
    const { io, out, err } = fakeIo();

    const code = await runProbe(["0", "0"], source, io);

    assert.equal(code, 1);
    assert.deepEqual(out, []);
    assert.match(err[0]!, /^static upstream: /);
  });

  it("surfaces invalid-input failures from the source with exit 1", async () => {
    const source = new StaticWeatherDataSource([REPORT]);
    const { io, err } = fakeIo();

    const code = await runProbe(["95", "0"], source, io);

    assert.equal(code, 1);
    assert.match(err[0]!, /invalid-input/);
  });

  it("rethrows unexpected errors instead of swallowing them", async () => {
    const source: WeatherDataSource = {
      name: "broken",
      fetchWeather: async () => {
        throw new RangeError("not a weather error");
      },
    };
    const { io } = fakeIo();

    await assert.rejects(runProbe(["0", "0"], source, io), RangeError);
  });

  it("does not treat WeatherSourceError subclasses as unexpected", async () => {
    const source: WeatherDataSource = {
      name: "flaky",
      fetchWeather: async () => {
        throw new WeatherSourceError("network", "flaky", "offline");
      },
    };
    const { io, err } = fakeIo();

    const code = await runProbe(["0", "0"], source, io);

    assert.equal(code, 1);
    assert.equal(err[0], "flaky network: offline");
  });
});

/**
 * Exercises the real `npm run probe` entry point as a separate process.
 * Both cases fail before any request is made, so this stays offline.
 */
describe("npm run probe entry point", { timeout: 30_000 }, () => {
  it("is the script these tests execute", () => {
    assert.equal(npmScript("probe"), `node ${PROBE_ENTRY}`);
  });

  it("prints usage and exits 2 when no coordinates are given", async () => {
    const result = await runNode(PROBE_ENTRY);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /expected 2 or 3 arguments/);
    assert.ok(result.stderr.includes(PROBE_USAGE), result.stderr);
  });

  it("reports an out-of-range coordinate from the real source and exits 1", async () => {
    const result = await runNode(PROBE_ENTRY, ["91", "0"]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^open-meteo invalid-input: /m);
  });
});
