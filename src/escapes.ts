import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type EscapeCounts = {
  anyKeyword: number;
  asAssertion: number;
  angleAssertion: number;
  nonNullAssertion: number;
  tsIgnore: number;
  tsExpectError: number;
  tsNocheck: number;
  eslintDisable: number;
};

const DIRECTIVES: [keyof EscapeCounts, RegExp][] = [
  ["tsIgnore", /@ts-ignore\b/g],
  ["tsExpectError", /@ts-expect-error\b/g],
  ["tsNocheck", /@ts-nocheck\b/g],
  ["eslintDisable", /eslint-disable/g],
];
const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git", "tests"]);

export const emptyCounts = (): EscapeCounts => ({
  anyKeyword: 0,
  asAssertion: 0,
  angleAssertion: 0,
  nonNullAssertion: 0,
  tsIgnore: 0,
  tsExpectError: 0,
  tsNocheck: 0,
  eslintDisable: 0,
});

const isConstAssertion = (node: ts.AsExpression): boolean =>
  ts.isTypeReferenceNode(node.type) && node.type.typeName.getText() === "const";

const nodeCategory = (node: ts.Node): keyof EscapeCounts | null => {
  if (node.kind === ts.SyntaxKind.AnyKeyword) return "anyKeyword";
  if (ts.isAsExpression(node)) return isConstAssertion(node) ? null : "asAssertion";
  if (ts.isTypeAssertionExpression(node)) return "angleAssertion";
  return ts.isNonNullExpression(node) ? "nonNullAssertion" : null;
};

const COMMENT_KINDS = new Set([ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia]);

const commentText = (source: ts.SourceFile): string => {
  const comments: string[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, source.languageVariant, source.text);
  // A loop, not recursion: one call per token would overflow the stack on large files.
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (COMMENT_KINDS.has(kind)) comments.push(scanner.getTokenText());
  }
  return comments.join("\n");
};

export const countEscapes = (text: string, fileName: string): EscapeCounts => {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const counts = emptyCounts();
  const visit = (node: ts.Node): void => {
    const category = nodeCategory(node);
    if (category !== null) counts[category] += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const comments = commentText(source);
  DIRECTIVES.forEach(([category, pattern]) => (counts[category] += comments.match(pattern)?.length ?? 0));
  return counts;
};

export const addCounts = (left: EscapeCounts, right: EscapeCounts): EscapeCounts => {
  const sum = emptyCounts();
  Object.keys(sum)
    .filter(isCountKey)
    .forEach((key) => (sum[key] = left[key] + right[key]));
  return sum;
};

const isCountKey = (key: string): key is keyof EscapeCounts => Object.keys(emptyCounts()).includes(key);

export const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

export const countTreeEscapes = (tree: string): EscapeCounts =>
  sourceFiles(tree)
    .filter((file) => !path.basename(file).startsWith("eslint.config"))
    .map((file) => countEscapes(readFileSync(file, "utf8"), file))
    .reduce(addCounts, emptyCounts());
