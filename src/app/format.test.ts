import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  celsiusToFahrenheit,
  compassDirection,
  formatCoordinates,
  formatForecastDay,
  formatIsoDate,
  formatObservedAt,
  formatPercent,
  formatTemperature,
  formatWindSpeed,
  isUnits,
  kphToMph,
} from "./format.ts";

describe("unit conversion", () => {
  it("converts Celsius to Fahrenheit", () => {
    assert.equal(celsiusToFahrenheit(0), 32);
    assert.equal(celsiusToFahrenheit(100), 212);
    assert.equal(celsiusToFahrenheit(-40), -40);
  });

  it("converts km/h to mph", () => {
    assert.ok(Math.abs(kphToMph(100) - 62.137) < 0.001);
  });

  it("recognises the supported unit systems", () => {
    assert.equal(isUnits("metric"), true);
    assert.equal(isUnits("imperial"), true);
    assert.equal(isUnits("kelvin"), false);
    assert.equal(isUnits(undefined), false);
  });
});

describe("formatTemperature", () => {
  it("rounds to whole degrees in metric", () => {
    assert.equal(formatTemperature(24.1, "metric"), "24°C");
    assert.equal(formatTemperature(24.5, "metric"), "25°C");
    assert.equal(formatTemperature(-3.5, "metric"), "-4°C");
  });

  it("converts and rounds in imperial", () => {
    assert.equal(formatTemperature(24.1, "imperial"), "75°F");
    assert.equal(formatTemperature(0, "imperial"), "32°F");
  });

  it("never prints negative zero", () => {
    assert.equal(formatTemperature(-0.2, "metric"), "0°C");
  });
});

describe("formatWindSpeed", () => {
  it("formats both unit systems", () => {
    assert.equal(formatWindSpeed(9.4, "metric"), "9 km/h");
    assert.equal(formatWindSpeed(9.4, "imperial"), "6 mph");
  });
});

describe("compassDirection", () => {
  it("maps bearings to sixteen compass points", () => {
    assert.equal(compassDirection(0), "N");
    assert.equal(compassDirection(45), "NE");
    assert.equal(compassDirection(160), "SSE");
    assert.equal(compassDirection(180), "S");
    assert.equal(compassDirection(270), "W");
    assert.equal(compassDirection(348.75), "N");
  });

  it("normalises bearings outside [0, 360)", () => {
    assert.equal(compassDirection(360), "N");
    assert.equal(compassDirection(-90), "W");
    assert.equal(compassDirection(450), "E");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percentage", () => {
    assert.equal(formatPercent(78), "78%");
    assert.equal(formatPercent(12.6), "13%");
  });
});

describe("date formatting", () => {
  it("labels the first two forecast days relatively", () => {
    assert.equal(formatForecastDay("2026-09-18", 0), "Today");
    assert.equal(formatForecastDay("2026-09-19", 1), "Tomorrow");
  });

  it("labels later days with weekday and date, independent of machine time zone", () => {
    assert.equal(formatForecastDay("2026-09-20", 2), "Sun 20 Sep");
    assert.equal(formatIsoDate("2026-01-01"), "Thu 1 Jan");
  });

  it("falls back to the raw string for unparseable dates", () => {
    assert.equal(formatIsoDate("not-a-date"), "not-a-date");
  });

  it("extracts the local time from a provider observation stamp", () => {
    assert.equal(formatObservedAt("2026-09-18T07:00"), "07:00 local time");
    assert.equal(formatObservedAt("2026-09-18T07:00:00"), "07:00 local time");
    assert.equal(formatObservedAt("sometime"), "sometime");
  });
});

describe("formatCoordinates", () => {
  it("uses hemisphere letters instead of signs", () => {
    assert.equal(formatCoordinates(30.2672, -97.7431), "30.27°N, 97.74°W");
    assert.equal(formatCoordinates(-33.9, 150.8), "33.90°S, 150.80°E");
    assert.equal(formatCoordinates(0, 0), "0.00°N, 0.00°E");
  });
});
