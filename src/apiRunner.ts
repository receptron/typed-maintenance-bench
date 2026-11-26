// Shipped into the agent's tree as the visible API-test runner, so it may import only Node built-ins.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isApiCaseFile, judgeApi, type ApiCase, type ApiObservation } from "./apiCases.js";
import { isRecord, type Verdict } from "./cases.js";

const CASE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_ENV = { TZ: "UTC" };
const TREE_PLACEHOLDER = "{tree}";
export const API_CASES_FILE = "api-cases.json";
const MAX_DETAIL_CHARS = 2000;
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "apiWorker.js");

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${String(error)}`, { cause: error });
  }
};

export const hasApiCases = (casesDir: string): boolean => existsSync(path.join(casesDir, API_CASES_FILE));

export const loadApiCases = (casesDir: string): ApiCase[] => {
  const file = path.join(casesDir, API_CASES_FILE);
  const parsed = readJson(file);
  if (!isApiCaseFile(parsed)) throw new Error(`${file} is not a valid API case file`);
  return parsed.cases;
};

const isObservation = (value: unknown): value is ApiObservation =>
  isRecord(value) && (value.kind === "returned" || value.kind === "threw");

const parseObservation = (stdout: string): ApiObservation | null => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isObservation(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const runApiCase = (entry: string, testCase: ApiCase, fixturesDir: string): ApiObservation => {
  const result = spawnSync("node", [WORKER, entry], {
    cwd: fixturesDir,
    env: { ...process.env, ...DEFAULT_ENV, ...testCase.env },
    input: JSON.stringify(testCase),
    encoding: "utf8",
    timeout: CASE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const observation = result.status === 0 ? parseObservation(result.stdout) : null;
  const detail = result.error === undefined ? `exit ${result.status}: ${result.stderr}` : String(result.error);
  return observation ?? { kind: "crashed", detail: detail.slice(0, MAX_DETAIL_CHARS) };
};

export const runApiCaseDir = (entry: string, casesDir: string): Verdict[] => {
  const fixturesDir = path.join(casesDir, "fixtures");
  return loadApiCases(casesDir).map((testCase) => judgeApi(testCase, runApiCase(entry, testCase, fixturesDir)));
};

export const loadLibraryEntry = (treeRoot: string): string => {
  const file = path.join(treeRoot, "tests", "library.json");
  const parsed = readJson(file);
  if (typeof parsed !== "string") throw new Error(`${file} must be a JSON string`);
  return parsed.replaceAll(TREE_PLACEHOLDER, treeRoot);
};

const main = (): void => {
  const casesDir = process.argv[2];
  if (casesDir === undefined) throw new Error("usage: node tests/runner/apiRunner.js <cases-dir>");
  const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const verdicts = runApiCaseDir(loadLibraryEntry(treeRoot), path.resolve(casesDir));
  verdicts
    .filter((verdict) => !verdict.passed)
    .forEach((verdict) => console.log(`FAIL ${verdict.id}\n  ${verdict.failures.join("\n  ")}`));
  console.log(`${verdicts.filter((verdict) => verdict.passed).length}/${verdicts.length} API cases passed`);
  process.exitCode = verdicts.every((verdict) => verdict.passed) ? 0 : 1;
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
