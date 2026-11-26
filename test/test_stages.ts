import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ARMS } from "../src/arms.js";
import { MAX_STAGE, parseStageRange } from "../src/stages.js";
import { renderTask } from "../src/tree.js";

describe("parseStageRange", () => {
  it("accepts a single stage and a range", () => {
    assert.deepEqual(parseStageRange("1"), [1]);
    assert.deepEqual(
      parseStageRange(`1-${MAX_STAGE}`),
      Array.from({ length: MAX_STAGE }, (_, index) => index + 1),
    );
  });
  it("rejects malformed and out-of-range values", () => {
    ["", "0", "a", "2-1", "1-", "-1", `1-${MAX_STAGE + 1}`, "1.5"].forEach((text) =>
      assert.throws(() => parseStageRange(text), Error, text),
    );
  });
});

describe("renderTask", () => {
  it("fills every placeholder for every arm and stage", () => {
    Object.values(ARMS).forEach((arm) =>
      parseStageRange(`1-${MAX_STAGE}`).forEach((stage) => {
        const task = renderTask(arm, stage);
        assert.equal(task.includes("{{"), false, `${arm.id} stage ${stage}`);
        assert.equal(task.includes(arm.taskRun), true);
      }),
    );
  });
});
