import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Arm } from "./arms.js";
import { REPORT_COMMAND_FILE } from "./caseRunner.js";
import { execute, type ExecResult } from "./exec.js";
import { REPO_ROOT, RUNNER_BUILD_DIR, referenceDir, stageDir, templateDir } from "./paths.js";

export type Mode = "cumulative" | "reset";

const SNAPSHOT_EXCLUDES = new Set(["node_modules", "dist", ".git"]);
const RUNNER_FILES = ["cases.js", "caseRunner.js", "apiCases.js", "apiPlugins.js", "apiRunner.js", "apiWorker.js"];
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

const mergeDependencies = (tree: string, reference: string): void => {
  const treePackage = readJsonObject(path.join(tree, "package.json"));
  const referencePackage = readJsonObject(path.join(reference, "package.json"));
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

// reference is a directory holding package.json, tsconfig.json and src/; it must be inside the repository,
// so that compiling it finds the repository's type packages.
export const placeReferenceFrom = async (arm: Arm, reference: string, tree: string): Promise<void> => {
  rmSync(path.join(tree, "src"), { recursive: true, force: true });
  mergeDependencies(tree, reference);
  if (arm.language === "ts") return copyTree(path.join(reference, "src"), path.join(tree, "src"));
  const tsc = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
  const compile = ["node", tsc, "-p", reference, "--outDir", path.join(tree, "src")];
  requireSuccess(
    await execute(compile, { cwd: REPO_ROOT, timeoutMs: COMPILE_TIMEOUT_MS }),
    "compiling the reference to JS",
  );
};

export const placeReference = (arm: Arm, stage: number, tree: string): Promise<void> =>
  placeReferenceFrom(arm, referenceDir(stage), tree);

const installTests = (arm: Arm, stage: number, tree: string): void => {
  const testsDir = path.join(tree, "tests");
  rmSync(testsDir, { recursive: true, force: true });
  const visible = path.join(stageDir(stage), "visible-tests");
  if (existsSync(visible)) cpSync(visible, path.join(testsDir, "visible"), { recursive: true });
  mkdirSync(path.join(testsDir, "runner"), { recursive: true });
  RUNNER_FILES.forEach((file) => cpSync(path.join(RUNNER_BUILD_DIR, file), path.join(testsDir, "runner", file)));
  writeFileSync(path.join(testsDir, "runner", "package.json"), '{ "type": "module" }\n');
  writeFileSync(path.join(testsDir, "command.json"), `${JSON.stringify(arm.command)}\n`);
  writeFileSync(path.join(testsDir, REPORT_COMMAND_FILE), `${JSON.stringify(arm.reportCommand)}\n`);
  writeFileSync(path.join(testsDir, "library.json"), `${JSON.stringify(arm.libraryEntry)}\n`);
};

export const fillPlaceholders = (arm: Arm, text: string): string =>
  text
    .replaceAll("{{RUN}}", arm.taskRun)
    .replaceAll("{{REPORT}}", arm.taskReport)
    .replaceAll("{{ARM_NOTES}}", arm.notes)
    .replaceAll("{{LIB}}", arm.taskLibrary);

export const renderTask = (arm: Arm, stage: number): string =>
  fillPlaceholders(arm, readFileSync(path.join(stageDir(stage), "task.md"), "utf8"));

// Files a bug report refers to, copied to the tree root.
const ATTACHMENTS = "attachments";

const installAttachments = (stage: number, tree: string): void => {
  const source = path.join(stageDir(stage), ATTACHMENTS);
  rmSync(path.join(tree, ATTACHMENTS), { recursive: true, force: true });
  if (existsSync(source)) cpSync(source, path.join(tree, ATTACHMENTS), { recursive: true });
};

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

// The earlier tasks, as the documentation a maintainer would have: the stage lists them in docs.json.
const DOCS_FILE = "docs.json";
const REQUESTS_DIR = path.join("docs", "requests");
const TESTS_SECTION = /\n## Tests\n[\s\S]*$/;

const requestStages = (stage: number): number[] => {
  const file = path.join(stageDir(stage), DOCS_FILE);
  if (!existsSync(file)) return [];
  const requests = readJsonObject(file).requests;
  if (!Array.isArray(requests) || !requests.every((item) => typeof item === "number"))
    throw new Error(`${file} must hold { "requests": [stage numbers] }`);
  return requests;
};

const installDocs = (arm: Arm, stage: number, tree: string): void => {
  const target = path.join(tree, REQUESTS_DIR);
  rmSync(target, { recursive: true, force: true });
  requestStages(stage).forEach((earlier) => {
    mkdirSync(target, { recursive: true });
    const text = `${renderTask(arm, earlier).replace(TESTS_SECTION, "").trimEnd()}\n`;
    writeFileSync(path.join(target, `stage-${earlier}.md`), text);
  });
};

export const prepareTree = async (options: PrepareOptions): Promise<void> => {
  await placeBase(options);
  installTests(options.arm, options.stage, options.tree);
  installAttachments(options.stage, options.tree);
  installDocs(options.arm, options.stage, options.tree);
  writeFileSync(path.join(options.tree, "TASK.md"), renderTask(options.arm, options.stage));
  await installDependencies(options.tree);
};

// The agent's history starts here: nothing done to the tree before this commit shows in it.
export const commitStart = async (tree: string): Promise<void> => {
  requireSuccess(await git(tree, ["init", "-q"]), "git init");
  requireSuccess(await git(tree, ["add", "-A"]), "git add");
  requireSuccess(await git(tree, ["commit", "-q", "-m", "start", "--allow-empty"]), "git commit");
  requireSuccess(await git(tree, ["tag", START_TAG]), "git tag");
};

export const writeDiffSinceStart = async (tree: string, file: string): Promise<void> => {
  await git(tree, ["add", "-A"]);
  const diff = ["git", ...GIT_IDENTITY, "diff", "--cached", START_TAG];
  requireSuccess(await execute(diff, { cwd: tree, timeoutMs: COMPILE_TIMEOUT_MS, stdoutFile: file }), "git diff");
};
