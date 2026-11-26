// Runs one API case in its own process and prints what happened as JSON.
// Shipped into the agent's tree with the API runner, so it may import only Node built-ins.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  PLUGIN_MARKER,
  UNDEFINED_MARKER,
  isApiCase,
  type ApiCase,
  type ApiObservation,
  type ApiStep,
} from "./apiCases.js";
import { PLUGIN_PARSERS } from "./apiPlugins.js";
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

const pluginParser = (name: unknown): ((text: string) => unknown) => {
  const parser = typeof name === "string" ? PLUGIN_PARSERS[name] : undefined;
  if (parser === undefined) throw new Error(`no test plugin named ${String(name)}`);
  return parser;
};

const withPlugins = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withPlugins);
  if (!isRecord(value)) return value;
  if (PLUGIN_MARKER in value) return pluginParser(value[PLUGIN_MARKER]);
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withPlugins(inner)]));
};

const invoke = async (library: Library, call: ApiCase["call"], args: unknown[]): Promise<unknown> => {
  if (call !== "pipeline") return await callable(library, call)(...args);
  const [source, spec, format] = args;
  const read = await callable(library, "read")(source);
  const result = callable(library, "aggregate")(recordsOf(read), spec);
  return callable(library, "render")(result, format);
};

const throwsWhenRun = async (library: Library, step: ApiStep): Promise<boolean> => {
  try {
    await invoke(library, step.call, step.args.map(withPlugins));
    return false;
  } catch {
    return true;
  }
};

const runStep = async (library: Library, step: ApiStep): Promise<void> => {
  const threw = await throwsWhenRun(library, step);
  if (threw !== (step.throws === true)) throw new Error(`setup step ${step.call} ${threw ? "threw" : "did not throw"}`);
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
  for (const step of testCase.setup ?? []) await runStep(library, step);
  const args = (await resolveArgs(library, testCase)).map(withPlugins);
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
