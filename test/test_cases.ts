import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCaseFile, judge, type Case, type Observed } from "../src/cases.js";

const baseCase = (expect: Case["expect"]): Case => ({ id: "c", description: "d", args: [], expect });
const observed = (overrides: Partial<Observed> = {}): Observed => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...overrides,
});

describe("judge", () => {
  it("passes when exit code and stdout match", () => {
    assert.equal(judge(baseCase({ exitCode: 0, stdout: "a\n" }), observed({ stdout: "a\n" })).passed, true);
  });
  it("fails on a different exit code, a null exit code or a timeout", () => {
    assert.equal(judge(baseCase({ exitCode: 2 }), observed()).passed, false);
    assert.equal(judge(baseCase({ exitCode: 0 }), observed({ exitCode: null })).passed, false);
    assert.equal(judge(baseCase({ exitCode: 0 }), observed({ timedOut: true })).passed, false);
  });
  it("compares stdout exactly, including the trailing newline", () => {
    assert.equal(judge(baseCase({ exitCode: 0, stdout: "a\n" }), observed({ stdout: "a" })).passed, false);
  });
  it("matches stderr prefixes as a multiset, in any order", () => {
    const expect = { exitCode: 0, stderrPrefixes: ["f:2:", "f:3:"] };
    assert.equal(judge(baseCase(expect), observed({ stderr: "f:3: x\nf:2: y\n" })).passed, true);
  });
  it("does not let one stderr line satisfy two prefixes", () => {
    const expect = { exitCode: 0, stderrPrefixes: ["f:2:", "f:2:"] };
    assert.equal(judge(baseCase(expect), observed({ stderr: "f:2: x\nother\n" })).passed, false);
  });
  it("counts stderr lines, ignoring empty lines and CRLF", () => {
    const expect = { exitCode: 0, stderrPrefixes: [] };
    assert.equal(judge(baseCase(expect), observed({ stderr: "\r\n\n" })).passed, true);
    assert.equal(judge(baseCase(expect), observed({ stderr: "warning\n" })).passed, false);
  });
  it("requires a stderr message when asked to", () => {
    assert.equal(judge(baseCase({ exitCode: 2, stderrNonEmpty: true }), observed({ exitCode: 2 })).passed, false);
    assert.equal(
      judge(baseCase({ exitCode: 2, stderrNonEmpty: true }), observed({ exitCode: 2, stderr: "e" })).passed,
      true,
    );
  });
});

describe("judge with expected files", () => {
  const files = { dir: "out", contents: { "a.txt": "1\n", "b/c.txt": "2\n" } };
  const withFiles = baseCase({ exitCode: 0, files });
  it("passes when the directory holds exactly the expected files", () => {
    assert.equal(judge(withFiles, observed({ files: { "b/c.txt": "2\n", "a.txt": "1\n" } })).passed, true);
  });
  it("names a missing, an unexpected and a different file", () => {
    const verdict = judge(withFiles, observed({ files: { "a.txt": "x\n", "d.txt": "" } }));
    assert.deepEqual(
      verdict.failures.map((failure) => failure.split("\n")[0]),
      ["out/a.txt differs", "missing file out/b/c.txt", "unexpected file out/d.txt"],
    );
  });
  it("treats an absent directory as holding no files", () => {
    assert.equal(judge(baseCase({ exitCode: 0, files: { dir: "out", contents: {} } }), observed()).passed, true);
    assert.equal(judge(withFiles, observed()).passed, false);
  });
});

describe("isCaseFile", () => {
  it("accepts a minimal case file", () => {
    assert.equal(isCaseFile({ cases: [baseCase({ exitCode: 0 })] }), true);
  });
  it("rejects malformed files", () => {
    [
      null,
      [],
      {},
      { cases: {} },
      { cases: [{ id: "x" }] },
      { cases: [{ ...baseCase({ exitCode: 0 }), env: { TZ: 1 } }] },
    ].forEach((value) => assert.equal(isCaseFile(value), false, JSON.stringify(value)));
    assert.equal(isCaseFile({ cases: [{ ...baseCase({ exitCode: 0 }), args: [1] }] }), false);
    assert.equal(isCaseFile({ cases: [{ ...baseCase({ exitCode: 0 }), tool: "report" }] }), true);
    assert.equal(isCaseFile({ cases: [{ ...baseCase({ exitCode: 0 }), tool: "mailer" }] }), false);
    assert.equal(
      isCaseFile({
        cases: [{ ...baseCase({ exitCode: 0 }), expect: { exitCode: 0, files: { dir: "out", contents: { a: 1 } } } }],
      }),
      false,
    );
    assert.equal(
      isCaseFile({ cases: [{ id: "c", description: "d", args: [], expect: { exitCode: 0, stdout: 1 } }] }),
      false,
    );
  });
});
