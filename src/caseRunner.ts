import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCaseFile, isStringList, judge, type Case, type Observed, type Tool, type Verdict } from "./cases.js";

// The command for each tool; a stage without a report tool has none.
export type Commands = { cli: string[]; report: string[] | null };

const CASE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TREE_PLACEHOLDER = "{tree}";
const DEFAULT_ENV = { TZ: "UTC" };
export const REPORT_COMMAND_FILE = "report-command.json";

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${String(error)}`, { cause: error });
  }
};

export const loadCases = (casesDir: string): Case[] => {
  const file = path.join(casesDir, "cases.json");
  const parsed = readJson(file);
  if (!isCaseFile(parsed)) throw new Error(`${file} is not a valid case file`);
  return parsed.cases;
};

const loadCommandFile = (treeRoot: string, name: string): string[] => {
  const file = path.join(treeRoot, "tests", name);
  const parsed = readJson(file);
  if (!isStringList(parsed) || parsed.length === 0) throw new Error(`${file} must be a non-empty array of strings`);
  return parsed.map((part) => part.replaceAll(TREE_PLACEHOLDER, treeRoot));
};

export const loadCommands = (treeRoot: string): Commands => ({
  cli: loadCommandFile(treeRoot, "command.json"),
  report: existsSync(path.join(treeRoot, "tests", REPORT_COMMAND_FILE))
    ? loadCommandFile(treeRoot, REPORT_COMMAND_FILE)
    : null,
});

const commandFor = (commands: Commands, tool: Tool): string[] => {
  if (tool === "cli") return commands.cli;
  if (commands.report === null) throw new Error("a case needs the report tool, which this stage does not have");
  return commands.report;
};

const insideDir = (root: string, relative: string): string => {
  const resolved = path.resolve(root, relative);
  if (path.relative(root, resolved).startsWith("..")) throw new Error(`${relative} is outside ${root}`);
  return resolved;
};

const readFilesUnder = (dir: string): Record<string, string> => {
  if (!existsSync(dir)) return {};
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  return Object.fromEntries(
    names
      .filter((name) => statSync(path.join(dir, name)).isFile())
      .map((name) => [name.split(path.sep).join("/"), readFileSync(path.join(dir, name), "utf8")]),
  );
};

export const runCase = (commands: Commands, testCase: Case, fixturesDir: string): Observed => {
  const outDir = testCase.expect.files === undefined ? null : insideDir(fixturesDir, testCase.expect.files.dir);
  if (outDir !== null) rmSync(outDir, { recursive: true, force: true });
  const [program = "", ...baseArgs] = commandFor(commands, testCase.tool ?? "cli");
  const result = spawnSync(program, [...baseArgs, ...testCase.args], {
    cwd: fixturesDir,
    env: { ...process.env, ...DEFAULT_ENV, ...testCase.env },
    encoding: "utf8",
    timeout: CASE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const timedOut = result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT";
  const observed = { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut };
  return outDir === null ? observed : { ...observed, files: readFilesUnder(outDir) };
};

export const runCaseDir = (commands: Commands, casesDir: string, skip: ReadonlySet<string> = new Set()): Verdict[] => {
  const fixturesDir = path.join(casesDir, "fixtures");
  return loadCases(casesDir)
    .filter((testCase) => !skip.has(testCase.id))
    .map((testCase) => judge(testCase, runCase(commands, testCase, fixturesDir)));
};

const printVerdicts = (verdicts: Verdict[]): void => {
  verdicts
    .filter((verdict) => !verdict.passed)
    .forEach((verdict) => console.log(`FAIL ${verdict.id}\n  ${verdict.failures.join("\n  ")}`));
  const passedCount = verdicts.filter((verdict) => verdict.passed).length;
  console.log(`${passedCount}/${verdicts.length} cases passed`);
};

const main = (): void => {
  const casesDir = process.argv[2];
  if (casesDir === undefined) throw new Error("usage: node tests/runner/caseRunner.js <cases-dir>");
  const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const verdicts = runCaseDir(loadCommands(treeRoot), path.resolve(casesDir));
  printVerdicts(verdicts);
  process.exitCode = verdicts.every((verdict) => verdict.passed) ? 0 : 1;
};

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
