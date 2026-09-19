# weather-app

Version 2 of the weather app. This repository currently contains the
**weather data source** layer: a provider-agnostic contract for fetching
weather, a production implementation backed by Open-Meteo, and an in-memory
fixture implementation for offline development and tests.

## Requirements

- Node.js 24 or newer (uses the built-in test runner and native TypeScript
  type stripping, so there are no runtime dependencies to install).
- `tsc` is optional; `npm run typecheck` runs it if you have `typescript`
  and `@types/node` installed globally or as dev dependencies.

## Running the tests

```sh
npm test
```

`./.praxis/validate` runs the same checks and is the entry point Praxis uses
to validate every checkpoint.

## Layout

```
src/weather/
  types.ts        Domain types: Coordinates, WeatherReport, WeatherDataSource, ...
  errors.ts       WeatherSourceError with a `kind` every provider must use
  validation.ts   Shared input validation (coordinates, forecastDays)
  conditions.ts   WMO weather-code -> normalised Condition mapping
  open-meteo.ts   OpenMeteoDataSource (free API, no key required)
  static.ts       StaticWeatherDataSource (in-memory fixtures)
  index.ts        Public barrel export
```

## Usage

```ts
import { OpenMeteoDataSource, isWeatherSourceError } from "./src/weather/index.ts";

const source = new OpenMeteoDataSource();

try {
  const report = await source.fetchWeather(
    { latitude: 30.2672, longitude: -97.7431 },
    { forecastDays: 5 },
  );
  console.log(report.current.temperatureC, report.current.condition.description);
  for (const day of report.daily) {
    console.log(day.date, day.lowC, day.highC, day.condition.description);
  }
} catch (error) {
  if (isWeatherSourceError(error)) {
    // error.kind is one of: invalid-input | network | upstream | invalid-response
    console.error(error.source, error.kind, error.message);
  } else {
    throw error;
  }
}
```

### The `WeatherDataSource` contract

Every provider implements:

```ts
interface WeatherDataSource {
  readonly name: string;
  fetchWeather(location: Coordinates, options?: FetchWeatherOptions): Promise<WeatherReport>;
}
```

Rules all implementations follow:

- Units are metric: degrees Celsius, km/h, percent, degrees from north.
- `daily` is in ascending date order and starts with today in the location's
  local time zone.
- Every failure is a `WeatherSourceError` whose `kind` says what went wrong,
  so callers never need provider-specific error handling.
- Input is validated before any network call is made.
- Unknown weather codes are preserved with the `unknown` category instead of
  failing the whole report.

### Swapping providers

`OpenMeteoDataSource` accepts an injectable `fetch`, `baseUrl`, and clock,
which is how its tests run without network access. `StaticWeatherDataSource`
serves pre-built `WeatherReport` fixtures keyed by coordinates rounded to two
decimals, so downstream code can be developed and tested offline.
