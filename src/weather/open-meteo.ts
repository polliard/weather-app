import { conditionFromWmoCode } from "./conditions.ts";
import { WeatherSourceError } from "./errors.ts";
import type {
  Coordinates,
  CurrentWeather,
  DailyForecast,
  FetchWeatherOptions,
  WeatherDataSource,
  WeatherReport,
} from "./types.ts";
import { assertValidCoordinates, resolveForecastDays } from "./validation.ts";

export const OPEN_METEO_SOURCE_NAME = "open-meteo";
export const OPEN_METEO_DEFAULT_BASE_URL = "https://api.open-meteo.com/v1/forecast";

/** The subset of `fetch` this provider depends on, injectable for tests. */
export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface OpenMeteoDataSourceOptions {
  /** Override the forecast endpoint (for a proxy or a test server). */
  readonly baseUrl?: string;
  /** Override the HTTP client. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Clock used for `fetchedAt`. Defaults to `Date.now`. */
  readonly now?: () => Date;
}

const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
] as const;

const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
] as const;

/**
 * Weather data source backed by the free Open-Meteo forecast API.
 * No API key is required. https://open-meteo.com/en/docs
 */
export class OpenMeteoDataSource implements WeatherDataSource {
  readonly name = OPEN_METEO_SOURCE_NAME;

  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;

  constructor(options: OpenMeteoDataSourceOptions = {}) {
    this.#baseUrl = options.baseUrl ?? OPEN_METEO_DEFAULT_BASE_URL;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? (() => new Date());
  }

  async fetchWeather(location: Coordinates, options?: FetchWeatherOptions): Promise<WeatherReport> {
    assertValidCoordinates(location, this.name);
    const forecastDays = resolveForecastDays(options, this.name);

    const url = this.buildUrl(location, forecastDays);
    const response = await this.request(url, options?.signal);
    const body = await this.readJson(response);

    if (!response.ok) {
      throw new WeatherSourceError(
        "upstream",
        this.name,
        `Open-Meteo responded with HTTP ${response.status}: ${describeUpstreamError(body)}`,
        { status: response.status },
      );
    }

    return this.parseReport(body, location, forecastDays);
  }

  /** Builds the request URL. Exposed for tests and debugging. */
  buildUrl(location: Coordinates, forecastDays: number): string {
    const url = new URL(this.#baseUrl);
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("current", CURRENT_FIELDS.join(","));
    url.searchParams.set("daily", DAILY_FIELDS.join(","));
    url.searchParams.set("forecast_days", String(forecastDays));
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("temperature_unit", "celsius");
    return url.toString();
  }

  async request(url: string, signal: AbortSignal | undefined): Promise<Response> {
    try {
      return await this.#fetch(url, signal === undefined ? undefined : { signal });
    } catch (cause) {
      throw new WeatherSourceError("network", this.name, `Request to Open-Meteo failed: ${messageOf(cause)}`, {
        cause,
      });
    }
  }

  async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (cause) {
      throw new WeatherSourceError(
        "invalid-response",
        this.name,
        `Open-Meteo returned a non-JSON body (HTTP ${response.status})`,
        { cause, status: response.status },
      );
    }
  }

  parseReport(body: unknown, location: Coordinates, forecastDays: number): WeatherReport {
    const root = expectObject(body, "response body", this.name);
    const timezone = expectString(root["timezone"], "timezone", this.name);
    const current = this.parseCurrent(expectObject(root["current"], "current", this.name));
    const daily = this.parseDaily(expectObject(root["daily"], "daily", this.name), forecastDays);

    return {
      location: { latitude: location.latitude, longitude: location.longitude },
      timezone,
      current,
      daily,
      source: this.name,
      fetchedAt: this.#now().toISOString(),
    };
  }

  parseCurrent(current: Record<string, unknown>): CurrentWeather {
    const n = (key: string) => expectNumber(current[key], `current.${key}`, this.name);
    return {
      observedAt: expectString(current["time"], "current.time", this.name),
      temperatureC: n("temperature_2m"),
      apparentTemperatureC: n("apparent_temperature"),
      humidityPercent: n("relative_humidity_2m"),
      windSpeedKph: n("wind_speed_10m"),
      windDirectionDeg: n("wind_direction_10m"),
      condition: conditionFromWmoCode(n("weather_code")),
    };
  }

  parseDaily(daily: Record<string, unknown>, forecastDays: number): readonly DailyForecast[] {
    const dates = expectArray(daily["time"], "daily.time", this.name);
    const codes = expectArray(daily["weather_code"], "daily.weather_code", this.name);
    const highs = expectArray(daily["temperature_2m_max"], "daily.temperature_2m_max", this.name);
    const lows = expectArray(daily["temperature_2m_min"], "daily.temperature_2m_min", this.name);
    const precip = expectArray(
      daily["precipitation_probability_max"],
      "daily.precipitation_probability_max",
      this.name,
    );

    const lengths = [dates.length, codes.length, highs.length, lows.length, precip.length];
    if (new Set(lengths).size !== 1) {
      throw new WeatherSourceError(
        "invalid-response",
        this.name,
        `daily arrays have mismatched lengths: ${lengths.join(", ")}`,
      );
    }
    if (dates.length === 0) {
      throw new WeatherSourceError("invalid-response", this.name, "daily forecast is empty");
    }

    const days: DailyForecast[] = [];
    for (let i = 0; i < Math.min(dates.length, forecastDays); i += 1) {
      days.push({
        date: expectString(dates[i], `daily.time[${i}]`, this.name),
        highC: expectNumber(highs[i], `daily.temperature_2m_max[${i}]`, this.name),
        lowC: expectNumber(lows[i], `daily.temperature_2m_min[${i}]`, this.name),
        // Open-Meteo reports null when probability data is unavailable for a day.
        precipitationChancePercent: precip[i] === null ? 0 : expectNumber(precip[i], `daily.precipitation_probability_max[${i}]`, this.name),
        condition: conditionFromWmoCode(expectNumber(codes[i], `daily.weather_code[${i}]`, this.name)),
      });
    }
    return days;
  }
}

function describeUpstreamError(body: unknown): string {
  if (typeof body === "object" && body !== null && "reason" in body && typeof body.reason === "string") {
    return body.reason;
  }
  return "no error reason provided";
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function expectObject(value: unknown, field: string, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WeatherSourceError("invalid-response", source, `expected ${field} to be an object`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, field: string, source: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new WeatherSourceError("invalid-response", source, `expected ${field} to be an array`);
  }
  return value;
}

function expectString(value: unknown, field: string, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WeatherSourceError("invalid-response", source, `expected ${field} to be a non-empty string`);
  }
  return value;
}

function expectNumber(value: unknown, field: string, source: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherSourceError("invalid-response", source, `expected ${field} to be a finite number`);
  }
  return value;
}
