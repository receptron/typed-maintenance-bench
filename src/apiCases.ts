// Shipped into the agent's tree with the API runner, so this file may import only Node built-ins.
import { isRecord, isStringList, type Verdict } from "./cases.js";

export const API_CALLS = ["read", "aggregate", "render", "pipeline", "registerFormat"] as const;
export type ApiCall = (typeof API_CALLS)[number];
export const ERROR_KINDS = ["TypeError", "ReadError"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ApiExpectation = { returns: unknown } | { throws: ErrorKind };

// A call made before the one under test. It must throw exactly when `throws` is true; otherwise the case crashes.
export type ApiStep = { call: ApiCall; args: unknown[]; throws?: boolean };

export type ApiCase = {
  id: string;
  description: string;
  env?: Record<string, string>;
  setup?: ApiStep[];
  call: ApiCall;
  args: unknown[];
  recordsFrom?: unknown;
  expect: ApiExpectation;
};

export type ApiObservation =
  | { kind: "returned"; value: unknown; modifiedArguments: boolean }
  | { kind: "threw"; isTypeError: boolean; isError: boolean; name: string; message: string }
  | { kind: "crashed"; detail: string };

// Stands for any string in an expected value, for free-text fields such as warning reasons.
export const ANY_STRING = "$anyString";
export const UNDEFINED_MARKER = "$undefined";
// Stands for a plugin parse function the worker builds, since a case file cannot hold a function.
export const PLUGIN_MARKER = "$plugin";

const isApiCall = (value: unknown): value is ApiCall => API_CALLS.some((call) => call === value);
const isErrorKind = (value: unknown): value is ErrorKind => ERROR_KINDS.some((kind) => kind === value);

export const isApiExpectation = (value: unknown): value is ApiExpectation =>
  isRecord(value) && ("returns" in value || isErrorKind(value.throws));

const isStep = (value: unknown): value is ApiStep =>
  isRecord(value) &&
  isApiCall(value.call) &&
  Array.isArray(value.args) &&
  (value.throws === undefined || typeof value.throws === "boolean");

const isSetup = (value: unknown): boolean => value === undefined || (Array.isArray(value) && value.every(isStep));

const isEnv = (value: unknown): boolean =>
  value === undefined || (isRecord(value) && isStringList(Object.values(value)));

export const isApiCase = (value: unknown): value is ApiCase =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.description === "string" &&
  isEnv(value.env) &&
  isSetup(value.setup) &&
  isApiCall(value.call) &&
  Array.isArray(value.args) &&
  isApiExpectation(value.expect);

export const isApiCaseFile = (value: unknown): value is { cases: ApiCase[] } =>
  isRecord(value) && Array.isArray(value.cases) && value.cases.every(isApiCase);

const isAnyString = (value: unknown): boolean =>
  isRecord(value) && value[ANY_STRING] === true && Object.keys(value).length === 1;

const sameKeys = (left: Record<string, unknown>, right: Record<string, unknown>): boolean =>
  Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => key in right);

export const matches = (expected: unknown, actual: unknown): boolean => {
  if (isAnyString(expected)) return typeof actual === "string";
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) => matches(item, actual[index]))
    );
  if (isRecord(expected))
    return (
      isRecord(actual) &&
      sameKeys(expected, actual) &&
      Object.keys(expected).every((key) => matches(expected[key], actual[key]))
    );
  return expected === actual;
};

const thrownFailures = (expected: ErrorKind, observed: ApiObservation): string[] => {
  if (observed.kind !== "threw") return [`expected a ${expected}, got ${describe(observed)}`];
  const ok = expected === "TypeError" ? observed.isTypeError : observed.isError && observed.name === "ReadError";
  return ok ? [] : [`expected a ${expected}, got ${observed.name}: ${observed.message}`];
};

const describe = (observed: ApiObservation): string => {
  if (observed.kind === "returned") return `a return value ${JSON.stringify(observed.value)}`;
  return observed.kind === "threw" ? `${observed.name}: ${observed.message}` : `a crash: ${observed.detail}`;
};

const returnedFailures = (expected: unknown, observed: ApiObservation): string[] => {
  if (observed.kind !== "returned") return [`expected a return value, got ${describe(observed)}`];
  const failures = observed.modifiedArguments ? ["modified its arguments"] : [];
  if (!matches(expected, observed.value))
    failures.push(
      `return value differs\n--- expected\n${JSON.stringify(expected)}\n--- actual\n${JSON.stringify(observed.value)}`,
    );
  return failures;
};

export const judgeApi = (testCase: ApiCase, observed: ApiObservation): Verdict => {
  const { expect } = testCase;
  const failures =
    "throws" in expect ? thrownFailures(expect.throws, observed) : returnedFailures(expect.returns, observed);
  return { id: testCase.id, passed: failures.length === 0, failures };
};
