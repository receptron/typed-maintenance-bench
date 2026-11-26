import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupRecords, summaryTable, type StageRecord } from "../src/summary.js";

const record = (overrides: Partial<StageRecord>): StageRecord => ({
  arm: "ts",
  mode: "cumulative",
  repeat: "r1",
  stage: 1,
  passed: 21,
  total: 21,
  escapes: 0,
  durationMs: 60_000,
  costUsd: 0.1,
  ...overrides,
});

describe("groupRecords", () => {
  it("groups by arm, mode and stage, and orders the groups", () => {
    const groups = groupRecords([
      record({ arm: "ts", stage: 2 }),
      record({ arm: "js" }),
      record({ arm: "ts", repeat: "r2" }),
      record({ arm: "ts" }),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.arm, group.stage, group.records.length]),
      [
        ["js", 1, 1],
        ["ts", 1, 2],
        ["ts", 2, 1],
      ],
    );
  });
  it("returns no groups for no records", () => assert.deepEqual(groupRecords([]), []));
});

describe("summaryTable", () => {
  it("reports means, the escape range and how many runs passed every case", () => {
    const table = summaryTable([
      record({ escapes: 10, passed: 20, durationMs: 60_000, costUsd: 0.1 }),
      record({ repeat: "r2", escapes: 20, durationMs: 180_000, costUsd: 0.3 }),
    ]);
    assert.equal(table.split("\n").at(-1), "| ts | cumulative | 1 | 2 | 1/2 | 20.5/21 | 15.0 (10–20) | 2.0 | $0.20 |");
  });
  it("shows the cost as n/a when any run has no cost", () => {
    const table = summaryTable([record({}), record({ repeat: "r2", costUsd: null })]);
    assert.ok(table.split("\n").at(-1)?.endsWith("| n/a |"));
  });
});
