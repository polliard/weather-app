/**
 * The weather application: a transport-agnostic request handler.
 *
 * Routes:
 *   GET /                         HTML interface. `?q=<place>` searches by name,
 *                                 `?lat=&lon=` by coordinates; `days` and `units`
 *                                 are optional.
 *   GET /api/weather?lat=&lon=    JSON WeatherReport (`days` optional).
 *   GET /api/geocode?q=           JSON list of matching places (`count` optional).
 *   GET /healthz                  JSON liveness check.
 *
 * The handler works on a tiny request/response shape instead of Node's
 * `http` types so it can be exercised in tests without opening a socket.
 * `server.ts` adapts it to a real HTTP server.
 */
import { isWeatherSourceError, type WeatherSourceError, type WeatherSourceErrorKind } from "../weather/errors.ts";
import type { Coordinates, WeatherDataSource, WeatherReport } from "../weather/types.ts";
import { DEFAULT_FORECAST_DAYS, MAX_FORECAST_DAYS } from "../weather/validation.ts";
import { describePlace, type Geocoder, type Place } from "./geocode.ts";
import { DEFAULT_UNITS, formatCoordinates, isUnits, type Units } from "./format.ts";
import { renderPage, type SearchState } from "./render.ts";

export interface AppRequest {
  readonly method: string;
  readonly url: URL;
}

export interface AppResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface WeatherAppOptions {
  readonly weather: WeatherDataSource;
  readonly geocoder: Geocoder;
}

export interface WeatherApp {
  handle(request: AppRequest): Promise<AppResponse>;
}

export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** Thrown by parameter parsing; always becomes a 400 response. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export function createWeatherApp(options: WeatherAppOptions): WeatherApp {
  const { weather, geocoder } = options;

  async function handle(request: AppRequest): Promise<AppResponse> {
    const { pathname } = request.url;
    const wantsJson = pathname.startsWith("/api/") || pathname === "/healthz";

    if (request.method !== "GET" && request.method !== "HEAD") {
      return wantsJson
        ? json(405, { error: { kind: "method-not-allowed", message: `${request.method} is not supported` } }, { allow: "GET, HEAD" })
        : html(405, renderPage({ kind: "error", title: "Method not allowed", message: "Only GET requests are supported.", search: defaultSearch() }), { allow: "GET, HEAD" });
    }

    switch (pathname) {
      case "/":
        return handlePage(request.url.searchParams);
      case "/api/weather":
        return handleWeatherApi(request.url.searchParams);
      case "/api/geocode":
        return handleGeocodeApi(request.url.searchParams);
      case "/healthz":
        return json(200, { status: "ok", weatherSource: weather.name, geocoder: geocoder.name });
      default:
        return wantsJson
          ? json(404, { error: { kind: "not-found", message: `no route for ${pathname}` } })
          : html(404, renderPage({ kind: "error", title: "Not found", message: `There is nothing at ${pathname}.`, search: defaultSearch() }));
    }
  }

  async function handlePage(params: URLSearchParams): Promise<AppResponse> {
    let search: SearchState;
    try {
      search = parseSearchState(params);
    } catch (error) {
      if (error instanceof BadRequestError) {
        return html(400, renderPage({ kind: "error", title: "Invalid request", message: error.message, search: defaultSearch() }));
      }
      throw error;
    }

    const hasCoordinates = params.has("lat") || params.has("lon");
    if (search.query === "" && !hasCoordinates) {
      return html(200, renderPage({ kind: "landing", search }));
    }

    try {
      const target = hasCoordinates ? await resolveCoordinates(params) : await resolveQuery(search.query);
      if (target === undefined) {
        return html(404, renderPage({
          kind: "error",
          title: "No matching place",
          message: `Nothing matched "${search.query}". Try a larger town or add the country, e.g. "Paris, France".`,
          search,
        }));
      }
      const report = await weather.fetchWeather(target.location, { forecastDays: search.days });
      return html(200, renderPage({ kind: "weather", placeName: target.name, report, search }));
    } catch (error) {
      if (error instanceof BadRequestError) {
        return html(400, renderPage({ kind: "error", title: "Invalid request", message: error.message, search }));
      }
      if (isWeatherSourceError(error)) {
        return html(statusForSourceError(error), renderPage({
          kind: "error",
          title: titleForSourceError(error.kind),
          message: error.message,
          search,
        }));
      }
      throw error;
    }
  }

  async function handleWeatherApi(params: URLSearchParams): Promise<AppResponse> {
    try {
      const location = parseCoordinates(params);
      const forecastDays = parseDays(params);
      const report: WeatherReport = await weather.fetchWeather(location, { forecastDays });
      return json(200, report);
    } catch (error) {
      return jsonError(error);
    }
  }

  async function handleGeocodeApi(params: URLSearchParams): Promise<AppResponse> {
    try {
      const query = params.get("q") ?? "";
      const count = parseOptionalInteger(params, "count");
      const results = await geocoder.searchPlaces(query, count === undefined ? {} : { count });
      return json(200, { results: results.map(placeToJson) });
    } catch (error) {
      return jsonError(error);
    }
  }

  /** Resolves `lat`/`lon` query parameters into a target for the page. */
  async function resolveCoordinates(params: URLSearchParams): Promise<Target> {
    const location = parseCoordinates(params);
    return { name: formatCoordinates(location.latitude, location.longitude), location };
  }

  /** Geocodes a place query; `undefined` when nothing matched. */
  async function resolveQuery(query: string): Promise<Target | undefined> {
    const places = await geocoder.searchPlaces(query, { count: 1 });
    const best = places[0];
    if (best === undefined) return undefined;
    return { name: describePlace(best), location: best.location };
  }

  return { handle };
}

interface Target {
  readonly name: string;
  readonly location: Coordinates;
}

function defaultSearch(): SearchState {
  return { query: "", days: DEFAULT_FORECAST_DAYS, units: DEFAULT_UNITS };
}

/** Reads the search form fields, validating only what the app itself owns. */
export function parseSearchState(params: URLSearchParams): SearchState {
  const query = (params.get("q") ?? "").trim();
  const days = parseDays(params);
  const units = parseUnits(params);
  return { query, days, units };
}

export function parseUnits(params: URLSearchParams): Units {
  const raw = params.get("units");
  if (raw === null || raw === "") return DEFAULT_UNITS;
  if (!isUnits(raw)) {
    throw new BadRequestError(`units must be "metric" or "imperial", got ${JSON.stringify(raw)}`);
  }
  return raw;
}

export function parseDays(params: URLSearchParams): number {
  const days = parseOptionalInteger(params, "days") ?? DEFAULT_FORECAST_DAYS;
  if (days < 1 || days > MAX_FORECAST_DAYS) {
    throw new BadRequestError(`days must be between 1 and ${MAX_FORECAST_DAYS}, got ${days}`);
  }
  return days;
}

export function parseCoordinates(params: URLSearchParams): Coordinates {
  const latitude = parseRequiredNumber(params, "lat");
  const longitude = parseRequiredNumber(params, "lon");
  return { latitude, longitude };
}

function parseRequiredNumber(params: URLSearchParams, name: string): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") {
    throw new BadRequestError(`${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new BadRequestError(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function parseOptionalInteger(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new BadRequestError(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function placeToJson(place: Place): Record<string, unknown> {
  return {
    name: place.name,
    region: place.region ?? null,
    country: place.country ?? null,
    label: describePlace(place),
    latitude: place.location.latitude,
    longitude: place.location.longitude,
  };
}

/** Maps a source failure onto an HTTP status: caller mistakes are 4xx, everything else 502. */
export function statusForSourceError(error: WeatherSourceError): number {
  switch (error.kind) {
    case "invalid-input":
      return 400;
    case "upstream":
      return error.status === 404 ? 404 : 502;
    case "network":
    case "invalid-response":
      return 502;
  }
}

function titleForSourceError(kind: WeatherSourceErrorKind): string {
  switch (kind) {
    case "invalid-input":
      return "Invalid request";
    case "network":
      return "Weather service unreachable";
    case "upstream":
      return "Weather service error";
    case "invalid-response":
      return "Unexpected weather data";
  }
}

function jsonError(error: unknown): AppResponse {
  if (error instanceof BadRequestError) {
    return json(400, { error: { kind: "invalid-input", message: error.message } });
  }
  if (isWeatherSourceError(error)) {
    return json(statusForSourceError(error), {
      error: { kind: error.kind, source: error.source, message: error.message },
    });
  }
  throw error;
}

function html(status: number, body: string, extraHeaders: Record<string, string> = {}): AppResponse {
  return { status, headers: { "content-type": HTML_CONTENT_TYPE, "cache-control": "no-store", ...extraHeaders }, body };
}

function json(status: number, value: unknown, extraHeaders: Record<string, string> = {}): AppResponse {
  return {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, "cache-control": "no-store", ...extraHeaders },
    body: `${JSON.stringify(value, null, 2)}\n`,
  };
}
