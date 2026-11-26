import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ARMS } from "../src/arms.js";
import type { Grade } from "../src/grade.js";
import { referenceDir } from "../src/paths.js";
import { SEED_STAGE, applyReplacements, failingCasesOf, loadBugs, renderPlantPrompt, type Bug } from "../src/seed.js";

const bug = (id: string): Bug => ({ id, plant: `plant ${id}`, replacements: [] });

const gradeWith = (stage: number, ids: string[]): Grade => ({
  build: null,
  verify: null,
  stages: [{ stage, passed: 0, total: ids.length, failed: ids.map((id) => ({ id, failures: [] })) }],
});

describe("failingCasesOf", () => {
  it("picks the seed stage's failures whose id names the bug", () => {
    const grade = gradeWith(SEED_STAGE, ["s7-a-cli", "s7-b-report", "s7-ab-x", "s7-a-api"]);
    assert.deepEqual(failingCasesOf(grade, bug("a")), ["s7-a-cli", "s7-a-api"]);
  });
  it("ignores failures of other stages", () => {
    assert.deepEqual(failingCasesOf(gradeWith(SEED_STAGE - 1, ["s7-a-cli"]), bug("a")), []);
  });
});

describe("applyReplacements", () => {
  it("replaces each text once and refuses text that is not there", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tmb-test-seed-"));
    try {
      mkdirSync(path.join(dir, "sub"));
      writeFileSync(path.join(dir, "sub", "f.ts"), "one two two\n");
      applyReplacements(dir, [{ id: "a", plant: "", replacements: [{ file: "sub/f.ts", from: "two", to: "2" }] }]);
      assert.equal(readFileSync(path.join(dir, "sub", "f.ts"), "utf8"), "one 2 two\n");
      const missing = [{ id: "b", plant: "", replacements: [{ file: "sub/f.ts", from: "three", to: "3" }] }];
      assert.throws(() => applyReplacements(dir, missing), /bug b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the stage 7 bugs", () => {
  it("each replacement matches the stage 6 reference exactly once", () => {
    loadBugs().forEach((seeded) =>
      seeded.replacements.forEach(({ file, from }) => {
        const source = readFileSync(path.join(referenceDir(SEED_STAGE), "src", file), "utf8");
        assert.equal(source.split(from).length - 1, 1, `${seeded.id} ${file}`);
      }),
    );
  });
  it("fills every placeholder of the planting prompt", () => {
    const bugs = loadBugs();
    Object.values(ARMS).forEach((arm) => {
      const prompt = renderPlantPrompt(arm, bugs);
      assert.equal(prompt.includes("{{"), false, arm.id);
      bugs.forEach((seeded) => assert.ok(prompt.includes(seeded.plant)));
    });
  });
});
