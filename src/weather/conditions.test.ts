import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conditionFromWmoCode } from "./conditions.ts";
import type { ConditionCategory } from "./types.ts";

describe("conditionFromWmoCode", () => {
  const cases: ReadonlyArray<[code: number, category: ConditionCategory, description: string]> = [
    [0, "clear", "Clear sky"],
    [1, "clear", "Mainly clear"],
    [2, "partly-cloudy", "Partly cloudy"],
    [3, "overcast", "Overcast"],
    [45, "fog", "Fog"],
    [48, "fog", "Depositing rime fog"],
    [51, "drizzle", "Light drizzle"],
    [55, "drizzle", "Dense drizzle"],
    [56, "freezing-rain", "Light freezing drizzle"],
    [61, "rain", "Light rain"],
    [65, "rain", "Heavy rain"],
    [67, "freezing-rain", "Heavy freezing rain"],
    [71, "snow", "Light snow"],
    [77, "snow", "Snow grains"],
    [80, "showers", "Light rain showers"],
    [82, "showers", "Violent rain showers"],
    [86, "snow", "Heavy snow showers"],
    [95, "thunderstorm", "Thunderstorm"],
    [99, "thunderstorm", "Thunderstorm with heavy hail"],
  ];

  for (const [code, category, description] of cases) {
    it(`maps WMO code ${code} to ${category}`, () => {
      assert.deepEqual(conditionFromWmoCode(code), { category, description, code });
    });
  }

  it("returns an unknown condition for codes outside the WMO table", () => {
    const condition = conditionFromWmoCode(1234);
    assert.equal(condition.category, "unknown");
    assert.equal(condition.code, 1234);
    assert.match(condition.description, /1234/);
  });
});
