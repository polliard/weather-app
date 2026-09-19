/** Classification of weather data source failures. */
export type WeatherSourceErrorKind =
  /** The caller supplied a location or option outside the valid range. */
  | "invalid-input"
  /** The request never produced an HTTP response (DNS, timeout, abort). */
  | "network"
  /** The provider answered with a non-success HTTP status. */
  | "upstream"
  /** The provider answered, but the body did not match the expected shape. */
  | "invalid-response";

export interface WeatherSourceErrorOptions {
  readonly cause?: unknown;
  /** HTTP status code, when the failure came from an upstream response. */
  readonly status?: number;
}

/**
 * The single error type thrown by every {@link WeatherDataSource}.
 *
 * Callers branch on {@link WeatherSourceError.kind}; the `source` field
 * names the provider so logs stay useful when several are configured.
 */
export class WeatherSourceError extends Error {
  readonly kind: WeatherSourceErrorKind;
  readonly source: string;
  readonly status: number | undefined;

  constructor(
    kind: WeatherSourceErrorKind,
    source: string,
    message: string,
    options: WeatherSourceErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WeatherSourceError";
    this.kind = kind;
    this.source = source;
    this.status = options.status;
  }
}

export function isWeatherSourceError(value: unknown): value is WeatherSourceError {
  return value instanceof WeatherSourceError;
}
