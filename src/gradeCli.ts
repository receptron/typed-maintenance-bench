import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ARMS, isArmId } from "./arms.js";
import { gradeTree } from "./grade.js";
import { copyTree, installDependencies } from "./tree.js";

const USAGE = "usage: yarn grade --tree <saved tree> --arm <js|ts|ts-noany> --stage <n>";

// Re-grades a saved tree from results/ on a fresh copy, so any grade can be recomputed.
const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: { tree: { type: "string" }, arm: { type: "string" }, stage: { type: "string" } },
  });
  if (values.tree === undefined || values.arm === undefined || !isArmId(values.arm) || values.stage === undefined) {
    throw new Error(USAGE);
  }
  const copy = mkdtempSync(path.join(os.tmpdir(), "tmb-regrade-"));
  copyTree(path.resolve(values.tree), copy);
  await installDependencies(copy);
  console.log(JSON.stringify(await gradeTree(ARMS[values.arm], Number(values.stage), copy), null, 2));
};

await main();
