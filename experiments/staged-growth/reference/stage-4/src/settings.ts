import { readFileSync } from "node:fs";
import { FatalError } from "./fatal.js";

export const SETTING_NAMES = ["groupBy", "format", "output", "from", "to", "skuPrefix"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];
export type Settings = {
  groupBy?: string[];
  format?: string;
  output?: string;
  from?: string;
  to?: string;
  skuPrefix?: string;
};

const isSettingName = (value: string): value is SettingName => SETTING_NAMES.some((name) => name === value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseConfigText = (text: string, file: string): Record<string, unknown> => {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text);
    } catch {
      throw new FatalError(`${file}: not valid JSON`);
    }
  })();
  if (!isObject(parsed)) throw new FatalError(`${file}: the top-level value must be an object`);
  return parsed;
};

const readConfigText = (file: string): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
  } catch (error) {
    throw new FatalError(`${file}: cannot read: ${String(error)}`);
  }
};

const addSetting = (settings: Settings, name: SettingName, value: unknown, file: string): Settings => {
  if (name === "groupBy") {
    if (!isStringArray(value)) throw new FatalError(`${file}: groupBy must be an array of strings`);
    return { ...settings, groupBy: value };
  }
  if (typeof value !== "string") throw new FatalError(`${file}: ${name} must be a string`);
  return { ...settings, [name]: value };
};

export const readConfig = (file: string): Settings =>
  Object.entries(parseConfigText(readConfigText(file), file)).reduce<Settings>((settings, [name, value]) => {
    if (!isSettingName(name)) throw new FatalError(`${file}: unknown key ${name}`);
    return addSetting(settings, name, value, file);
  }, {});
