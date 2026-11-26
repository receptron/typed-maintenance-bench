import { FatalError } from "./fatal.js";
import { addFormat, isClaimedExtension, isFormat, type Reader } from "./formats/registry.js";
import { decodeUtf8, isPlainObject } from "./formats/text.js";
import type { RawRecord } from "./record.js";

type Parse = (text: string) => unknown;

const PLUGIN_KEYS = ["name", "extensions", "parse"];
const NAME_PATTERN = /^[a-z][a-z0-9]*$/;
const EXTENSION_PATTERN = /^\.[a-z0-9]+$/;

const toRawRecord = (entry: unknown, input: string): RawRecord => {
  if (isPlainObject(entry) && typeof entry.location === "string") {
    const { location, fields, problem } = entry;
    if (typeof problem === "string" && fields === undefined) return { kind: "problem", location, problem };
    if (isPlainObject(fields) && problem === undefined)
      return { kind: "values", location, values: new Map(Object.entries(fields)) };
  }
  throw new FatalError(
    `${input}: the format plugin returned an entry that is not { location, fields } or { location, problem }`,
  );
};

const parseWith = (parse: Parse, text: string, input: string): unknown => {
  try {
    return parse(text);
  } catch (error) {
    throw new FatalError(`${input}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const pluginReader =
  (parse: Parse): Reader =>
  (bytes, input) => {
    const entries = parseWith(parse, decodeUtf8(bytes, input), input);
    if (!Array.isArray(entries)) throw new FatalError(`${input}: the format plugin did not return an array`);
    return entries.map((entry: unknown) => toRawRecord(entry, input));
  };

const checkName = (name: unknown): string => {
  if (typeof name !== "string" || !NAME_PATTERN.test(name))
    throw new TypeError("plugin.name must be lowercase letters and digits");
  if (isFormat(name)) throw new TypeError(`format ${name} is already registered`);
  return name;
};

const checkExtensions = (extensions: unknown): string[] => {
  if (!Array.isArray(extensions)) throw new TypeError("plugin.extensions must be an array");
  const checked = extensions.map((extension: unknown) => {
    if (typeof extension !== "string" || !EXTENSION_PATTERN.test(extension))
      throw new TypeError("each extension must be a dot followed by lowercase letters and digits");
    if (isClaimedExtension(extension)) throw new TypeError(`extension ${extension} is already registered`);
    return extension;
  });
  if (new Set(checked).size !== checked.length) throw new TypeError("plugin.extensions must be distinct");
  return checked;
};

const isParse = (value: unknown): value is Parse => typeof value === "function";

export const registerFormat = (plugin: unknown): void => {
  if (!isPlainObject(plugin)) throw new TypeError("plugin must be an object");
  const extra = Object.keys(plugin).find((key) => !PLUGIN_KEYS.includes(key));
  if (extra !== undefined) throw new TypeError(`plugin has an unknown property ${extra}`);
  const name = checkName(plugin.name);
  const extensions = checkExtensions(plugin.extensions);
  if (!isParse(plugin.parse)) throw new TypeError("plugin.parse must be a function");
  addFormat(name, extensions, pluginReader(plugin.parse));
};
