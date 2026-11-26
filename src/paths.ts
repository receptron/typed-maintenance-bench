import path from "node:path";
import { fileURLToPath } from "node:url";

// Compiled to dist/src/, so the repository root is two levels up.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXPERIMENT = "staged-growth";
export const EXPERIMENT_DIR = path.join(REPO_ROOT, "experiments", EXPERIMENT);
export const DEFAULT_RESULTS_DIR = path.join(REPO_ROOT, "results");
export const RUNNER_BUILD_DIR = path.join(REPO_ROOT, "dist", "src");

export const stageDir = (stage: number): string => path.join(EXPERIMENT_DIR, `stage-${stage}`);
export const templateDir = (template: string): string => path.join(EXPERIMENT_DIR, "templates", template);
export const referenceDir = (stage: number): string => path.join(EXPERIMENT_DIR, "reference", `stage-${stage}`);
