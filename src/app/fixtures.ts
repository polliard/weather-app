/**
 * Shared offline fixtures for application interface tests. Not a test file
 * itself (no `.test.ts` suffix), so the runner never executes it directly.
 */
import type { WeatherReport } from "../weather/types.ts";
import type { Place } from "./geocode.ts";

export const AUSTIN_PLACE: Place = {
  name: "Austin",
  region: "Texas",
  country: "United States",
  location: { latitude: 30.27, longitude: -97.74 },
};

export const AUSTRALIA_PLACE: Place = {
  name: "Austral",
  region: undefined,
  country: "Australia",
  location: { latitude: -33.93, longitude: 150.81 },
};

export const AUSTIN_REPORT: WeatherReport = {
  location: AUSTIN_PLACE.location,
  timezone: "America/Chicago",
  current: {
    observedAt: "2026-09-18T07:00",
    temperatureC: 24.1,
    apparentTemperatureC: 26.3,
    humidityPercent: 78,
    windSpeedKph: 9.4,
    windDirectionDeg: 160,
    condition: { category: "partly-cloudy", description: "Partly cloudy", code: 2 },
  },
  daily: [
    {
      date: "2026-09-18",
      highC: 33,
      lowC: 22,
      precipitationChancePercent: 0,
      condition: { category: "partly-cloudy", description: "Partly cloudy", code: 2 },
    },
    {
      date: "2026-09-19",
      highC: 34,
      lowC: 23,
      precipitationChancePercent: 40,
      condition: { category: "rain", description: "Light rain", code: 61 },
    },
    {
      date: "2026-09-20",
      highC: 29.6,
      lowC: 20.4,
      precipitationChancePercent: 85,
      condition: { category: "thunderstorm", description: "Thunderstorm", code: 95 },
    },
  ],
  source: "fixture",
  fetchedAt: "2026-09-18T12:00:00.000Z",
};
