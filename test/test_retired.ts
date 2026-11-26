import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isRecord } from "../src/cases.js";
import { retiredUpTo } from "../src/grade.js";
import { stageDir } from "../src/paths.js";
import { MAX_STAGE } from "../src/stages.js";

const BREAKING_STAGE = 6;

const caseIdsOf = (stage: number): string[] =>
  ["cases.json", "api-cases.json"]
    .map((name) => path.join(stageDir(stage), "hidden-tests", name))
    .filter((file) => existsSync(file))
    .flatMap((file) => {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return isRecord(parsed) && Array.isArray(parsed.cases)
        ? parsed.cases.flatMap((testCase: unknown) =>
            isRecord(testCase) && typeof testCase.id === "string" ? [testCase.id] : [],
          )
        : [];
    });

describe("retiredUpTo", () => {
  it("retires nothing before the breaking change", () => {
    assert.equal(retiredUpTo(BREAKING_STAGE - 1).size, 0);
  });
  it("retires only cases of earlier stages, all of which exist", () => {
    const earlier = new Set(Array.from({ length: BREAKING_STAGE - 1 }, (_, index) => caseIdsOf(index + 1)).flat());
    const retired = retiredUpTo(MAX_STAGE);
    assert.ok(retired.size > 0);
    retired.forEach((id) => assert.ok(earlier.has(id), id));
  });
});
