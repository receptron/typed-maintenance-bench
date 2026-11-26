import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { TRANSCRIPT_FILE } from "./agents.js";
import { isRecord } from "./cases.js";
import { DEFAULT_RESULTS_DIR, EXPERIMENT } from "./paths.js";
import { summaryTable, type StageRecord } from "./summary.js";

const USAGE = "usage: yarn summarize [--repeats r2,r3] [--results-dir <dir>]";

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${String(error)}`, { cause: error });
  }
};

const numberField = (value: unknown, field: string, file: string): number => {
  const found = isRecord(value) ? value[field] : undefined;
  if (typeof found !== "number") throw new Error(`${file}: ${field} is not a number`);
  return found;
};

const stageCounts = (gradeFile: string): { passed: number; total: number } => {
  const grade = readJson(gradeFile);
  const stages = isRecord(grade) && Array.isArray(grade["stages"]) ? grade["stages"] : [];
  if (stages.length === 0) throw new Error(`${gradeFile}: no stages`);
  const passed = stages.reduce((sum: number, stage: unknown) => sum + numberField(stage, "passed", gradeFile), 0);
  const total = stages.reduce((sum: number, stage: unknown) => sum + numberField(stage, "total", gradeFile), 0);
  return { passed, total };
};

const escapeTotal = (escapesFile: string): number => {
  const escapes = readJson(escapesFile);
  if (!isRecord(escapes)) throw new Error(`${escapesFile} is not an object`);
  return Object.keys(escapes).reduce((sum, key) => sum + numberField(escapes, key, escapesFile), 0);
};

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

// The last result message of the transcript carries Claude Code's own cost estimate.
const transcriptCost = (transcriptFile: string): number | null => {
  if (!existsSync(transcriptFile)) return null;
  const lastResult = readFileSync(transcriptFile, "utf8")
    .split("\n")
    .map(parseLine)
    .filter(isRecord)
    .filter((message) => message["type"] === "result")
    .at(-1);
  const cost = lastResult?.["total_cost_usd"];
  return typeof cost === "number" ? cost : null;
};

const loadRecord = (runDirectory: string, [arm, mode, repeat, stageName]: string[]): StageRecord => ({
  arm: arm ?? "",
  mode: mode ?? "",
  repeat: repeat ?? "",
  stage: Number(stageName?.replace("stage-", "")),
  ...stageCounts(path.join(runDirectory, "grade.json")),
  escapes: escapeTotal(path.join(runDirectory, "escapes.json")),
  durationMs: numberField(readJson(path.join(runDirectory, "meta.json")), "agentDurationMs", runDirectory),
  costUsd: transcriptCost(path.join(runDirectory, TRANSCRIPT_FILE)),
});

const subdirectories = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

// results/<experiment>/<arm>/<mode>/<repeat>/stage-<n>/
const runPaths = (directory: string, depth: number): string[][] =>
  depth === 0
    ? [[]]
    : subdirectories(directory).flatMap((name) =>
        runPaths(path.join(directory, name), depth - 1).map((rest) => [name, ...rest]),
      );

const RUN_DEPTH = 4;

const main = (): void => {
  const { values } = parseArgs({
    options: { repeats: { type: "string" }, "results-dir": { type: "string", default: DEFAULT_RESULTS_DIR } },
  });
  const experimentDir = path.join(values["results-dir"], EXPERIMENT);
  const wanted = values.repeats?.split(",") ?? null;
  const records = runPaths(experimentDir, RUN_DEPTH)
    .filter((parts) => wanted === null || wanted.includes(parts[2] ?? ""))
    .map((parts) => loadRecord(path.join(experimentDir, ...parts), parts));
  if (records.length === 0) throw new Error(`no runs found\n${USAGE}`);
  console.log(summaryTable(records));
};

main();
