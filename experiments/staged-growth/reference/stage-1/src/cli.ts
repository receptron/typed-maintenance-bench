import { aggregate, render } from "./aggregate.js";
import { parseOptions } from "./args.js";
import { FatalError } from "./fatal.js";
import { readRecords } from "./source.js";

const FATAL_EXIT_CODE = 2;

const run = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const records = await readRecords(options);
  const { totals, warnings } = aggregate(records, options.groupBy, options.input);
  warnings.forEach((warning) => process.stderr.write(`${warning}\n`));
  process.stdout.write(render(totals, options.groupBy));
};

try {
  await run();
} catch (error) {
  if (!(error instanceof FatalError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = FATAL_EXIT_CODE;
}
