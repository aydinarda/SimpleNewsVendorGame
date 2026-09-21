import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleDemand } from "../../../server/utils/demand.js";

test("uniform stays within [min, max]", () => {
  for (let i = 0; i < 1000; i++) {
    const d = sampleDemand({ type: "uniform", min: 80, max: 120 });
    assert.ok(d >= 80 && d <= 120, `out of range: ${d}`);
  }
});

test("uniform with min === max is deterministic", () => {
  assert.equal(sampleDemand({ type: "uniform", min: 100, max: 100 }), 100);
});

test("uniform honors a stubbed Math.random (lower bound)", () => {
  const original = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(sampleDemand({ type: "uniform", min: 80, max: 120 }), 80);
  } finally {
    Math.random = original;
  }
});

test("normal with stdDev=0 collapses to the mean", () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(sampleDemand({ type: "normal", mean: 100, stdDev: 0 }), 100);
  }
});

test("normal output is never negative (low draws clamp to 0)", () => {
  for (let i = 0; i < 2000; i++) {
    const d = sampleDemand({ type: "normal", mean: 5, stdDev: 20 });
    assert.ok(d >= 0, `negative draw: ${d}`);
  }
});

test("normal maps a deeply negative draw straight to 0", () => {
  const original = Math.random;
  // u → tiny (large magnitude), v = 0.5 → cos(2πv) = -1, so z is large negative.
  const queue = [1e-12, 0.5];
  Math.random = () => queue.shift();
  try {
    assert.equal(sampleDemand({ type: "normal", mean: 5, stdDev: 20 }), 0);
  } finally {
    Math.random = original;
  }
});

test("triangular stays within [min, max] and centers on (min + mode + max) / 3", () => {
  const distribution = { type: "triangular", min: 60, mode: 90, max: 150 };
  let sum = 0;
  const draws = 20000;
  for (let i = 0; i < draws; i++) {
    const d = sampleDemand(distribution);
    assert.ok(d >= 60 && d <= 150, `out of range: ${d}`);
    sum += d;
  }
  // Theoretical mean is 100; the sample mean of 20k draws lands well within ±1.
  assert.ok(Math.abs(sum / draws - 100) < 1, `sample mean ${sum / draws}`);
});

test("triangular maps the ends of the random range onto min and max", () => {
  const original = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(sampleDemand({ type: "triangular", min: 80, mode: 100, max: 120 }), 80);
    Math.random = () => 1 - Number.EPSILON;
    assert.equal(sampleDemand({ type: "triangular", min: 80, mode: 100, max: 120 }), 120);
  } finally {
    Math.random = original;
  }
});

test("triangular with the peak on a bound and a degenerate range", () => {
  for (let i = 0; i < 500; i++) {
    const d = sampleDemand({ type: "triangular", min: 80, mode: 80, max: 120 });
    assert.ok(d >= 80 && d <= 120, `out of range: ${d}`);
  }
  assert.equal(sampleDemand({ type: "triangular", min: 100, mode: 100, max: 100 }), 100);
});

test("unsupported distribution type throws", () => {
  assert.throws(() => sampleDemand({ type: "poisson" }), /Unsupported distribution type/);
});
