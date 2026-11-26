import { parseArgs } from "node:util";
import { isAgentId, isAuthMode, type AuthMode } from "./agents.js";
import { ARMS, isArmId } from "./arms.js";
import { DEFAULT_RESULTS_DIR } from "./paths.js";
import { runStage, type StageRun } from "./runStage.js";
import { MAX_STAGE, parseStageRange } from "./stages.js";
import type { Mode } from "./tree.js";

const DEFAULT_TIMEOUT_MIN = 60;
const MS_PER_MIN = 60_000;
const USAGE = `usage: yarn bench --arm <js|ts|ts-noany> --mode <cumulative|reset> --repeat <id>
  [--stages 1-${MAX_STAGE}] [--agent claude|reference] [--model <id>] [--timeout-min <n>] [--budget-usd <n>]
  [--auth api-key|subscription] [--results-dir <dir>]`;

const OPTIONS = {
  arm: { type: "string" },
  mode: { type: "string" },
  repeat: { type: "string" },
  stages: { type: "string", default: `1-${MAX_STAGE}` },
  agent: { type: "string", default: "claude" },
  model: { type: "string", default: "claude-sonnet-5-5" },
  "timeout-min": { type: "string", default: String(DEFAULT_TIMEOUT_MIN) },
  "budget-usd": { type: "string", default: "10" },
  auth: { type: "string", default: "api-key" },
  "results-dir": { type: "string", default: DEFAULT_RESULTS_DIR },
} as const;

const isMode = (value: string): value is Mode => value === "cumulative" || value === "reset";

const requireValid = <T extends string>(
  value: string | undefined,
  guard: (inner: string) => inner is T,
  name: string,
): T => {
  if (value === undefined || !guard(value)) throw new Error(`invalid --${name}\n${USAGE}`);
  return value;
};

const isPresent = (value: string): value is string => value.length > 0;

// Claude Code prefers ANTHROPIC_API_KEY when it is set, so a run labelled "subscription" would silently bill the key.
const checkAuth = (auth: AuthMode): AuthMode => {
  if (auth === "subscription" && process.env["ANTHROPIC_API_KEY"] !== undefined)
    throw new Error("--auth subscription needs ANTHROPIC_API_KEY to be unset");
  return auth;
};

const toRun = (
  values: ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>["values"],
): Omit<StageRun, "stage"> => ({
  arm: ARMS[requireValid(values.arm, isArmId, "arm")],
  mode: requireValid(values.mode, isMode, "mode"),
  repeat: requireValid(values.repeat, isPresent, "repeat"),
  agent: requireValid(values.agent, isAgentId, "agent"),
  model: values.model,
  timeoutMs: Number(values["timeout-min"]) * MS_PER_MIN,
  budgetUsd: Number(values["budget-usd"]),
  auth: checkAuth(requireValid(values.auth, isAuthMode, "auth")),
  resultsDir: values["results-dir"],
});

const main = async (): Promise<void> => {
  const { values } = parseArgs({ options: OPTIONS });
  const run = toRun(values);
  // Stages run in order because a cumulative stage starts from the previous stage's tree.
  for (const stage of parseStageRange(values.stages)) {
    console.log(
      `${run.arm.id} ${run.mode} ${run.repeat} stage ${stage}: ${(await runStage({ ...run, stage })).outDir}`,
    );
  }
};

await main();
