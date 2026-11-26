import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Arm } from "./arms.js";
import { runCaseDir } from "./caseRunner.js";
import { loadCommandFor } from "./command.js";
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

// Cases run on a copy, so a tool that writes next to its input cannot alter the fixtures.
const runOnCopy = (command: string[], stage: number): ReturnType<typeof runCaseDir> => {
  const copy = mkdtempSync(path.join(os.tmpdir(), "tmb-grade-"));
  try {
    cpSync(path.join(stageDir(stage), "hidden-tests"), copy, { recursive: true });
    return runCaseDir(command, copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
};

const gradeStage = (command: string[], stage: number): StageGrade => {
  const verdicts = runOnCopy(command, stage);
  const failed = verdicts.filter((verdict) => !verdict.passed).map(({ id, failures }) => ({ id, failures }));
  return { stage, passed: verdicts.length - failed.length, total: verdicts.length, failed };
};

export const gradeTree = async (arm: Arm, stage: number, tree: string): Promise<Grade> => {
  const build = await runStep(arm.build, tree);
  const verify = await runStep(arm.verify, tree);
  const command = loadCommandFor(arm, tree);
  const stages = Array.from({ length: stage }, (_, index) => gradeStage(command, index + 1));
  return { build, verify, stages };
};
