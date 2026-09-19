# weather-app

Version 2 of the weather app: a small, real weather application that shows
current conditions and a multi-day forecast for any place you name, using
the free Open-Meteo forecast and geocoding APIs. No API key, account, or
runtime dependencies are required.

It has two layers:

- **Weather data source** (`src/weather/`): a provider-agnostic contract for
  fetching weather, a production implementation backed by Open-Meteo, and an
  in-memory fixture implementation for offline development and tests.
- **Application interface** (`src/app/`): a dependency-free HTTP server with
  a server-rendered web UI (search by place name or coordinates, choose the
  number of forecast days and °C/°F units) plus a JSON API.

## Requirements

- Node.js 24 or newer. The code runs directly from the `.ts` sources using
  Node's built-in TypeScript type stripping and test runner, so there are no
  runtime dependencies.
- The only dev dependencies are `typescript` and `@types/node`, used for
  `npm run typecheck`. Install them with `npm ci`.
- No API key, account, or other credentials. Open-Meteo's forecast and
  geocoding APIs are free for non-commercial use and need no registration.

## Quick start from a clean clone

```sh
git clone <this repository> weather-app
cd weather-app
npm ci              # installs the TypeScript compiler for typechecking
npm test            # offline unit tests (no network needed)
npm start           # serves the app on http://127.0.0.1:3000
```

Then open <http://127.0.0.1:3000> in a browser, type a place such as
`Austin` or `Paris, France`, and press **Get weather**. Results are plain
GET requests, so you can bookmark or share a URL like
`http://127.0.0.1:3000/?q=Austin&days=5&units=imperial`.

`PORT` and `HOST` override the listen address, e.g. `PORT=8080 npm start`.
Stop the server with Ctrl-C.

## Web interface

`GET /` renders the interface. Query parameters:

| Parameter | Meaning                                                     | Default  |
| --------- | ----------------------------------------------------------- | -------- |
| `q`       | Place name to search for (at least 2 characters)            | none     |
| `lat`, `lon` | Coordinates to use instead of `q` (take precedence)      | none     |
| `days`    | Forecast days including today, 1 to 16                      | `7`      |
| `units`   | `metric` (°C, km/h) or `imperial` (°F, mph)                 | `metric` |

The page shows the resolved place, current temperature, condition, feels-like
temperature, humidity, wind speed and direction, today's high/low, and a
forecast table with high, low, condition, and rain chance per day. Failures
are explained on the page: `400` for bad input, `404` when no place matches,
and `502` when Open-Meteo is unreachable or returns something unexpected.
No client-side JavaScript is required.

## JSON API

```sh
curl 'http://127.0.0.1:3000/api/weather?lat=30.2672&lon=-97.7431&days=3'
curl 'http://127.0.0.1:3000/api/geocode?q=Austin&count=5'
curl 'http://127.0.0.1:3000/healthz'
```

- `GET /api/weather?lat=&lon=[&days=]` returns a `WeatherReport` (see
  `src/weather/types.ts`). Units are metric.
- `GET /api/geocode?q=[&count=]` returns `{ "results": [...] }` with
  `name`, `region`, `country`, `label`, `latitude`, and `longitude` per
  match. An empty list means no match.
- `GET /healthz` returns `{ "status": "ok", ... }` with the configured
  source names.

Errors are `{ "error": { "kind", "message", "source"? } }` where `kind` is
one of `invalid-input`, `network`, `upstream`, `invalid-response`,
`not-found`, or `method-not-allowed`, with the matching HTTP status.

## Command-line probe

The data-source layer can also be exercised without the server:

```sh
npm run probe -- 30.2672 -97.7431 3   # fetch a real 3-day report for Austin, TX
```

The probe prints the normalised `WeatherReport` as JSON. It exits `0` on
success, `1` when the weather source fails (with `source kind: message` on
stderr), and `2` on a usage error.

## Testing

```sh
npm test            # all offline tests; the live suites are skipped by default
npm run test:live   # integration tests against the real Open-Meteo APIs
npm run typecheck   # tsc --noEmit
```

Unit tests inject fake `fetch` implementations and in-memory sources, so
they are deterministic and never touch the network. The application tests
cover parameter parsing, HTML rendering, every route's success and failure
responses, and the HTTP server itself on an ephemeral port.

The live suites (`src/**/*.live.test.ts`) run only when
`WEATHER_LIVE_TESTS=1` is set. They verify that the real provider returns a
well-formed report, and that the running app geocodes a real place, serves
its weather as JSON, and renders it as HTML.

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

src/app/
  geocode.ts                Geocoder contract, OpenMeteoGeocoder, StaticGeocoder
  format.ts                 Unit conversion and display formatting (pure)
  render.ts                 Server-side HTML rendering (pure, escaped)
  app.ts                    Transport-agnostic router: HTML page, JSON API, health
  server.ts                 `npm start` entry point: Node http adapter
  app.live.test.ts          Opt-in end-to-end test against the real APIs
  fixtures.ts               Shared offline fixtures for the app tests
```

## Using the data source directly

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

`OpenMeteoDataSource` and `OpenMeteoGeocoder` accept an injectable `fetch`
and `baseUrl`, which is how their tests run without network access.
`StaticWeatherDataSource` and `StaticGeocoder` serve pre-built fixtures so
the application can be developed and tested offline. `createWeatherApp`
takes any `WeatherDataSource` and `Geocoder`, so a different provider is a
one-line change in `src/app/server.ts`.
