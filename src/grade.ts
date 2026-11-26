import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Arm } from "./arms.js";
import { hasApiCases, runApiCaseDir } from "./apiRunner.js";
import type { Verdict } from "./cases.js";
import { runCaseDir } from "./caseRunner.js";
import { loadCommandFor, loadLibraryFor } from "./command.js";
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

type Entrypoints = { command: string[]; library: string };

const runCases = (entrypoints: Entrypoints, casesDir: string): Verdict[] => [
  ...(existsSync(path.join(casesDir, "cases.json")) ? runCaseDir(entrypoints.command, casesDir) : []),
  ...(hasApiCases(casesDir) ? runApiCaseDir(entrypoints.library, casesDir) : []),
];

// Cases run on a copy, so a tool that writes next to its input cannot alter the fixtures.
const runOnCopy = (entrypoints: Entrypoints, stage: number): Verdict[] => {
  const copy = mkdtempSync(path.join(os.tmpdir(), "tmb-grade-"));
  try {
    cpSync(path.join(stageDir(stage), "hidden-tests"), copy, { recursive: true });
    return runCases(entrypoints, copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

const gradeStage = (entrypoints: Entrypoints, stage: number): StageGrade => {
  const verdicts = runOnCopy(entrypoints, stage);
  const failed = verdicts.filter((verdict) => !verdict.passed).map(({ id, failures }) => ({ id, failures }));
  return { stage, passed: verdicts.length - failed.length, total: verdicts.length, failed };
};

export const gradeTree = async (arm: Arm, stage: number, tree: string): Promise<Grade> => {
  const build = await runStep(arm.build, tree);
  const verify = await runStep(arm.verify, tree);
  const entrypoints = { command: loadCommandFor(arm, tree), library: loadLibraryFor(arm, tree) };
  const stages = Array.from({ length: stage }, (_, index) => gradeStage(entrypoints, index + 1));
  return { build, verify, stages };
};
