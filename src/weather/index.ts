export type {
  Condition,
  ConditionCategory,
  Coordinates,
  CurrentWeather,
  DailyForecast,
  FetchWeatherOptions,
  WeatherDataSource,
  WeatherReport,
} from "./types.ts";
export { WeatherSourceError, isWeatherSourceError } from "./errors.ts";
export type { WeatherSourceErrorKind, WeatherSourceErrorOptions } from "./errors.ts";
export { conditionFromWmoCode } from "./conditions.ts";
export { DEFAULT_FORECAST_DAYS, MAX_FORECAST_DAYS } from "./validation.ts";
export {
  OPEN_METEO_DEFAULT_BASE_URL,
  OPEN_METEO_SOURCE_NAME,
  OpenMeteoDataSource,
} from "./open-meteo.ts";
export type { FetchLike, OpenMeteoDataSourceOptions } from "./open-meteo.ts";
export { STATIC_SOURCE_NAME, StaticWeatherDataSource, locationKey } from "./static.ts";
