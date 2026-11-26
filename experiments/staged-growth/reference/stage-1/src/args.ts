import { FatalError } from "./fatal.js";
import type { GroupBy } from "./aggregate.js";

export type Options = { input: string; groupBy: GroupBy };

const GROUP_BYS: readonly GroupBy[] = ["day", "sku", "customer"];
const OPTION_NAMES = ["--input", "--group-by"];

const isGroupBy = (value: string): value is GroupBy => GROUP_BYS.some((groupBy) => groupBy === value);

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

export const parseOptions = (argv: string[]): Options => {
  const pairs = readPairs(argv);
  const input = pairs.get("--input");
  const groupBy = pairs.get("--group-by");
  if (input === undefined) throw new FatalError("--input is required");
  if (groupBy === undefined || !isGroupBy(groupBy)) throw new FatalError("--group-by must be day, sku or customer");
  return { input, groupBy };
};
