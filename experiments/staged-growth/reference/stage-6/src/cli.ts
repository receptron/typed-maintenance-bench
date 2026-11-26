import { parseOptions } from "./args.js";
import { FatalError } from "./fatal.js";
import { ReadError, aggregate, read, render, type Spec } from "./index.js";
import type { Query } from "./query.js";

const FATAL_EXIT_CODE = 2;

const toSpec = (query: Query): Spec => ({
  groupBy: query.groupBy,
  skuPrefix: query.skuPrefix,
  timeZone: query.timeZone,
  ...(query.from === null ? {} : { from: query.from }),
  ...(query.to === null ? {} : { to: query.to }),
});

const run = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const { records, warnings } = await read({ path: options.input, format: options.format });
  warnings.forEach((warning) => process.stderr.write(`${warning.file}:${warning.location}: ${warning.reason}\n`));
  process.stdout.write(render(aggregate(records, toSpec(options.query)), options.output));
};

try {
  await run();
} catch (error) {
  if (!(error instanceof FatalError) && !(error instanceof ReadError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = FATAL_EXIT_CODE;
}
