import type { Arm } from "./arms.js";
import type { Commands } from "./caseRunner.js";

const TREE_PLACEHOLDER = "{tree}";

const inTree = (command: string[], tree: string): string[] =>
  command.map((part) => part.replaceAll(TREE_PLACEHOLDER, tree));

// The grader uses the arm's commands, not tests/*.json, which the agent could have edited.
export const loadCommandsFor = (arm: Arm, tree: string): Commands => ({
  cli: inTree(arm.command, tree),
  report: inTree(arm.reportCommand, tree),
});

export const loadLibraryFor = (arm: Arm, tree: string): string => arm.libraryEntry.replaceAll(TREE_PLACEHOLDER, tree);
