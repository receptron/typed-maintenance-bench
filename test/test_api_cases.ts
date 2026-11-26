import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isApiCase, judgeApi, matches, type ApiCase, type ApiObservation } from "../src/apiCases.js";

const ANY = { $anyString: true };

const apiCase = (expect: ApiCase["expect"]): ApiCase => ({ id: "c", description: "", call: "read", args: [], expect });

const returned = (value: unknown, modifiedArguments = false): ApiObservation => ({
  kind: "returned",
  value,
  modifiedArguments,
});

const threw = (name: string, isTypeError: boolean, isError = true): ApiObservation => ({
  kind: "threw",
  isTypeError,
  isError,
  name,
  message: "m",
});

describe("matches", () => {
  it("compares JSON values exactly", () => {
    assert.ok(matches({ a: [1, "x", null], b: true }, { b: true, a: [1, "x", null] }));
    assert.ok(!matches({ a: 1 }, { a: 1, b: 2 }));
    assert.ok(!matches({ a: 1, b: 2 }, { a: 1 }));
    assert.ok(!matches([1, 2], [1, 2, 3]));
    assert.ok(!matches([1, 2], [2, 1]));
    assert.ok(!matches("1", 1));
    assert.ok(!matches({}, []));
    assert.ok(!matches([], {}));
    assert.ok(!matches(null, {}));
  });
  it("lets the any-string marker stand for a string and nothing else", () => {
    assert.ok(matches({ reason: ANY }, { reason: "free text" }));
    assert.ok(matches([ANY], [""]));
    [1, null, {}, [], true].forEach((value) => assert.ok(!matches(ANY, value), JSON.stringify(value)));
    assert.ok(!matches({ $anyString: true, extra: 1 }, "x"), "a marker with other keys is an ordinary object");
  });
});

describe("judgeApi", () => {
  it("passes an equal return value and fails a different one", () => {
    assert.ok(judgeApi(apiCase({ returns: [1] }), returned([1])).passed);
    assert.ok(!judgeApi(apiCase({ returns: [1] }), returned([2])).passed);
  });
  it("fails a correct return value when the arguments were modified", () => {
    const verdict = judgeApi(apiCase({ returns: 1 }), returned(1, true));
    assert.deepEqual(verdict.failures, ["modified its arguments"]);
  });
  it("tells TypeError and ReadError apart", () => {
    assert.ok(judgeApi(apiCase({ throws: "TypeError" }), threw("TypeError", true)).passed);
    assert.ok(!judgeApi(apiCase({ throws: "TypeError" }), threw("ReadError", false)).passed);
    assert.ok(judgeApi(apiCase({ throws: "ReadError" }), threw("ReadError", false)).passed);
    assert.ok(!judgeApi(apiCase({ throws: "ReadError" }), threw("Error", false)).passed);
    assert.ok(!judgeApi(apiCase({ throws: "ReadError" }), threw("ReadError", false, false)).passed, "a non-Error");
  });
  it("fails a throw where a value was expected, a value where a throw was expected, and a crash", () => {
    assert.ok(!judgeApi(apiCase({ returns: 1 }), threw("TypeError", true)).passed);
    assert.ok(!judgeApi(apiCase({ throws: "TypeError" }), returned(1)).passed);
    assert.ok(!judgeApi(apiCase({ returns: 1 }), { kind: "crashed", detail: "exit 1" }).passed);
  });
});

describe("isApiCase", () => {
  it("accepts a well-formed case and rejects malformed ones", () => {
    const good = { id: "a", description: "", call: "render", args: [], expect: { returns: "" } };
    assert.ok(isApiCase(good));
    assert.ok(isApiCase({ ...good, call: "registerFormat", setup: [{ call: "read", args: [], throws: true }] }));
    [
      { ...good, call: "write" },
      { ...good, args: {} },
      { ...good, expect: { throws: "RangeError" } },
      { ...good, expect: {} },
      { ...good, env: { TZ: 1 } },
      { ...good, id: 1 },
      { ...good, setup: {} },
      { ...good, setup: [{ call: "write", args: [] }] },
      { ...good, setup: [{ call: "read", args: [], throws: "yes" }] },
    ].forEach((bad) => assert.ok(!isApiCase(bad), JSON.stringify(bad)));
  });
});
