import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCounts, countEscapes, emptyCounts } from "../src/escapes.js";

describe("countEscapes", () => {
  it("counts nothing in clean code, and does not count `as const`", () => {
    assert.deepEqual(
      countEscapes("export const xs = [1, 2] as const;\nconst f = (x: unknown): string => String(x);\n", "a.ts"),
      emptyCounts(),
    );
  });
  it("counts each kind of escape hatch", () => {
    const source = [
      "const a: any = 1;",
      "const b = a as string;",
      "const c = <number>a;",
      "const d = b!.length;",
      "// @ts-ignore",
      "/* @ts-expect-error */",
      "// @ts-nocheck",
      "// eslint-disable-next-line",
    ].join("\n");
    assert.deepEqual(countEscapes(source, "a.ts"), {
      anyKeyword: 1,
      asAssertion: 1,
      angleAssertion: 1,
      nonNullAssertion: 1,
      tsIgnore: 1,
      tsExpectError: 1,
      tsNocheck: 1,
      eslintDisable: 1,
    });
  });
  it("ignores directive text inside strings", () => {
    assert.deepEqual(countEscapes('const s = "// @ts-ignore eslint-disable";', "a.ts"), emptyCounts());
  });
  it("counts `any` inside generics and nested types", () => {
    assert.equal(
      countEscapes("type T = Map<string, any[]>; const f = (x: Record<string, any>) => x;", "a.ts").anyKeyword,
      2,
    );
  });
  it("parses JavaScript and counts only comment directives there", () => {
    assert.equal(countEscapes("// @ts-ignore\nconst x = 1;\n", "a.js").tsIgnore, 1);
  });
  it("handles empty and very long files", () => {
    assert.deepEqual(countEscapes("", "a.ts"), emptyCounts());
    const LONG_FILE_LINES = 50_000;
    const long = Array.from(
      { length: LONG_FILE_LINES },
      (_, index) => `// line ${index}\nconst v${index} = ${index};`,
    ).join("\n");
    assert.deepEqual(countEscapes(long, "a.ts"), emptyCounts());
  });
});

describe("addCounts", () => {
  it("adds every field", () => {
    const one = { ...emptyCounts(), anyKeyword: 1, eslintDisable: 2 };
    assert.deepEqual(addCounts(one, one), { ...emptyCounts(), anyKeyword: 2, eslintDisable: 4 });
  });
});
