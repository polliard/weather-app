# weather-app

Version 2 of the weather app. This repository currently contains the
**weather data source** layer: a provider-agnostic contract for fetching
weather, a production implementation backed by Open-Meteo, and an in-memory
fixture implementation for offline development and tests.

## Requirements

- Node.js 24 or newer. The code runs directly from the `.ts` sources using
  Node's built-in TypeScript type stripping and test runner, so there are no
  runtime dependencies.
- The only dev dependencies are `typescript` and `@types/node`, used for
  `npm run typecheck`. Install them with `npm ci`.
- No API key, account, or other credentials. Open-Meteo's forecast API is
  free for non-commercial use and needs no registration.

## Quick start from a clean clone

```sh
git clone <this repository> weather-app
cd weather-app
npm ci              # installs the TypeScript compiler for typechecking
npm test            # offline unit tests (no network needed)
npm run typecheck   # tsc --noEmit
npm run probe -- 30.2672 -97.7431 3   # fetch a real 3-day report for Austin, TX
```

The probe prints the normalised `WeatherReport` as JSON. It exits `0` on
success, `1` when the weather source fails (with `source kind: message` on
stderr), and `2` on a usage error.

## Testing

```sh
npm test            # all offline tests; the live suite is skipped by default
npm run test:live   # integration tests against the real Open-Meteo API
```

Unit tests inject a fake `fetch`, so they are deterministic and never touch
the network. The live suite in `src/weather/open-meteo.live.test.ts` runs
only when `WEATHER_LIVE_TESTS=1` is set and verifies that the real provider
returns a well-formed current report and forecast.

`./.praxis/validate` runs the typecheck (when dev dependencies are installed)
followed by `npm test`, and is the entry point Praxis uses to validate every
checkpoint.

## Layout

```
src/weather/
  types.ts                  Domain types: Coordinates, WeatherReport, WeatherDataSource, ...
  errors.ts                 WeatherSourceError with a `kind` every provider must use
  validation.ts             Shared input validation (coordinates, forecastDays)
  conditions.ts             WMO weather-code -> normalised Condition mapping
  open-meteo.ts             OpenMeteoDataSource (free API, no key required)
  open-meteo.live.test.ts   Opt-in integration test against the real API
  static.ts                 StaticWeatherDataSource (in-memory fixtures)
  probe.ts                  `npm run probe` command-line entry point
  index.ts                  Public barrel export
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
