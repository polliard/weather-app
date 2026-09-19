/**
 * Place-name lookup for the application interface.
 *
 * Users type "Austin" or "Paris, France", not coordinates, so the app needs
 * a way to turn a name into a {@link Coordinates}. Open-Meteo's geocoding
 * API is free, needs no key, and lives alongside the forecast API the
 * weather layer already uses, so it is the production implementation here.
 * The interface is provider-agnostic and a static implementation is
 * provided for offline development and tests.
 */
import { WeatherSourceError } from "../weather/errors.ts";
import type { Coordinates } from "../weather/types.ts";

/** A named location resolved from a free-text query. */
export interface Place {
  /** Primary name, e.g. "Austin". */
  readonly name: string;
  /** First-level administrative area, e.g. "Texas", when the provider knows it. */
  readonly region: string | undefined;
  /** Country name, e.g. "United States", when the provider knows it. */
  readonly country: string | undefined;
  readonly location: Coordinates;
}

export interface SearchPlacesOptions {
  /** Maximum number of results to return. Default 5, capped at 20. */
  readonly count?: number;
  readonly signal?: AbortSignal;
}

/** The contract every place lookup implements. */
export interface Geocoder {
  readonly name: string;
  /**
   * Returns places matching `query`, best match first. An empty array means
   * "no match" and is not an error. Failures are {@link WeatherSourceError}s
   * so callers can branch on `kind` exactly as they do for weather.
   */
  searchPlaces(query: string, options?: SearchPlacesOptions): Promise<readonly Place[]>;
}

export const DEFAULT_PLACE_COUNT = 5;
export const MAX_PLACE_COUNT = 20;
/** Open-Meteo returns nothing for a single character, so require two. */
export const MIN_QUERY_LENGTH = 2;

/** Normalises a query and returns it, or throws `invalid-input` if unusable. */
export function normalizeQuery(query: string, source: string): string {
  const trimmed = query.trim().replace(/\s+/g, " ");
  if (trimmed.length < MIN_QUERY_LENGTH) {
    throw new WeatherSourceError(
      "invalid-input",
      source,
      `place query must be at least ${MIN_QUERY_LENGTH} characters, got ${JSON.stringify(query)}`,
    );
  }
  return trimmed;
}

export function resolvePlaceCount(options: SearchPlacesOptions | undefined, source: string): number {
  const count = options?.count ?? DEFAULT_PLACE_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > MAX_PLACE_COUNT) {
    throw new WeatherSourceError(
      "invalid-input",
      source,
      `count must be an integer in [1, ${MAX_PLACE_COUNT}], got ${String(count)}`,
    );
  }
  return count;
}

/** Human-readable label: "Austin, Texas, United States". */
export function describePlace(place: Place): string {
  return [place.name, place.region, place.country].filter((part) => part !== undefined && part !== "").join(", ");
}

export const OPEN_METEO_GEOCODER_NAME = "open-meteo-geocoding";
export const OPEN_METEO_GEOCODING_DEFAULT_BASE_URL = "https://geocoding-api.open-meteo.com/v1/search";

/** The subset of `fetch` this geocoder depends on, injectable for tests. */
export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface OpenMeteoGeocoderOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
}

/**
 * Geocoder backed by the free Open-Meteo geocoding API.
 * No API key is required. https://open-meteo.com/en/docs/geocoding-api
 */
export class OpenMeteoGeocoder implements Geocoder {
  readonly name = OPEN_METEO_GEOCODER_NAME;

  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(options: OpenMeteoGeocoderOptions = {}) {
    this.#baseUrl = options.baseUrl ?? OPEN_METEO_GEOCODING_DEFAULT_BASE_URL;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async searchPlaces(query: string, options?: SearchPlacesOptions): Promise<readonly Place[]> {
    const name = normalizeQuery(query, this.name);
    const count = resolvePlaceCount(options, this.name);

    const url = this.buildUrl(name, count);
    let response: Response;
    try {
      response = await this.#fetch(url, options?.signal === undefined ? undefined : { signal: options.signal });
    } catch (cause) {
      throw new WeatherSourceError("network", this.name, `Request to Open-Meteo geocoding failed: ${messageOf(cause)}`, {
        cause,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new WeatherSourceError(
        "invalid-response",
        this.name,
        `Open-Meteo geocoding returned a non-JSON body (HTTP ${response.status})`,
        { cause, status: response.status },
      );
    }

    if (!response.ok) {
      throw new WeatherSourceError(
        "upstream",
        this.name,
        `Open-Meteo geocoding responded with HTTP ${response.status}: ${describeUpstreamError(body)}`,
        { status: response.status },
      );
    }

    return this.parsePlaces(body);
  }

  /** Builds the request URL. Exposed for tests and debugging. */
  buildUrl(name: string, count: number): string {
    const url = new URL(this.#baseUrl);
    url.searchParams.set("name", name);
    url.searchParams.set("count", String(count));
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    return url.toString();
  }

  parsePlaces(body: unknown): readonly Place[] {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new WeatherSourceError("invalid-response", this.name, "expected response body to be an object");
    }
    const results = (body as Record<string, unknown>)["results"];
    // Open-Meteo omits `results` entirely when nothing matched.
    if (results === undefined) {
      return [];
    }
    if (!Array.isArray(results)) {
      throw new WeatherSourceError("invalid-response", this.name, "expected results to be an array");
    }
    return results.map((entry, index) => this.parsePlace(entry, index));
  }

  parsePlace(entry: unknown, index: number): Place {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new WeatherSourceError("invalid-response", this.name, `expected results[${index}] to be an object`);
    }
    const record = entry as Record<string, unknown>;
    const name = record["name"];
    const latitude = record["latitude"];
    const longitude = record["longitude"];
    if (typeof name !== "string" || name.length === 0) {
      throw new WeatherSourceError("invalid-response", this.name, `expected results[${index}].name to be a non-empty string`);
    }
    if (typeof latitude !== "number" || !Number.isFinite(latitude)) {
      throw new WeatherSourceError("invalid-response", this.name, `expected results[${index}].latitude to be a finite number`);
    }
    if (typeof longitude !== "number" || !Number.isFinite(longitude)) {
      throw new WeatherSourceError("invalid-response", this.name, `expected results[${index}].longitude to be a finite number`);
    }
    return {
      name,
      region: optionalString(record["admin1"]),
      country: optionalString(record["country"]),
      location: { latitude, longitude },
    };
  }
}

export const STATIC_GEOCODER_NAME = "static-geocoding";

/**
 * An in-memory {@link Geocoder} that matches queries against a fixed list
 * of places by case-insensitive prefix on the name. Used for offline
 * development and tests of the application interface.
 */
export class StaticGeocoder implements Geocoder {
  readonly name = STATIC_GEOCODER_NAME;
  readonly #places: readonly Place[];

  constructor(places: readonly Place[] = []) {
    this.#places = places;
  }

  async searchPlaces(query: string, options?: SearchPlacesOptions): Promise<readonly Place[]> {
    const name = normalizeQuery(query, this.name).toLowerCase();
    const count = resolvePlaceCount(options, this.name);
    options?.signal?.throwIfAborted();
    return this.#places.filter((place) => place.name.toLowerCase().startsWith(name)).slice(0, count);
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
