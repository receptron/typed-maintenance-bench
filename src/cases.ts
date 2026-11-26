// Shipped into the agent's tree as the visible-test runner, so this file and
// caseRunner.ts may import only Node built-ins.

// The exact set of files under dir after the run, by path relative to it with "/" separators.
export type FilesExpectation = { dir: string; contents: Record<string, string> };

export type Expectation = {
  exitCode: number;
  stdout?: string;
  stderrPrefixes?: string[];
  stderrNonEmpty?: boolean;
  files?: FilesExpectation;
};

export const TOOLS = ["cli", "report"] as const;
export type Tool = (typeof TOOLS)[number];

export type Case = {
  id: string;
  description: string;
  tool?: Tool;
  args: string[];
  env?: Record<string, string>;
  expect: Expectation;
};

export type CaseFile = { cases: Case[] };

export type Observed = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  files?: Record<string, string>;
};

export type Verdict = { id: string; passed: boolean; failures: string[] };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === "string");

const isOptional = <T>(value: unknown, guard: (inner: unknown) => inner is T): boolean =>
  value === undefined || guard(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isFilesExpectation = (value: unknown): value is FilesExpectation =>
  isRecord(value) && isString(value.dir) && isStringRecord(value.contents);

const isTool = (value: unknown): value is Tool => TOOLS.some((tool) => tool === value);

export const isExpectation = (value: unknown): value is Expectation =>
  isRecord(value) &&
  typeof value.exitCode === "number" &&
  isOptional(value.stdout, isString) &&
  isOptional(value.stderrPrefixes, isStringList) &&
  isOptional(value.stderrNonEmpty, isBoolean) &&
  isOptional(value.files, isFilesExpectation);

export const isCase = (value: unknown): value is Case =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.description) &&
  isOptional(value.tool, isTool) &&
  isStringList(value.args) &&
  isOptional(value.env, isStringRecord) &&
  isExpectation(value.expect);

export const isCaseFile = (value: unknown): value is CaseFile =>
  isRecord(value) && Array.isArray(value.cases) && value.cases.every(isCase);

const nonEmptyLines = (text: string): string[] => text.split(/\r?\n/).filter((line) => line.length > 0);

const unmatchedPrefixes = (prefixes: string[], lines: string[]): string[] => {
  const remaining = [...lines];
  return prefixes.filter((prefix) => {
    const index = remaining.findIndex((line) => line.startsWith(prefix));
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
};

const stderrFailures = (expect: Expectation, stderr: string): string[] => {
  const lines = nonEmptyLines(stderr);
  const failures: string[] = [];
  if (expect.stderrNonEmpty === true && lines.length === 0) failures.push("expected a message on stderr");
  if (expect.stderrPrefixes === undefined) return failures;
  if (lines.length !== expect.stderrPrefixes.length) {
    failures.push(`expected ${expect.stderrPrefixes.length} stderr lines, got ${lines.length}`);
  }
  unmatchedPrefixes(expect.stderrPrefixes, lines).forEach((prefix) =>
    failures.push(`no stderr line starts with "${prefix}"`),
  );
  return failures;
};

const fileFailures = (expected: FilesExpectation | undefined, actual: Record<string, string> | undefined): string[] => {
  if (expected === undefined) return [];
  const found = actual ?? {};
  const names = [...new Set([...Object.keys(expected.contents), ...Object.keys(found)])].sort();
  return names.flatMap((name) => {
    const [want, got] = [expected.contents[name], found[name]];
    if (want === undefined) return [`unexpected file ${expected.dir}/${name}`];
    if (got === undefined) return [`missing file ${expected.dir}/${name}`];
    return want === got ? [] : [`${expected.dir}/${name} differs\n--- expected\n${want}--- actual\n${got}`];
  });
};

export const judge = (testCase: Case, observed: Observed): Verdict => {
  const { expect } = testCase;
  const failures: string[] = [];
  if (observed.timedOut) failures.push("timed out");
  if (observed.exitCode !== expect.exitCode)
    failures.push(`exit code ${observed.exitCode}, expected ${expect.exitCode}`);
  if (expect.stdout !== undefined && observed.stdout !== expect.stdout) {
    failures.push(`stdout differs\n--- expected\n${expect.stdout}--- actual\n${observed.stdout}`);
  }
  failures.push(...stderrFailures(expect, observed.stderr));
  failures.push(...fileFailures(expect.files, observed.files));
  return { id: testCase.id, passed: failures.length === 0, failures };
};
