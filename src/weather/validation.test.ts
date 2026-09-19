import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WeatherSourceError } from "./errors.ts";
import {
  DEFAULT_FORECAST_DAYS,
  MAX_FORECAST_DAYS,
  assertValidCoordinates,
  resolveForecastDays,
} from "./validation.ts";

function isInvalidInput(error: unknown): boolean {
  return error instanceof WeatherSourceError && error.kind === "invalid-input" && error.source === "test";
}

describe("assertValidCoordinates", () => {
  it("accepts boundary values", () => {
    assert.doesNotThrow(() => assertValidCoordinates({ latitude: 90, longitude: 180 }, "test"));
    assert.doesNotThrow(() => assertValidCoordinates({ latitude: -90, longitude: -180 }, "test"));
    assert.doesNotThrow(() => assertValidCoordinates({ latitude: 0, longitude: 0 }, "test"));
  });

  it("rejects latitude outside [-90, 90]", () => {
    assert.throws(() => assertValidCoordinates({ latitude: 90.0001, longitude: 0 }, "test"), isInvalidInput);
    assert.throws(() => assertValidCoordinates({ latitude: -91, longitude: 0 }, "test"), isInvalidInput);
  });

  it("rejects longitude outside [-180, 180]", () => {
    assert.throws(() => assertValidCoordinates({ latitude: 0, longitude: 180.5 }, "test"), isInvalidInput);
    assert.throws(() => assertValidCoordinates({ latitude: 0, longitude: -181 }, "test"), isInvalidInput);
  });

  it("rejects non-finite values", () => {
    assert.throws(() => assertValidCoordinates({ latitude: Number.NaN, longitude: 0 }, "test"), isInvalidInput);
    assert.throws(() => assertValidCoordinates({ latitude: 0, longitude: Number.POSITIVE_INFINITY }, "test"), isInvalidInput);
  });
});

describe("resolveForecastDays", () => {
  it("defaults when options are absent or unset", () => {
    assert.equal(resolveForecastDays(undefined, "test"), DEFAULT_FORECAST_DAYS);
    assert.equal(resolveForecastDays({}, "test"), DEFAULT_FORECAST_DAYS);
  });

  it("accepts integers within [1, MAX_FORECAST_DAYS]", () => {
    assert.equal(resolveForecastDays({ forecastDays: 1 }, "test"), 1);
    assert.equal(resolveForecastDays({ forecastDays: MAX_FORECAST_DAYS }, "test"), MAX_FORECAST_DAYS);
  });

  it("rejects zero, negatives, fractions, and values above the cap", () => {
    for (const forecastDays of [0, -1, 1.5, MAX_FORECAST_DAYS + 1, Number.NaN]) {
      assert.throws(() => resolveForecastDays({ forecastDays }, "test"), isInvalidInput, String(forecastDays));
    }
  });
});
