import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent, type AgentId } from "./agents.js";
import type { Arm } from "./arms.js";
import { countTreeEscapes, type EscapeCounts } from "./escapes.js";
import { gradeTree, type Grade } from "./grade.js";
import { collectProvenance } from "./meta.js";
import { EXPERIMENT } from "./paths.js";
import { copyTree, prepareTree, writeDiffSinceStart, type Mode } from "./tree.js";

export type StageRun = {
  arm: Arm;
  mode: Mode;
  stage: number;
  repeat: string;
  agent: AgentId;
  model: string;
  timeoutMs: number;
  budgetUsd: number;
  resultsDir: string;
};

export const runDir = (run: Omit<StageRun, "stage">, stage: number): string =>
  path.join(run.resultsDir, EXPERIMENT, run.arm.id, run.mode, run.repeat, `stage-${stage}`);

const writeJson = (file: string, value: unknown): void => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const claimOutputDir = (run: StageRun): string => {
  const outDir = runDir(run, run.stage);
  if (existsSync(outDir)) throw new Error(`${outDir} already exists; results are append-only, use another --repeat`);
  mkdirSync(outDir, { recursive: true });
  return outDir;
};

const prepare = async (run: StageRun): Promise<string> => {
  const tree = mkdtempSync(path.join(os.tmpdir(), `tmb-${run.arm.id}-${run.mode}-stage-${run.stage}-`));
  const previousTree = run.stage > 1 ? path.join(runDir(run, run.stage - 1), "tree") : null;
  await prepareTree({ arm: run.arm, stage: run.stage, mode: run.mode, previousTree, tree });
  return tree;
};

type AgentOutcome = {
  startedAt: string;
  endedAt: string;
  agentExitCode: number | null;
  agentDurationMs: number;
  agentTimedOut: boolean;
};

const executeAgent = async (run: StageRun, tree: string, outDir: string): Promise<AgentOutcome> => {
  const startedAt = new Date().toISOString();
  const { arm, stage, model, timeoutMs, budgetUsd } = run;
  const result = await runAgent(run.agent, { arm, stage, tree, logDir: outDir, model, timeoutMs, budgetUsd });
  writeFileSync(path.join(outDir, "agent.stderr.log"), result.output);
  const endedAt = new Date().toISOString();
  return {
    startedAt,
    endedAt,
    agentExitCode: result.exitCode,
    agentDurationMs: result.durationMs,
    agentTimedOut: result.timedOut,
  };
};

export type StageResult = { outDir: string; grade: Grade; escapes: EscapeCounts };

const recordOutcome = async (run: StageRun, tree: string, outDir: string): Promise<StageResult> => {
  await writeDiffSinceStart(tree, path.join(outDir, "diff.patch"));
  const grade = await gradeTree(run.arm, run.stage, tree);
  const escapes = countTreeEscapes(tree);
  writeJson(path.join(outDir, "grade.json"), grade);
  writeJson(path.join(outDir, "escapes.json"), escapes);
  copyTree(tree, path.join(outDir, "tree"));
  return { outDir, grade, escapes };
};

export const runStage = async (run: StageRun): Promise<StageResult> => {
  const outDir = claimOutputDir(run);
  const tree = await prepare(run);
  const outcome = await executeAgent(run, tree, outDir);
  const result = await recordOutcome(run, tree, outDir);
  const provenance = await collectProvenance(run.agent === "claude" ? ["claude", "--version"] : null);
  const { arm, ...settings } = run;
  writeJson(path.join(outDir, "meta.json"), {
    experiment: EXPERIMENT,
    arm: arm.id,
    ...settings,
    ...outcome,
    workTree: tree,
    ...provenance,
  });
  return result;
};
