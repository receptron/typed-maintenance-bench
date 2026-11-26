import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ARMS, type Arm } from "./arms.js";
import { runStage, type StageResult, type StageRun } from "./runStage.js";
import { MAX_STAGE, parseStageRange } from "./stages.js";
import type { Mode } from "./tree.js";

const STAGES = parseStageRange(`1-${MAX_STAGE}`);
const MODES: Mode[] = ["cumulative", "reset"];
// The reference agent copies files and never times out.
const UNUSED_TIMEOUT_MS = 0;
const MAX_PROBLEM_CHARS = 600;

const problemsIn = ({ grade, escapes }: StageResult): string[] => {
  const problems: string[] = [];
  [grade.build, grade.verify].forEach((step) => {
    if (step !== null && step.exitCode !== 0) problems.push(`build or verify failed:\n${step.output}`);
  });
  grade.stages
    .filter((stageGrade) => stageGrade.failed.length > 0)
    .forEach((stageGrade) =>
      problems.push(`stage ${stageGrade.stage} cases failed: ${JSON.stringify(stageGrade.failed)}`),
    );
  if (Object.values(escapes).some((count) => count > 0)) problems.push(`escape hatches: ${JSON.stringify(escapes)}`);
  return problems;
};

const referenceRun = (arm: Arm, mode: Mode, resultsDir: string): Omit<StageRun, "stage"> => ({
  arm,
  mode,
  repeat: "check",
  agent: "reference",
  model: "none",
  timeoutMs: UNUSED_TIMEOUT_MS,
  budgetUsd: 0,
  auth: "api-key",
  resultsDir,
});

const checkArmMode = async (arm: Arm, mode: Mode, resultsDir: string): Promise<string[]> => {
  const base = referenceRun(arm, mode, resultsDir);
  const problems: string[] = [];
  for (const stage of STAGES) {
    const result = await runStage({ ...base, stage });
    problems.push(
      ...problemsIn(result).map((problem) => `${arm.id} ${mode} stage ${stage}: ${problem} (${result.outDir})`),
    );
  }
  return problems;
};

// End-to-end self-test: the reference agent must pass every hidden case in every arm and mode.
const main = async (): Promise<void> => {
  const resultsDir = mkdtempSync(path.join(os.tmpdir(), "tmb-check-"));
  const problems: string[] = [];
  for (const arm of Object.values(ARMS)) {
    for (const mode of MODES) problems.push(...(await checkArmMode(arm, mode, resultsDir)));
  }
  problems.forEach((problem) => console.error(problem.slice(0, MAX_PROBLEM_CHARS)));
  console.log(
    problems.length === 0 ? `reference passes every arm and mode (${resultsDir})` : `${problems.length} problems`,
  );
  process.exitCode = problems.length === 0 ? 0 : 1;
};

await main();
