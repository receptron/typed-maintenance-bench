import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Arm } from "./arms.js";
import { execute, type ExecResult } from "./exec.js";
import { REPO_ROOT, RUNNER_BUILD_DIR, referenceDir, stageDir, templateDir } from "./paths.js";

export type Mode = "cumulative" | "reset";

const SNAPSHOT_EXCLUDES = new Set(["node_modules", "dist", ".git"]);
const RUNNER_FILES = ["cases.js", "caseRunner.js", "apiCases.js", "apiRunner.js", "apiWorker.js"];
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const COMPILE_TIMEOUT_MS = 5 * 60 * 1000;
const GIT_IDENTITY = ["-c", "user.name=bench", "-c", "user.email=bench@localhost"];
export const START_TAG = "bench-start";

export const copyTree = (from: string, to: string): void => {
  cpSync(from, to, { recursive: true, filter: (source) => !SNAPSHOT_EXCLUDES.has(path.basename(source)) });
};

const readJsonObject = (file: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${file} is not an object`);
  return Object.fromEntries(Object.entries(parsed));
};

const mergeDependencies = (tree: string, stage: number): void => {
  const treePackage = readJsonObject(path.join(tree, "package.json"));
  const referencePackage = readJsonObject(path.join(referenceDir(stage), "package.json"));
  const merged = { ...readDependencies(treePackage), ...readDependencies(referencePackage) };
  writeFileSync(
    path.join(tree, "package.json"),
    `${JSON.stringify({ ...treePackage, dependencies: merged }, null, 2)}\n`,
  );
};

const readDependencies = (packageJson: Record<string, unknown>): Record<string, unknown> => {
  const dependencies = packageJson.dependencies;
  return typeof dependencies === "object" && dependencies !== null
    ? Object.fromEntries(Object.entries(dependencies))
    : {};
};

const requireSuccess = (result: ExecResult, what: string): void => {
  if (result.exitCode !== 0) throw new Error(`${what} failed (exit ${result.exitCode}):\n${result.output}`);
};

export const placeReference = async (arm: Arm, stage: number, tree: string): Promise<void> => {
  const source = path.join(referenceDir(stage), "src");
  rmSync(path.join(tree, "src"), { recursive: true, force: true });
  mergeDependencies(tree, stage);
  if (arm.language === "ts") return copyTree(source, path.join(tree, "src"));
  const tsc = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
  const compile = ["node", tsc, "-p", referenceDir(stage), "--outDir", path.join(tree, "src")];
  requireSuccess(
    await execute(compile, { cwd: REPO_ROOT, timeoutMs: COMPILE_TIMEOUT_MS }),
    "compiling the reference to JS",
  );
};

const installTests = (arm: Arm, stage: number, tree: string): void => {
  const testsDir = path.join(tree, "tests");
  rmSync(testsDir, { recursive: true, force: true });
  cpSync(path.join(stageDir(stage), "visible-tests"), path.join(testsDir, "visible"), { recursive: true });
  mkdirSync(path.join(testsDir, "runner"), { recursive: true });
  RUNNER_FILES.forEach((file) => cpSync(path.join(RUNNER_BUILD_DIR, file), path.join(testsDir, "runner", file)));
  writeFileSync(path.join(testsDir, "runner", "package.json"), '{ "type": "module" }\n');
  writeFileSync(path.join(testsDir, "command.json"), `${JSON.stringify(arm.command)}\n`);
  writeFileSync(path.join(testsDir, "library.json"), `${JSON.stringify(arm.libraryEntry)}\n`);
};

export const renderTask = (arm: Arm, stage: number): string =>
  readFileSync(path.join(stageDir(stage), "task.md"), "utf8")
    .replaceAll("{{RUN}}", arm.taskRun)
    .replaceAll("{{ARM_NOTES}}", arm.notes)
    .replaceAll("{{LIB}}", arm.taskLibrary);

export type PrepareOptions = { arm: Arm; stage: number; mode: Mode; previousTree: string | null; tree: string };

const placeBase = async ({ arm, stage, mode, previousTree, tree }: PrepareOptions): Promise<void> => {
  if (mode === "cumulative" && stage > 1) {
    if (previousTree === null || !existsSync(previousTree))
      throw new Error(`stage ${stage - 1} tree not found: ${previousTree}`);
    return copyTree(previousTree, tree);
  }
  copyTree(templateDir(arm.template), tree);
  if (mode === "reset" && stage > 1) await placeReference(arm, stage - 1, tree);
};

const git = (tree: string, args: string[]): Promise<ExecResult> =>
  execute(["git", ...GIT_IDENTITY, ...args], { cwd: tree, timeoutMs: COMPILE_TIMEOUT_MS });

export const installDependencies = async (tree: string): Promise<void> => {
  const install = ["yarn", "install", "--silent", "--non-interactive"];
  requireSuccess(await execute(install, { cwd: tree, timeoutMs: INSTALL_TIMEOUT_MS }), `yarn install in ${tree}`);
};

export const prepareTree = async (options: PrepareOptions): Promise<void> => {
  await placeBase(options);
  installTests(options.arm, options.stage, options.tree);
  writeFileSync(path.join(options.tree, "TASK.md"), renderTask(options.arm, options.stage));
  await installDependencies(options.tree);
  requireSuccess(await git(options.tree, ["init", "-q"]), "git init");
  requireSuccess(await git(options.tree, ["add", "-A"]), "git add");
  requireSuccess(await git(options.tree, ["commit", "-q", "-m", "start", "--allow-empty"]), "git commit");
  requireSuccess(await git(options.tree, ["tag", START_TAG]), "git tag");
};

export const writeDiffSinceStart = async (tree: string, file: string): Promise<void> => {
  await git(tree, ["add", "-A"]);
  const diff = ["git", ...GIT_IDENTITY, "diff", "--cached", START_TAG];
  requireSuccess(await execute(diff, { cwd: tree, timeoutMs: COMPILE_TIMEOUT_MS, stdoutFile: file }), "git diff");
};
