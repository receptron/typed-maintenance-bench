import path from "node:path";
import type { Arm } from "./arms.js";
import { execute, type ExecResult } from "./exec.js";
import { installDependencies, placeReference } from "./tree.js";

export type AgentId = "claude" | "reference";
export const AGENT_IDS: readonly AgentId[] = ["claude", "reference"];
export const isAgentId = (value: string): value is AgentId => AGENT_IDS.some((agent) => agent === value);

export type AgentOptions = {
  arm: Arm;
  stage: number;
  tree: string;
  logDir: string;
  model: string;
  timeoutMs: number;
  budgetUsd: number;
};

export const AGENT_PROMPT =
  "Read TASK.md in the current directory and complete the task it describes. Work only inside this directory.";
export const TRANSCRIPT_FILE = "agent.jsonl";

// --bare skips the host's CLAUDE.md, hooks, plugins and memory, so a run does not depend on whose machine it is on.
export const claudeCommand = (options: AgentOptions): string[] => [
  "claude",
  AGENT_PROMPT,
  "--bare",
  "--print",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  options.model,
  "--max-budget-usd",
  String(options.budgetUsd),
  "--permission-mode",
  "acceptEdits",
  "--allowedTools",
  "Bash,Edit,Write,Read,Glob,Grep",
  "--disallowedTools",
  "WebFetch,WebSearch",
];

const runReference = async (options: AgentOptions): Promise<ExecResult> => {
  const startedAt = Date.now();
  await placeReference(options.arm, options.stage, options.tree);
  await installDependencies(options.tree);
  return { exitCode: 0, output: "", durationMs: Date.now() - startedAt, timedOut: false };
};

export const runAgent = (agent: AgentId, options: AgentOptions): Promise<ExecResult> => {
  if (agent === "reference") return runReference(options);
  const stdoutFile = path.join(options.logDir, TRANSCRIPT_FILE);
  return execute(claudeCommand(options), { cwd: options.tree, timeoutMs: options.timeoutMs, stdoutFile });
};
