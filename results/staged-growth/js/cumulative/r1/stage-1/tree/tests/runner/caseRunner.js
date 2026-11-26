import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCaseFile, isStringList, judge } from "./cases.js";
const CASE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const TREE_PLACEHOLDER = "{tree}";
const DEFAULT_ENV = { TZ: "UTC" };
const readJson = (file) => {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    }
    catch (error) {
        throw new Error(`cannot read ${file}: ${String(error)}`, { cause: error });
    }
};
export const loadCases = (casesDir) => {
    const file = path.join(casesDir, "cases.json");
    const parsed = readJson(file);
    if (!isCaseFile(parsed))
        throw new Error(`${file} is not a valid case file`);
    return parsed.cases;
};
export const loadCommand = (treeRoot) => {
    const file = path.join(treeRoot, "tests", "command.json");
    const parsed = readJson(file);
    if (!isStringList(parsed) || parsed.length === 0)
        throw new Error(`${file} must be a non-empty array of strings`);
    return parsed.map((part) => part.replaceAll(TREE_PLACEHOLDER, treeRoot));
};
export const runCase = (command, testCase, fixturesDir) => {
    const [program = "", ...baseArgs] = command;
    const result = spawnSync(program, [...baseArgs, ...testCase.args], {
        cwd: fixturesDir,
        env: { ...process.env, ...DEFAULT_ENV, ...testCase.env },
        encoding: "utf8",
        timeout: CASE_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
    });
    const timedOut = result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT";
    return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut };
};
export const runCaseDir = (command, casesDir) => {
    const fixturesDir = path.join(casesDir, "fixtures");
    return loadCases(casesDir).map((testCase) => judge(testCase, runCase(command, testCase, fixturesDir)));
};
const printVerdicts = (verdicts) => {
    verdicts
        .filter((verdict) => !verdict.passed)
        .forEach((verdict) => console.log(`FAIL ${verdict.id}\n  ${verdict.failures.join("\n  ")}`));
    const passedCount = verdicts.filter((verdict) => verdict.passed).length;
    console.log(`${passedCount}/${verdicts.length} cases passed`);
};
const main = () => {
    const casesDir = process.argv[2];
    if (casesDir === undefined)
        throw new Error("usage: node tests/runner/caseRunner.js <cases-dir>");
    const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const verdicts = runCaseDir(loadCommand(treeRoot), path.resolve(casesDir));
    printVerdicts(verdicts);
    process.exitCode = verdicts.every((verdict) => verdict.passed) ? 0 : 1;
};
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main();
