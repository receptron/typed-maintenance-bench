import { aggregate as aggregateLines, type Aggregate } from "./aggregate.js";
import { formatFor } from "./args.js";
import { FatalError } from "./fatal.js";
import { registerBuiltinFormats } from "./formats/builtin.js";
import { isFormat } from "./formats/registry.js";
import { TSV_PLUGIN } from "./formats/tsv.js";
import { readOrders } from "./orders.js";
import { groupByProblem, isGroupKey, rangeProblem, type Query } from "./query.js";
import type { OrderLine } from "./record.js";
import { registerFormat } from "./plugins.js";
import { OUTPUTS, render as renderResult, type Output } from "./render.js";

registerBuiltinFormats();
registerFormat(TSV_PLUGIN);

export { registerFormat };

export type { Aggregate, OrderLine, Output };
export type Warning = { file: string; location: string; reason: string };
export type ReadResult = { records: OrderLine[]; warnings: Warning[] };
export type Source = { path: string; format?: string };
export type Spec = { groupBy: string[]; from?: string; to?: string; skuPrefix?: string };

export class ReadError extends Error {
  override name = "ReadError";
}

const SOURCE_KEYS = ["path", "format"];
const SPEC_KEYS = ["groupBy", "from", "to", "skuPrefix"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireObject = (value: unknown, name: string, allowed: string[]): Record<string, unknown> => {
  if (!isObject(value)) throw new TypeError(`${name} must be an object`);
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined) throw new TypeError(`${name} has an unknown property ${extra}`);
  return value;
};

const optionalString = (value: unknown, name: string): string | null => {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
};

const sourceFormat = (path: string, format: string | null): string => {
  if (format !== null && !isFormat(format)) throw new TypeError(`unknown format ${format}`);
  try {
    return formatFor(path, format ?? undefined);
  } catch (error) {
    throw new TypeError(error instanceof Error ? error.message : String(error));
  }
};

const readValidated = async (path: string, format: string): Promise<ReadResult> => {
  try {
    const orders = await readOrders(path, format);
    return { records: orders.lines, warnings: orders.warnings.map((warning) => ({ file: path, ...warning })) };
  } catch (error) {
    if (error instanceof FatalError) throw new ReadError(error.message);
    throw error;
  }
};

export const read = async (source: unknown): Promise<ReadResult> => {
  const checked = requireObject(source, "source", SOURCE_KEYS);
  const path = checked["path"];
  if (typeof path !== "string") throw new TypeError("source.path must be a string");
  return readValidated(path, sourceFormat(path, optionalString(checked["format"], "source.format")));
};

const toQuery = (spec: Record<string, unknown>): Query => {
  const groupBy = spec["groupBy"];
  if (!Array.isArray(groupBy)) throw new TypeError("spec.groupBy must be an array");
  const problem = groupByProblem(groupBy);
  if (problem !== null) throw new TypeError(problem);
  const [from, to] = [optionalString(spec["from"], "spec.from"), optionalString(spec["to"], "spec.to")];
  const range = rangeProblem(from, to);
  if (range !== null) throw new TypeError(range);
  const skuPrefix = optionalString(spec["skuPrefix"], "spec.skuPrefix") ?? "";
  return { groupBy: groupBy.filter(isGroupKey), from, to, skuPrefix };
};

export const aggregate = (records: readonly OrderLine[], spec: unknown): Aggregate => {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  return aggregateLines(records, toQuery(requireObject(spec, "spec", SPEC_KEYS)));
};

const isOutput = (value: unknown): value is Output => OUTPUTS.some((output) => output === value);

export const render = (result: Aggregate, format: unknown): string => {
  if (!isOutput(format)) throw new TypeError(`format must be one of ${OUTPUTS.join(", ")}`);
  return renderResult(result, format);
};
