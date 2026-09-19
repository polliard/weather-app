import type { Condition, ConditionCategory } from "./types.ts";

interface ConditionEntry {
  readonly category: ConditionCategory;
  readonly description: string;
}

/**
 * WMO 4677 weather interpretation codes as used by Open-Meteo.
 * See https://open-meteo.com/en/docs#weather_variable_documentation
 */
const WMO_CONDITIONS: ReadonlyMap<number, ConditionEntry> = new Map<number, ConditionEntry>([
  [0, { category: "clear", description: "Clear sky" }],
  [1, { category: "clear", description: "Mainly clear" }],
  [2, { category: "partly-cloudy", description: "Partly cloudy" }],
  [3, { category: "overcast", description: "Overcast" }],
  [45, { category: "fog", description: "Fog" }],
  [48, { category: "fog", description: "Depositing rime fog" }],
  [51, { category: "drizzle", description: "Light drizzle" }],
  [53, { category: "drizzle", description: "Moderate drizzle" }],
  [55, { category: "drizzle", description: "Dense drizzle" }],
  [56, { category: "freezing-rain", description: "Light freezing drizzle" }],
  [57, { category: "freezing-rain", description: "Dense freezing drizzle" }],
  [61, { category: "rain", description: "Light rain" }],
  [63, { category: "rain", description: "Moderate rain" }],
  [65, { category: "rain", description: "Heavy rain" }],
  [66, { category: "freezing-rain", description: "Light freezing rain" }],
  [67, { category: "freezing-rain", description: "Heavy freezing rain" }],
  [71, { category: "snow", description: "Light snow" }],
  [73, { category: "snow", description: "Moderate snow" }],
  [75, { category: "snow", description: "Heavy snow" }],
  [77, { category: "snow", description: "Snow grains" }],
  [80, { category: "showers", description: "Light rain showers" }],
  [81, { category: "showers", description: "Moderate rain showers" }],
  [82, { category: "showers", description: "Violent rain showers" }],
  [85, { category: "snow", description: "Light snow showers" }],
  [86, { category: "snow", description: "Heavy snow showers" }],
  [95, { category: "thunderstorm", description: "Thunderstorm" }],
  [96, { category: "thunderstorm", description: "Thunderstorm with light hail" }],
  [99, { category: "thunderstorm", description: "Thunderstorm with heavy hail" }],
]);

/**
 * Maps a WMO weather code to a normalised {@link Condition}. Unknown codes
 * are preserved with the `unknown` category rather than rejected, so a new
 * upstream code never breaks a whole report.
 */
export function conditionFromWmoCode(code: number): Condition {
  const entry = WMO_CONDITIONS.get(code);
  if (entry === undefined) {
    return { category: "unknown", description: `Unknown conditions (code ${code})`, code };
  }
  return { category: entry.category, description: entry.description, code };
}
