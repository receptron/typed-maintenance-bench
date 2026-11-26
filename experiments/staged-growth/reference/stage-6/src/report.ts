import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatFor, requireTimeZone } from "./args.js";
import { FatalError } from "./fatal.js";
import { ReadError, aggregate, read } from "./index.js";
import { customerReports } from "./reportFile.js";

const FATAL_EXIT_CODE = 2;
const OPTION_NAMES = ["--input", "--out-dir", "--format", "--time-zone"];

const readPairs = (argv: string[]): Map<string, string> => {
  const pairs = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const [name = "", value] = [argv[index], argv[index + 1]];
    if (!OPTION_NAMES.includes(name)) throw new FatalError(`unknown option ${name}`);
    if (value === undefined) throw new FatalError(`${name} needs a value`);
    pairs.set(name, value);
  }
  return pairs;
};

const required = (pairs: Map<string, string>, name: string): string => {
  const value = pairs.get(name);
  if (value === undefined) throw new FatalError(`${name} is required`);
  return value;
};

const makeDir = (dir: string): void => {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new FatalError(`${dir}: cannot create the directory: ${String(error)}`);
  }
};

const run = async (): Promise<void> => {
  const pairs = readPairs(process.argv.slice(2));
  const [input, outDir] = [required(pairs, "--input"), required(pairs, "--out-dir")];
  const format = formatFor(input, pairs.get("--format"));
  const timeZone = requireTimeZone(pairs.get("--time-zone"));
  const { records, warnings } = await read({ path: input, format });
  warnings.forEach((warning) => process.stderr.write(`${warning.file}:${warning.location}: ${warning.reason}\n`));
  const reports = customerReports(aggregate(records, { groupBy: ["customer", "day"], timeZone }));
  makeDir(outDir);
  reports.forEach(({ fileName, content }) => writeFileSync(path.join(outDir, fileName), content));
};

try {
  await run();
} catch (error) {
  if (!(error instanceof FatalError) && !(error instanceof ReadError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = FATAL_EXIT_CODE;
}
