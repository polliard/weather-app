/**
 * Command-line probe for the weather data source layer.
 *
 * Fetches a real report from Open-Meteo for the given coordinates and prints
 * it as JSON, so the layer can be exercised end-to-end from a clean clone
 * without any application interface on top of it.
 *
 *   npm run probe -- <latitude> <longitude> [forecastDays]
 *
 * Exit codes: 0 success, 1 weather source failure, 2 usage error.
 */
import { isWeatherSourceError } from "./errors.ts";
import { OpenMeteoDataSource } from "./open-meteo.ts";
import type { Coordinates, FetchWeatherOptions, WeatherDataSource } from "./types.ts";

export interface ProbeArgs {
  readonly location: Coordinates;
  readonly options: FetchWeatherOptions;
}

export class ProbeUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeUsageError";
  }
}

export const PROBE_USAGE = "usage: npm run probe -- <latitude> <longitude> [forecastDays]";

/** Parses `[latitude, longitude, forecastDays?]` from raw CLI arguments. */
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  if (argv.length < 2 || argv.length > 3) {
    throw new ProbeUsageError(`expected 2 or 3 arguments, got ${argv.length}`);
  }
  const [rawLatitude, rawLongitude, rawDays] = argv;
  const latitude = parseNumber(rawLatitude, "latitude");
  const longitude = parseNumber(rawLongitude, "longitude");
  const location: Coordinates = { latitude, longitude };
  if (rawDays === undefined) {
    return { location, options: {} };
  }
  return { location, options: { forecastDays: parseNumber(rawDays, "forecastDays") } };
}

function parseNumber(raw: string | undefined, name: string): number {
  if (raw === undefined || raw.trim() === "") {
    throw new ProbeUsageError(`${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ProbeUsageError(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export interface ProbeIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/**
 * Runs the probe against `source` and returns the process exit code.
 * Separated from `main` so it can be tested with a fake source and fake IO.
 */
export async function runProbe(argv: readonly string[], source: WeatherDataSource, io: ProbeIo): Promise<number> {
  let args: ProbeArgs;
  try {
    args = parseProbeArgs(argv);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    io.stderr(PROBE_USAGE);
    return 2;
  }

  try {
    const report = await source.fetchWeather(args.location, args.options);
    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    if (isWeatherSourceError(error)) {
      io.stderr(`${error.source} ${error.kind}: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const code = await runProbe(process.argv.slice(2), new OpenMeteoDataSource(), {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = code;
}

// Only run when executed directly (`node src/weather/probe.ts`), not when imported by tests.
if (import.meta.filename === process.argv[1]) {
  await main();
}
