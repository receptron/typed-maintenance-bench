import { execute } from "./exec.js";
import { REPO_ROOT } from "./paths.js";

const META_TIMEOUT_MS = 30_000;

const firstLine = async (command: string[]): Promise<string | null> => {
  const result = await execute(command, { cwd: REPO_ROOT, timeoutMs: META_TIMEOUT_MS });
  return result.exitCode === 0 ? (result.output.split("\n")[0] ?? "").trim() : null;
};

export type Provenance = {
  harnessCommit: string | null;
  harnessDirty: boolean;
  node: string;
  agentVersion: string | null;
};

// results/ is excluded because the run being recorded has just written its own output there.
const HARNESS_STATUS = ["git", "status", "--porcelain", "--", ".", ":(exclude)results"];

export const collectProvenance = async (agentVersionCommand: string[] | null): Promise<Provenance> => {
  const status = await execute(HARNESS_STATUS, { cwd: REPO_ROOT, timeoutMs: META_TIMEOUT_MS });
  return {
    harnessCommit: await firstLine(["git", "rev-parse", "HEAD"]),
    harnessDirty: status.output.trim() !== "",
    node: process.version,
    agentVersion: agentVersionCommand === null ? null : await firstLine(agentVersionCommand),
  };
};
