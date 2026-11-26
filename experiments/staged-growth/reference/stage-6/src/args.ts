import path from "node:path";
import { FatalError } from "./fatal.js";
import { formatOfExtension, isFormat } from "./formats/registry.js";
import { groupByProblem, isGroupKey, rangeProblem, type GroupKey, type Query } from "./query.js";
import { OUTPUTS, type Output } from "./render.js";
import { readConfig, type Settings } from "./settings.js";
import { DEFAULT_TIME_ZONE, isTimeZone } from "./time.js";

export type Options = { input: string; format: string; output: Output; query: Query };

const FLAG_SETTINGS: Record<string, keyof Settings> = {
  "--format": "format",
  "--output": "output",
  "--from": "from",
  "--to": "to",
  "--sku-prefix": "skuPrefix",
  "--time-zone": "timeZone",
};
const OPTION_NAMES = ["--input", "--group-by", "--config", ...Object.keys(FLAG_SETTINGS)];

const isOutput = (value: string): value is Output => OUTPUTS.some((output) => output === value);

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

const flagSettings = (pairs: Map<string, string>): Settings => {
  const groupBy = pairs.get("--group-by");
  const fromFlags = Object.entries(FLAG_SETTINGS).flatMap(([flag, name]) => {
    const value = pairs.get(flag);
    return value === undefined ? [] : [[name, value]];
  });
  return { ...Object.fromEntries(fromFlags), ...(groupBy === undefined ? {} : { groupBy: groupBy.split(",") }) };
};

export const formatFor = (input: string, explicit: string | undefined): string => {
  if (explicit !== undefined) {
    if (!isFormat(explicit)) throw new FatalError(`unknown format ${explicit}`);
    return explicit;
  }
  const fromExtension = formatOfExtension(path.extname(input).toLowerCase());
  if (fromExtension === undefined) throw new FatalError(`cannot tell the format of ${input}; use --format`);
  return fromExtension;
};

const requireGroupBy = (keys: string[] | undefined): GroupKey[] => {
  if (keys === undefined) throw new FatalError("--group-by is required");
  const problem = groupByProblem(keys);
  if (problem !== null) throw new FatalError(problem);
  return keys.filter(isGroupKey);
};

const requireOutput = (output: string | undefined): Output => {
  if (output === undefined) return "text";
  if (!isOutput(output)) throw new FatalError(`unknown output ${output}`);
  return output;
};

export const requireTimeZone = (timeZone: string | undefined): string => {
  if (timeZone === undefined) return DEFAULT_TIME_ZONE;
  if (!isTimeZone(timeZone)) throw new FatalError(`unknown time zone ${timeZone}`);
  return timeZone;
};

const toQuery = (settings: Settings): Query => {
  const [from, to] = [settings.from ?? null, settings.to ?? null];
  const problem = rangeProblem(from, to);
  if (problem !== null) throw new FatalError(problem);
  const timeZone = requireTimeZone(settings.timeZone);
  return { groupBy: requireGroupBy(settings.groupBy), from, to, skuPrefix: settings.skuPrefix ?? "", timeZone };
};

// A config file is checked on its own, so an invalid value there is fatal even when a flag overrides it.
const checkedConfig = (file: string | undefined, input: string): Settings => {
  if (file === undefined) return {};
  const config = readConfig(file);
  if (config.groupBy !== undefined) requireGroupBy(config.groupBy);
  if (config.format !== undefined) formatFor(input, config.format);
  requireOutput(config.output);
  requireTimeZone(config.timeZone);
  const problem = rangeProblem(config.from ?? null, config.to ?? null);
  if (problem !== null) throw new FatalError(`${file}: ${problem}`);
  return config;
};

export const parseOptions = (argv: string[]): Options => {
  const pairs = readPairs(argv);
  const input = pairs.get("--input");
  if (input === undefined) throw new FatalError("--input is required");
  const settings = { ...checkedConfig(pairs.get("--config"), input), ...flagSettings(pairs) };
  const query = toQuery(settings);
  return { input, format: formatFor(input, settings.format), output: requireOutput(settings.output), query };
};
