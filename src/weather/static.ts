import { WeatherSourceError } from "./errors.ts";
import type { Coordinates, FetchWeatherOptions, WeatherDataSource, WeatherReport } from "./types.ts";
import { assertValidCoordinates, resolveForecastDays } from "./validation.ts";

export const STATIC_SOURCE_NAME = "static";

/**
 * Key used to look up a fixture for a location. Coordinates are rounded to
 * two decimals (~1 km) so callers need not match floating point exactly.
 */
export function locationKey(location: Coordinates): string {
  return `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
}

/**
 * An in-memory {@link WeatherDataSource} that serves pre-built reports.
 *
 * Useful for offline development, demos, and as a stand-in for the real
 * provider in tests of code that consumes weather data.
 */
export class StaticWeatherDataSource implements WeatherDataSource {
  readonly name = STATIC_SOURCE_NAME;
  readonly #reports = new Map<string, WeatherReport>();

  constructor(reports: Iterable<WeatherReport> = []) {
    for (const report of reports) {
      this.add(report);
    }
  }

  /** Registers (or replaces) the fixture for `report.location`. */
  add(report: WeatherReport): this {
    this.#reports.set(locationKey(report.location), report);
    return this;
  }

  async fetchWeather(location: Coordinates, options?: FetchWeatherOptions): Promise<WeatherReport> {
    assertValidCoordinates(location, this.name);
    const forecastDays = resolveForecastDays(options, this.name);
    options?.signal?.throwIfAborted();

    const report = this.#reports.get(locationKey(location));
    if (report === undefined) {
      throw new WeatherSourceError(
        "upstream",
        this.name,
        `no static report registered for ${locationKey(location)}`,
        { status: 404 },
      );
    }
    return { ...report, source: this.name, daily: report.daily.slice(0, forecastDays) };
  }
}
