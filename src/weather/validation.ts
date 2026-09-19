import { WeatherSourceError } from "./errors.ts";
import type { Coordinates, FetchWeatherOptions } from "./types.ts";

export const DEFAULT_FORECAST_DAYS = 7;
export const MAX_FORECAST_DAYS = 16;

/**
 * Throws an `invalid-input` {@link WeatherSourceError} unless `location` is a
 * finite latitude/longitude pair inside the valid ranges.
 */
export function assertValidCoordinates(location: Coordinates, source: string): void {
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new WeatherSourceError(
      "invalid-input",
      source,
      `latitude must be a finite number in [-90, 90], got ${String(latitude)}`,
    );
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new WeatherSourceError(
      "invalid-input",
      source,
      `longitude must be a finite number in [-180, 180], got ${String(longitude)}`,
    );
  }
}

/**
 * Resolves `forecastDays` from the options, applying the default and
 * rejecting values that are not positive integers within the provider cap.
 */
export function resolveForecastDays(options: FetchWeatherOptions | undefined, source: string): number {
  const days = options?.forecastDays ?? DEFAULT_FORECAST_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) {
    throw new WeatherSourceError(
      "invalid-input",
      source,
      `forecastDays must be an integer in [1, ${MAX_FORECAST_DAYS}], got ${String(days)}`,
    );
  }
  return days;
}
