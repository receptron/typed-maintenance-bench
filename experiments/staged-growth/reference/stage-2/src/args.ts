import path from "node:path";
import { FatalError } from "./fatal.js";
import type { GroupBy } from "./aggregate.js";

export const FORMATS = ["csv", "json", "jsonl", "yaml", "xlsx"] as const;
export type Format = (typeof FORMATS)[number];
export type Options = { input: string; groupBy: GroupBy; format: Format };

const GROUP_BYS: readonly GroupBy[] = ["day", "sku", "customer"];
const EXTENSIONS: Record<string, Format> = {
  ".csv": "csv",
  ".json": "json",
  ".jsonl": "jsonl",
  ".ndjson": "jsonl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xlsx": "xlsx",
};
const OPTION_NAMES = ["--input", "--group-by", "--format"];

const isGroupBy = (value: string): value is GroupBy => GROUP_BYS.some((groupBy) => groupBy === value);
const isFormat = (value: string): value is Format => FORMATS.some((format) => format === value);

const readPairs = (argv: string[]): Map<string, string> => {
  const pairs = new Map<string, string>();
  const take = (index: number): void => {
    if (index >= argv.length) return;
    const [name = "", value] = [argv[index], argv[index + 1]];
    if (!OPTION_NAMES.includes(name)) throw new FatalError(`unknown option ${name}`);
    if (value === undefined) throw new FatalError(`${name} needs a value`);
    pairs.set(name, value);
    take(index + 2);
  };
  take(0);
  return pairs;
};

const formatFor = (input: string, explicit: string | undefined): Format => {
  if (explicit !== undefined) {
    if (!isFormat(explicit)) throw new FatalError(`unknown format ${explicit}`);
    return explicit;
  }
  const fromExtension = EXTENSIONS[path.extname(input).toLowerCase()];
  if (fromExtension === undefined) throw new FatalError(`cannot tell the format of ${input}; use --format`);
  return fromExtension;
};

export const parseOptions = (argv: string[]): Options => {
  const pairs = readPairs(argv);
  const input = pairs.get("--input");
  const groupBy = pairs.get("--group-by");
  if (input === undefined) throw new FatalError("--input is required");
  if (groupBy === undefined || !isGroupBy(groupBy)) throw new FatalError("--group-by must be day, sku or customer");
  return { input, groupBy, format: formatFor(input, pairs.get("--format")) };
};
