/**
 * Core domain types for the weather data source layer.
 *
 * Every provider (Open-Meteo, a static fixture, a future paid API) maps its
 * own wire format onto these types, so the rest of the app never sees
 * provider-specific shapes.
 */

/** A geographic point in decimal degrees. */
export interface Coordinates {
  /** Latitude in the range [-90, 90]. */
  readonly latitude: number;
  /** Longitude in the range [-180, 180]. */
  readonly longitude: number;
}

/** Normalised weather condition categories shared by all providers. */
export type ConditionCategory =
  | "clear"
  | "partly-cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing-rain"
  | "snow"
  | "showers"
  | "thunderstorm"
  | "unknown";

/** Human-readable description of the sky and precipitation state. */
export interface Condition {
  readonly category: ConditionCategory;
  /** Short English description, e.g. "Light rain". */
  readonly description: string;
  /**
   * Provider-specific code the condition was derived from (for Open-Meteo,
   * the WMO weather interpretation code). Kept for diagnostics only.
   */
  readonly code: number;
}

/** Conditions at a single moment. All units are metric. */
export interface CurrentWeather {
  /** ISO-8601 timestamp of the observation, in the location's local time. */
  readonly observedAt: string;
  /** Air temperature in degrees Celsius. */
  readonly temperatureC: number;
  /** Apparent ("feels like") temperature in degrees Celsius. */
  readonly apparentTemperatureC: number;
  /** Relative humidity as a percentage in [0, 100]. */
  readonly humidityPercent: number;
  /** Wind speed at 10 m in kilometres per hour. */
  readonly windSpeedKph: number;
  /** Wind direction at 10 m in degrees clockwise from north, in [0, 360). */
  readonly windDirectionDeg: number;
  readonly condition: Condition;
}

/** Summary of one calendar day. All units are metric. */
export interface DailyForecast {
  /** Calendar date (YYYY-MM-DD) in the location's local time zone. */
  readonly date: string;
  readonly highC: number;
  readonly lowC: number;
  /** Maximum precipitation probability for the day, in [0, 100]. */
  readonly precipitationChancePercent: number;
  readonly condition: Condition;
}

/** A complete weather report for a location. */
export interface WeatherReport {
  readonly location: Coordinates;
  /** IANA time zone name reported by the provider, e.g. "America/Chicago". */
  readonly timezone: string;
  readonly current: CurrentWeather;
  /** Daily forecasts, in ascending date order, starting with today. */
  readonly daily: readonly DailyForecast[];
  /** Identifier of the provider that produced this report. */
  readonly source: string;
  /** ISO-8601 UTC timestamp of when the report was fetched. */
  readonly fetchedAt: string;
}

/** Options accepted by every data source. */
export interface FetchWeatherOptions {
  /** Number of daily forecast entries to return, including today. Default 7. */
  readonly forecastDays?: number;
  /** Abort signal to cancel an in-flight request. */
  readonly signal?: AbortSignal;
}

/**
 * The contract every weather provider implements.
 *
 * Implementations must throw {@link WeatherSourceError} for every failure
 * mode so callers can branch on `kind` without knowing the provider.
 */
export interface WeatherDataSource {
  /** Stable identifier for the provider, e.g. "open-meteo". */
  readonly name: string;
  fetchWeather(location: Coordinates, options?: FetchWeatherOptions): Promise<WeatherReport>;
}
