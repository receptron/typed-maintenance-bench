import type { Arm } from "./arms.js";

const TREE_PLACEHOLDER = "{tree}";

// The grader uses the arm's command, not tests/command.json, which the agent could have edited.
export const loadCommandFor = (arm: Arm, tree: string): string[] =>
  arm.command.map((part) => part.replaceAll(TREE_PLACEHOLDER, tree));
