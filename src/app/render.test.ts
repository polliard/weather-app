import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUSTIN_REPORT } from "./fixtures.ts";
import {
  conditionGlyph,
  escapeHtml,
  renderError,
  renderForecast,
  renderPage,
  renderSearchForm,
  renderWeather,
  type SearchState,
  type WeatherView,
} from "./render.ts";

const SEARCH: SearchState = { query: "Austin", days: 3, units: "metric" };

const VIEW: WeatherView = {
  kind: "weather",
  placeName: "Austin, Texas, United States",
  report: AUSTIN_REPORT,
  search: SEARCH,
};

describe("escapeHtml", () => {
  it("escapes every character that could break out of content or attributes", () => {
    assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  });

  it("leaves plain text alone", () => {
    assert.equal(escapeHtml("Paris, France"), "Paris, France");
  });
});

describe("conditionGlyph", () => {
  it("has a glyph for every category, including unknown", () => {
    assert.equal(conditionGlyph("clear"), "☀️");
    assert.equal(conditionGlyph("thunderstorm"), "⛈️");
    assert.equal(conditionGlyph("unknown"), "❔");
  });
});

describe("renderSearchForm", () => {
  it("echoes the current search back into the form", () => {
    const html = renderSearchForm({ query: `Tom's "town"`, days: 5, units: "imperial" });
    assert.match(html, /name="q" type="search" value="Tom&#39;s &quot;town&quot;"/);
    assert.match(html, /name="days" type="number" min="1" max="16" value="5"/);
    assert.match(html, /<option value="imperial" selected>/);
    assert.doesNotMatch(html, /<option value="metric" selected>/);
  });

  it("submits with GET to the root so results are bookmarkable", () => {
    assert.match(renderSearchForm(SEARCH), /<form class="search" method="get" action="\/"/);
  });
});

describe("renderWeather", () => {
  it("shows the place, current conditions, and derived details in metric", () => {
    const html = renderWeather(VIEW);
    assert.match(html, /<h2 id="place">Austin, Texas, United States<\/h2>/);
    assert.match(html, /30\.27°N, 97\.74°W · America\/Chicago · observed 07:00 local time/);
    assert.match(html, /<span class="temp">24°C<\/span>/);
    assert.match(html, /<span class="desc">Partly cloudy<\/span>/);
    assert.match(html, /<dt>Feels like<\/dt><dd>26°C<\/dd>/);
    assert.match(html, /<dt>Humidity<\/dt><dd>78%<\/dd>/);
    assert.match(html, /<dt>Wind<\/dt><dd>9 km\/h SSE<\/dd>/);
    assert.match(html, /<dt>Today<\/dt><dd>High 33°C, low 22°C<\/dd>/);
  });

  it("switches every temperature and speed to imperial when asked", () => {
    const html = renderWeather({ ...VIEW, search: { ...SEARCH, units: "imperial" } });
    assert.match(html, /<span class="temp">75°F<\/span>/);
    assert.match(html, /<dt>Wind<\/dt><dd>6 mph SSE<\/dd>/);
    assert.match(html, /High 91°F, low 72°F/);
    assert.doesNotMatch(html, /°C/);
  });

  it("escapes provider-supplied text", () => {
    const html = renderWeather({ ...VIEW, placeName: "<script>alert(1)</script>" });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("copes with a report that has no daily entries", () => {
    const html = renderWeather({ ...VIEW, report: { ...AUSTIN_REPORT, daily: [] } });
    assert.doesNotMatch(html, /<dt>Today<\/dt>/);
    assert.match(html, /0-day forecast/);
  });
});

describe("renderForecast", () => {
  it("renders one row per day with relative labels, glyphs, and rounded values", () => {
    const html = renderForecast(VIEW);
    assert.match(html, /<h2 id="forecast-heading">3-day forecast<\/h2>/);
    assert.match(html, /<time datetime="2026-09-18">Today<\/time>/);
    assert.match(html, /<time datetime="2026-09-19">Tomorrow<\/time>/);
    assert.match(html, /<time datetime="2026-09-20">Sun 20 Sep<\/time>/);
    assert.match(html, /⛈️<\/span> Thunderstorm<\/td>\n<td class="num">30°C<\/td>\n<td class="num">20°C<\/td>\n<td class="num">85%<\/td>/);
    assert.equal((html.match(/<tr>/g) ?? []).length, 4, "header row plus three day rows");
  });

  it("keeps the compound-adjective heading for a one-day forecast", () => {
    const html = renderForecast({ ...VIEW, report: { ...AUSTIN_REPORT, daily: AUSTIN_REPORT.daily.slice(0, 1) } });
    assert.match(html, /1-day forecast/);
  });
});

describe("renderError", () => {
  it("renders an alert with the escaped title and message", () => {
    const html = renderError({ kind: "error", title: "Oops & such", message: "<b>bad</b>", search: SEARCH });
    assert.match(html, /<section class="error" role="alert"><h2>Oops &amp; such<\/h2><p>&lt;b&gt;bad&lt;\/b&gt;<\/p><\/section>/);
  });
});

describe("renderPage", () => {
  it("produces a full document with the place in the title for weather views", () => {
    const html = renderPage(VIEW);
    assert.ok(html.startsWith("<!doctype html>\n<html lang=\"en\">"));
    assert.match(html, /<title>Austin, Texas, United States · Weather<\/title>/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<form class="search"/);
    assert.match(html, /<section class="current"/);
    assert.match(html, /<section class="forecast"/);
    assert.ok(html.trimEnd().endsWith("</html>"));
  });

  it("renders a landing page with a hint and no weather sections", () => {
    const html = renderPage({ kind: "landing", search: { query: "", days: 7, units: "metric" } });
    assert.match(html, /<title>Weather<\/title>/);
    assert.match(html, /<p class="hint">/);
    assert.doesNotMatch(html, /<section class="current"/);
  });

  it("renders error views inside the page shell with the form preserved", () => {
    const html = renderPage({ kind: "error", title: "No matching place", message: "Nothing matched", search: SEARCH });
    assert.match(html, /role="alert"/);
    assert.match(html, /value="Austin"/);
  });
});
