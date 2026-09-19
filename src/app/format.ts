/**
 * Presentation helpers shared by the HTML renderer.
 *
 * The weather layer is strictly metric; unit conversion is a presentation
 * concern and lives here. Every function is pure and locale-independent so
 * rendered output is identical on every machine.
 */

export type Units = "metric" | "imperial";

export const DEFAULT_UNITS: Units = "metric";

export function isUnits(value: unknown): value is Units {
  return value === "metric" || value === "imperial";
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function kphToMph(kph: number): number {
  return kph / 1.609344;
}

/** "24°C" or "75°F", rounded to the nearest whole degree. */
export function formatTemperature(celsius: number, units: Units): string {
  if (units === "imperial") {
    return `${roundHalfUp(celsiusToFahrenheit(celsius))}°F`;
  }
  return `${roundHalfUp(celsius)}°C`;
}

/** "9 km/h" or "6 mph", rounded to the nearest whole unit. */
export function formatWindSpeed(kph: number, units: Units): string {
  if (units === "imperial") {
    return `${roundHalfUp(kphToMph(kph))} mph`;
  }
  return `${roundHalfUp(kph)} km/h`;
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

/** Sixteen-point compass label for a bearing in degrees from north. */
export function compassDirection(degrees: number): string {
  const normalised = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalised / 22.5) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] ?? "N";
}

export function formatPercent(value: number): string {
  return `${roundHalfUp(value)}%`;
}

// Fixed tables rather than Intl.DateTimeFormat: ICU data differs between
// Node releases (e.g. "Sep" vs "Sept"), and the label must be stable.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Labels a forecast day. The data contract guarantees `daily` starts with
 * today in the location's time zone, so position decides "Today" and
 * "Tomorrow"; later days show the weekday and date, e.g. "Sun 20 Sep".
 */
export function formatForecastDay(isoDate: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return formatIsoDate(isoDate);
}

/** "Sun 20 Sep" for a YYYY-MM-DD string; falls back to the input if unparseable. */
export function formatIsoDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  const weekday = WEEKDAYS[parsed.getUTCDay()] ?? "";
  const month = MONTHS[parsed.getUTCMonth()] ?? "";
  return `${weekday} ${parsed.getUTCDate()} ${month}`;
}

/**
 * "2026-09-18T07:00" (the provider's local-time observation stamp) becomes
 * "07:00 local time". Anything unexpected is returned as-is.
 */
export function formatObservedAt(observedAt: string): string {
  const match = /T(\d{2}:\d{2})/.exec(observedAt);
  return match?.[1] === undefined ? observedAt : `${match[1]} local time`;
}

/** Coordinates as "30.27°N, 97.74°W". */
export function formatCoordinates(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(2)}°${latitude < 0 ? "S" : "N"}`;
  const lon = `${Math.abs(longitude).toFixed(2)}°${longitude < 0 ? "W" : "E"}`;
  return `${lat}, ${lon}`;
}

/** Rounds half away from zero, so -0.5 -> -1 and 0.5 -> 1, and never yields -0. */
function roundHalfUp(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}
