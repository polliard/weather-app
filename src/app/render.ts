/**
 * Server-side HTML rendering for the weather application interface.
 *
 * Every function here is pure: it takes a view model and returns a string.
 * No client-side JavaScript is required for the interface to work, which
 * keeps the page usable in any browser and lets tests assert on the exact
 * markup without a DOM.
 */
import type { ConditionCategory, WeatherReport } from "../weather/types.ts";
import {
  compassDirection,
  formatCoordinates,
  formatForecastDay,
  formatObservedAt,
  formatPercent,
  formatTemperature,
  formatWindSpeed,
  type Units,
} from "./format.ts";

export const APP_TITLE = "Weather";

/** The state of the search form, echoed back so the user's input persists. */
export interface SearchState {
  /** Free-text place query, or "" when searching by coordinates. */
  readonly query: string;
  readonly days: number;
  readonly units: Units;
}

export interface WeatherView {
  readonly kind: "weather";
  /** Heading, e.g. "Austin, Texas, United States" or the coordinates. */
  readonly placeName: string;
  readonly report: WeatherReport;
  readonly search: SearchState;
}

export interface ErrorView {
  readonly kind: "error";
  readonly title: string;
  readonly message: string;
  readonly search: SearchState;
}

export interface LandingView {
  readonly kind: "landing";
  readonly search: SearchState;
}

export type PageView = WeatherView | ErrorView | LandingView;

/** Escapes text for safe interpolation into HTML content or attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CONDITION_GLYPHS: Readonly<Record<ConditionCategory, string>> = {
  clear: "☀️",
  "partly-cloudy": "⛅",
  overcast: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  "freezing-rain": "🌧️",
  snow: "🌨️",
  showers: "🌦️",
  thunderstorm: "⛈️",
  unknown: "❔",
};

export function conditionGlyph(category: ConditionCategory): string {
  return CONDITION_GLYPHS[category];
}

/** Renders a complete HTML document for the given view. */
export function renderPage(view: PageView): string {
  const title = view.kind === "weather" ? `${view.placeName} · ${APP_TITLE}` : APP_TITLE;
  const body = [renderHeader(), renderSearchForm(view.search), renderMain(view), renderFooter()].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>
`;
}

function renderHeader(): string {
  return `<header><h1><a href="/">${APP_TITLE}</a></h1><p class="tagline">Current conditions and forecast, powered by Open-Meteo.</p></header>`;
}

export function renderSearchForm(search: SearchState): string {
  const metric = search.units === "metric" ? " selected" : "";
  const imperial = search.units === "imperial" ? " selected" : "";
  return `<form class="search" method="get" action="/" role="search">
<label for="q">Place</label>
<input id="q" name="q" type="search" value="${escapeHtml(search.query)}" placeholder="City or town, e.g. Austin" required minlength="2" autofocus>
<label for="days">Days</label>
<input id="days" name="days" type="number" min="1" max="16" value="${search.days}">
<label for="units">Units</label>
<select id="units" name="units">
<option value="metric"${metric}>°C, km/h</option>
<option value="imperial"${imperial}>°F, mph</option>
</select>
<button type="submit">Get weather</button>
</form>`;
}

function renderMain(view: PageView): string {
  switch (view.kind) {
    case "weather":
      return `<main>${renderWeather(view)}</main>`;
    case "error":
      return `<main>${renderError(view)}</main>`;
    case "landing":
      return `<main><p class="hint">Search for a place to see the weather there now and for the days ahead.</p></main>`;
  }
}

export function renderError(view: ErrorView): string {
  return `<section class="error" role="alert"><h2>${escapeHtml(view.title)}</h2><p>${escapeHtml(view.message)}</p></section>`;
}

export function renderWeather(view: WeatherView): string {
  const { report, placeName, search } = view;
  const { current } = report;
  const glyph = conditionGlyph(current.condition.category);
  const coords = formatCoordinates(report.location.latitude, report.location.longitude);
  const today = report.daily[0];
  const todayRange =
    today === undefined
      ? ""
      : `<dt>Today</dt><dd>High ${formatTemperature(today.highC, search.units)}, low ${formatTemperature(today.lowC, search.units)}</dd>`;

  return `<section class="current" aria-labelledby="place">
<h2 id="place">${escapeHtml(placeName)}</h2>
<p class="meta">${escapeHtml(coords)} · ${escapeHtml(report.timezone)} · observed ${escapeHtml(formatObservedAt(current.observedAt))}</p>
<div class="now">
<span class="glyph" aria-hidden="true">${glyph}</span>
<span class="temp">${formatTemperature(current.temperatureC, search.units)}</span>
<span class="desc">${escapeHtml(current.condition.description)}</span>
</div>
<dl class="details">
<dt>Feels like</dt><dd>${formatTemperature(current.apparentTemperatureC, search.units)}</dd>
<dt>Humidity</dt><dd>${formatPercent(current.humidityPercent)}</dd>
<dt>Wind</dt><dd>${formatWindSpeed(current.windSpeedKph, search.units)} ${compassDirection(current.windDirectionDeg)}</dd>
${todayRange}
</dl>
</section>
${renderForecast(view)}`;
}

export function renderForecast(view: WeatherView): string {
  const { report, search } = view;
  const rows = report.daily
    .map((day, index) => {
      const glyph = conditionGlyph(day.condition.category);
      return `<tr>
<th scope="row"><time datetime="${escapeHtml(day.date)}">${escapeHtml(formatForecastDay(day.date, index))}</time></th>
<td><span aria-hidden="true">${glyph}</span> ${escapeHtml(day.condition.description)}</td>
<td class="num">${formatTemperature(day.highC, search.units)}</td>
<td class="num">${formatTemperature(day.lowC, search.units)}</td>
<td class="num">${formatPercent(day.precipitationChancePercent)}</td>
</tr>`;
    })
    .join("\n");

  return `<section class="forecast" aria-labelledby="forecast-heading">
<h2 id="forecast-heading">${report.daily.length}-day forecast</h2>
<table>
<thead><tr><th scope="col">Day</th><th scope="col">Conditions</th><th scope="col" class="num">High</th><th scope="col" class="num">Low</th><th scope="col" class="num">Rain</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</section>`;
}

function renderFooter(): string {
  return `<footer><p>Weather data by <a href="https://open-meteo.com/" rel="noopener">Open-Meteo</a>. JSON API: <code>/api/weather?lat=&amp;lon=</code> and <code>/api/geocode?q=</code>.</p></footer>`;
}

const STYLES = `
:root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fafafa; --muted: #666; --card: #fff; --line: #ddd; --accent: #1d6fd1; --error: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #121212; --muted: #aaa; --card: #1e1e1e; --line: #333; --accent: #6ea8ff; --error: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
.page { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
header h1 { margin: 0; font-size: 1.75rem; }
header h1 a { color: inherit; text-decoration: none; }
.tagline, .meta, .hint, footer { color: var(--muted); }
.search { display: grid; grid-template-columns: auto 1fr; gap: .5rem .75rem; align-items: center; margin: 1.25rem 0; padding: 1rem; background: var(--card); border: 1px solid var(--line); border-radius: .75rem; }
.search input, .search select, .search button { font: inherit; padding: .45rem .6rem; border: 1px solid var(--line); border-radius: .5rem; background: var(--bg); color: var(--fg); }
.search button { grid-column: 1 / -1; background: var(--accent); color: #fff; border-color: transparent; cursor: pointer; }
section { background: var(--card); border: 1px solid var(--line); border-radius: .75rem; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
section h2 { margin: 0 0 .25rem; font-size: 1.25rem; }
.now { display: flex; align-items: center; gap: .75rem; margin: .75rem 0; }
.glyph { font-size: 2.5rem; line-height: 1; }
.temp { font-size: 2.75rem; font-weight: 600; line-height: 1; }
.desc { font-size: 1.1rem; }
.details { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 0; }
.details dt { color: var(--muted); }
.details dd { margin: 0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .45rem .25rem; border-bottom: 1px solid var(--line); }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.error { border-color: var(--error); }
.error h2 { color: var(--error); }
footer { font-size: .9rem; }
footer code { font-size: .85em; }
`;
