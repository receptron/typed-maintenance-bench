import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Arm } from "./arms.js";
import { hasApiCases, runApiCaseDir } from "./apiRunner.js";
import { isRecord, isStringList, type Verdict } from "./cases.js";
import { runCaseDir, type Commands } from "./caseRunner.js";
import { loadCommandsFor, loadLibraryFor } from "./command.js";
import { execute } from "./exec.js";
import { stageDir } from "./paths.js";

export type StepResult = { exitCode: number | null; output: string; durationMs: number };
export type StageGrade = { stage: number; passed: number; total: number; failed: { id: string; failures: string[] }[] };
export type Grade = { build: StepResult | null; verify: StepResult | null; stages: StageGrade[] };

const STEP_TIMEOUT_MS = 5 * 60 * 1000;

const runStep = async (command: string[] | null, tree: string): Promise<StepResult | null> => {
  if (command === null) return null;
  const { exitCode, output, durationMs } = await execute(command, { cwd: tree, timeoutMs: STEP_TIMEOUT_MS });
  return { exitCode, output, durationMs };
};

export type Entrypoints = { commands: Commands; library: string };

const RETIRED_FILE = "retired.json";

// A breaking change retires the earlier cases that assert the old behaviour; they are skipped from that stage on.
export const retiredUpTo = (stage: number): Set<string> =>
  new Set(
    Array.from({ length: stage }, (_, index) => path.join(stageDir(index + 1), "hidden-tests", RETIRED_FILE))
      .filter((file) => existsSync(file))
      .flatMap((file) => readRetired(file)),
  );

const readRetired = (file: string): string[] => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !isStringList(parsed.retired)) throw new Error(`${file} must hold { "retired": [ids] }`);
  return parsed.retired;
};

const runCases = (entrypoints: Entrypoints, casesDir: string, skip: ReadonlySet<string>): Verdict[] => [
  ...(existsSync(path.join(casesDir, "cases.json")) ? runCaseDir(entrypoints.commands, casesDir, skip) : []),
  ...(hasApiCases(casesDir) ? runApiCaseDir(entrypoints.library, casesDir, skip) : []),
];

// Cases run on a copy, so a tool that writes next to its input cannot alter the fixtures.
const runOnCopy = (entrypoints: Entrypoints, stage: number, skip: ReadonlySet<string>): Verdict[] => {
  const copy = mkdtempSync(path.join(os.tmpdir(), "tmb-grade-"));
  try {
    cpSync(path.join(stageDir(stage), "hidden-tests"), copy, { recursive: true });
    return runCases(entrypoints, copy, skip);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

export const gradeStage = (entrypoints: Entrypoints, stage: number, skip: ReadonlySet<string>): StageGrade => {
  const verdicts = runOnCopy(entrypoints, stage, skip);
  const failed = verdicts.filter((verdict) => !verdict.passed).map(({ id, failures }) => ({ id, failures }));
  return { stage, passed: verdicts.length - failed.length, total: verdicts.length, failed };
};

export const entrypointsFor = (arm: Arm, tree: string): Entrypoints => ({
  commands: loadCommandsFor(arm, tree),
  library: loadLibraryFor(arm, tree),
});

export const gradeTree = async (arm: Arm, stage: number, tree: string): Promise<Grade> => {
  const build = await runStep(arm.build, tree);
  const verify = await runStep(arm.verify, tree);
  const entrypoints = entrypointsFor(arm, tree);
  const skip = retiredUpTo(stage);
  const stages = Array.from({ length: stage }, (_, index) => gradeStage(entrypoints, index + 1, skip));
  return { build, verify, stages };
};
