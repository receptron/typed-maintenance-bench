import { aggregate } from "./aggregate.js";
import { parseOptions } from "./args.js";
import { FatalError } from "./fatal.js";
import { readOrders } from "./orders.js";
import { render } from "./render.js";

const FATAL_EXIT_CODE = 2;

const run = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const orders = await readOrders(options.input, options.format);
  orders.warnings.forEach((warning) =>
    process.stderr.write(`${options.input}:${warning.location}: ${warning.reason}\n`),
  );
  process.stdout.write(render(aggregate(orders.lines, options.query), options.output));
};

try {
  await run();
} catch (error) {
  if (!(error instanceof FatalError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = FATAL_EXIT_CODE;
}
