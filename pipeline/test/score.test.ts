import assert from "node:assert/strict";
import { test } from "node:test";
import { K, monthsAgo, penalty, stabilityScore, weatherLabel } from "../src/score.ts";

const month = (m: string, hard: number, soft = 0, operations = 100) => ({ month: m, hard, soft, operations });

test("monthsAgo counts across year boundaries", () => {
  assert.equal(monthsAgo("2026-10", "2026-10"), 0);
  assert.equal(monthsAgo("2025-11", "2026-02"), 3);
  assert.equal(monthsAgo("2026-11", "2026-10"), -1);
});

test("penalty is per 100 operations, with soft changes at a quarter", () => {
  assert.equal(penalty(month("2026-01", 2, 4, 100)), 3);
  assert.equal(penalty(month("2026-01", 2, 4, 200)), 1.5);
});

test("penalty doesn't divide by zero on an empty spec", () => {
  assert.ok(Number.isFinite(penalty(month("2026-01", 1, 0, 0))));
});

test("no breaking changes scores 100", () => {
  assert.deepEqual(stabilityScore([month("2026-09", 0)], "2026-10"), { score: 100, pressure: 0 });
  assert.equal(stabilityScore([], "2026-10").score, 100);
});

test("only the trailing 12 months count", () => {
  assert.equal(stabilityScore([month("2025-10", 50)], "2026-10").score, 100);
  assert.ok(stabilityScore([month("2025-11", 50)], "2026-10").score < 100);
  assert.equal(stabilityScore([month("2026-11", 50)], "2026-10").score, 100);
});

test("a break six months ago weighs half as much as one this month", () => {
  const now = stabilityScore([month("2026-10", 4)], "2026-10").pressure;
  const old = stabilityScore([month("2026-04", 4)], "2026-10").pressure;
  assert.equal(old, now / 2);
});

test("score falls exponentially with pressure", () => {
  const { score, pressure } = stabilityScore([month("2026-10", K)], "2026-10");
  assert.equal(pressure, K);
  assert.equal(score, Math.round(100 / Math.E));
});

test("bigger APIs aren't punished for size", () => {
  const small = stabilityScore([month("2026-10", 5, 0, 100)], "2026-10").score;
  const big = stabilityScore([month("2026-10", 50, 0, 1000)], "2026-10").score;
  assert.equal(small, big);
});

test("weather labels follow the score bands", () => {
  assert.equal(weatherLabel(100).label, "Clear");
  assert.equal(weatherLabel(85).label, "Clear");
  assert.equal(weatherLabel(84).label, "Fair");
  assert.equal(weatherLabel(50).label, "Showers");
  assert.equal(weatherLabel(49).label, "Storms");
});
