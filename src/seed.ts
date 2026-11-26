import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent } from "./agents.js";
import type { Arm } from "./arms.js";
import { isRecord } from "./cases.js";
import { countTreeEscapes, type EscapeCounts } from "./escapes.js";
import { execute } from "./exec.js";
import { gradeTree, type Grade } from "./grade.js";
import { REPO_ROOT, referenceDir, stageDir } from "./paths.js";
import type { StageRun } from "./runStage.js";
import { copyTree, fillPlaceholders, placeReferenceFrom } from "./tree.js";

// Stage 7 starts from a tree with bugs in it; the maintainer's session must find and fix them.
export const SEED_STAGE = 7;
const BUGS_FILE = "bugs.json";
const PLANT_PROMPT_FILE = "plant.md";
const SEED_TRANSCRIPT = "seed-agent.jsonl";
const DIFF_TIMEOUT_MS = 60_000;

type Replacement = { file: string; from: string; to: string };
export type Bug = { id: string; plant: string; replacements: Replacement[] };
export type PlantedBy = "replacements" | "agent" | null;
export type BugSeed = { id: string; native: boolean; planted: boolean; failingAfter: string[] };
export type SeedReport = {
  plantedBy: PlantedBy;
  bugs: BugSeed[];
  collateral: string[];
  buildExitCode: number | null;
  verifyExitCode: number | null;
  escapesBefore: EscapeCounts;
  escapesAfter: EscapeCounts;
};

const isReplacement = (value: unknown): value is Replacement =>
  isRecord(value) && typeof value.file === "string" && typeof value.from === "string" && typeof value.to === "string";

const isBug = (value: unknown): value is Bug =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.plant === "string" &&
  Array.isArray(value.replacements) &&
  value.replacements.every(isReplacement);

export const loadBugs = (): Bug[] => {
  const file = path.join(stageDir(SEED_STAGE), BUGS_FILE);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.bugs) || !parsed.bugs.every(isBug))
    throw new Error(`${file} must hold { "bugs": [{ id, plant, replacements }] }`);
  return parsed.bugs;
};

// A bug's cases are the stage 7 cases whose id starts with s7-<bug id>-.
export const failingCasesOf = (grade: Grade, bug: Bug): string[] =>
  (grade.stages.find((stageGrade) => stageGrade.stage === SEED_STAGE)?.failed ?? [])
    .map((failure) => failure.id)
    .filter((id) => id.startsWith(`s${SEED_STAGE}-${bug.id}-`));

const failingBefore = (grade: Grade): string[] =>
  grade.stages
    .filter((stageGrade) => stageGrade.stage < SEED_STAGE)
    .flatMap((stageGrade) => stageGrade.failed.map((failure) => failure.id));

export const applyReplacements = (srcDir: string, bugs: Bug[]): void =>
  bugs.forEach((bug) =>
    bug.replacements.forEach(({ file, from, to }) => {
      const target = path.join(srcDir, file);
      const source = readFileSync(target, "utf8");
      if (!source.includes(from)) throw new Error(`bug ${bug.id}: the text to replace is not in ${file}`);
      writeFileSync(target, source.replace(from, to));
    }),
  );

const plantByReplacements = async (arm: Arm, tree: string, bugs: Bug[]): Promise<void> => {
  const work = mkdtempSync(path.join(REPO_ROOT, "dist", "seeded-"));
  try {
    copyTree(referenceDir(SEED_STAGE), work);
    applyReplacements(path.join(work, "src"), bugs);
    await placeReferenceFrom(arm, work, tree);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

export const renderPlantPrompt = (arm: Arm, bugs: Bug[]): string =>
  fillPlaceholders(arm, readFileSync(path.join(stageDir(SEED_STAGE), PLANT_PROMPT_FILE), "utf8")).replaceAll(
    "{{BUGS}}",
    bugs.map((bug) => `- ${bug.plant}`).join("\n"),
  );

const plantByAgent = async (run: StageRun, tree: string, outDir: string, bugs: Bug[]): Promise<void> => {
  const { arm, model, timeoutMs, budgetUsd, auth } = run;
  const prompt = renderPlantPrompt(arm, bugs);
  const options = { arm, stage: SEED_STAGE, tree, logDir: outDir, model, timeoutMs, budgetUsd, auth };
  const result = await runAgent("claude", { ...options, prompt, transcriptFile: SEED_TRANSCRIPT });
  writeFileSync(path.join(outDir, "seed-agent.stderr.log"), result.output);
};

// Reset mode and the reference agent start from the reference, so fixed replacements plant the bugs;
// an arm's own tree differs per run, so in cumulative mode another session plants them from their descriptions.
const plantedByFor = (run: StageRun, toPlant: Bug[]): PlantedBy => {
  if (toPlant.length === 0) return null;
  return run.mode === "reset" || run.agent === "reference" ? "replacements" : "agent";
};

const plant = async (run: StageRun, tree: string, outDir: string, toPlant: Bug[]): Promise<PlantedBy> => {
  const plantedBy = plantedByFor(run, toPlant);
  if (plantedBy === "replacements") await plantByReplacements(run.arm, tree, toPlant);
  if (plantedBy === "agent") await plantByAgent(run, tree, outDir, toPlant);
  return plantedBy;
};

const writeSeedDiff = async (before: string, tree: string, file: string): Promise<void> => {
  const after = mkdtempSync(path.join(os.tmpdir(), "tmb-seed-after-"));
  try {
    copyTree(tree, after);
    const diff = ["git", "diff", "--no-index", "--", before, after];
    await execute(diff, { cwd: os.tmpdir(), timeoutMs: DIFF_TIMEOUT_MS, stdoutFile: file });
  } finally {
    rmSync(after, { recursive: true, force: true });
  }
};

type Snapshot = { grade: Grade; escapes: EscapeCounts; copy: string };

const snapshot = async (arm: Arm, tree: string): Promise<Snapshot> => {
  const copy = mkdtempSync(path.join(os.tmpdir(), "tmb-seed-before-"));
  copyTree(tree, copy);
  return { grade: await gradeTree(arm, SEED_STAGE, tree), escapes: countTreeEscapes(tree), copy };
};

const bugSeed = (bug: Bug, toPlant: Bug[], after: Grade): BugSeed => ({
  id: bug.id,
  native: !toPlant.includes(bug),
  planted: toPlant.includes(bug),
  failingAfter: failingCasesOf(after, bug),
});

const reportOf = (
  bugs: Bug[],
  toPlant: Bug[],
  before: Snapshot,
  after: Grade,
  tree: string,
): Omit<SeedReport, "plantedBy"> => {
  const earlierFailures = new Set(failingBefore(before.grade));
  return {
    bugs: bugs.map((bug) => bugSeed(bug, toPlant, after)),
    collateral: failingBefore(after).filter((id) => !earlierFailures.has(id)),
    buildExitCode: after.build?.exitCode ?? null,
    verifyExitCode: after.verify?.exitCode ?? null,
    escapesBefore: before.escapes,
    escapesAfter: countTreeEscapes(tree),
  };
};

// Plants every bug whose cases all pass in the tree; a bug the tree already has is left as it is.
export const seedBugs = async (run: StageRun, tree: string, outDir: string): Promise<SeedReport> => {
  const bugs = loadBugs();
  const before = await snapshot(run.arm, tree);
  try {
    const toPlant = bugs.filter((bug) => failingCasesOf(before.grade, bug).length === 0);
    const plantedBy = await plant(run, tree, outDir, toPlant);
    await writeSeedDiff(before.copy, tree, path.join(outDir, "seed.patch"));
    const report = { plantedBy, ...reportOf(bugs, toPlant, before, await gradeTree(run.arm, SEED_STAGE, tree), tree) };
    writeFileSync(path.join(outDir, "seed.json"), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    rmSync(before.copy, { recursive: true, force: true });
  }
};
