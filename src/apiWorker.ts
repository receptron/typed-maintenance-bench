// Runs one API case in its own process and prints what happened as JSON.
// Shipped into the agent's tree with the API runner, so it may import only Node built-ins.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { UNDEFINED_MARKER, isApiCase, type ApiCase, type ApiObservation } from "./apiCases.js";
import { isRecord } from "./cases.js";

type Library = Record<string, unknown>;

const callable = (library: Library, name: string): ((...args: unknown[]) => unknown) => {
  const member = library[name];
  if (typeof member !== "function") throw new Error(`the library does not export a function named ${name}`);
  return (...args: unknown[]) => Reflect.apply(member, undefined, args);
};

const recordsOf = (value: unknown): unknown => (isRecord(value) ? value.records : undefined);

// recordsFrom stands in for the first argument of aggregate: the records read from that source.
const resolveArgs = async (library: Library, testCase: ApiCase): Promise<unknown[]> => {
  if (testCase.recordsFrom === undefined) return testCase.args;
  const records = recordsOf(await callable(library, "read")(testCase.recordsFrom));
  return [records, ...testCase.args];
};

const invoke = async (library: Library, call: ApiCase["call"], args: unknown[]): Promise<unknown> => {
  if (call !== "pipeline") return await callable(library, call)(...args);
  const [source, spec, format] = args;
  const read = await callable(library, "read")(source);
  const result = callable(library, "aggregate")(recordsOf(read), spec);
  return callable(library, "render")(result, format);
};

const asJson = (value: unknown): unknown =>
  value === undefined ? { [UNDEFINED_MARKER]: true } : JSON.parse(JSON.stringify(value) ?? "null");

const threw = (error: unknown): ApiObservation => ({
  kind: "threw",
  isTypeError: error instanceof TypeError,
  isError: error instanceof Error,
  name: error instanceof Error ? error.name : typeof error,
  message: error instanceof Error ? error.message : String(error),
});

const observe = async (entry: string, testCase: ApiCase): Promise<ApiObservation> => {
  const library: Library = { ...(await import(pathToFileURL(entry).href)) };
  const args = await resolveArgs(library, testCase);
  const before = JSON.stringify(args);
  try {
    const value = await invoke(library, testCase.call, args);
    return { kind: "returned", value: asJson(value), modifiedArguments: JSON.stringify(args) !== before };
  } catch (error) {
    return threw(error);
  }
};

const main = async (): Promise<void> => {
  const [entry] = process.argv.slice(2);
  const parsed: unknown = JSON.parse(readFileSync(0, "utf8"));
  if (entry === undefined || !isApiCase(parsed)) throw new Error("usage: apiWorker.js <library entry> < case.json");
  process.stdout.write(JSON.stringify(await observe(entry, parsed)));
};

await main();
