import YAML from "yaml";
import { FatalError } from "../fatal.js";
import type { RawRecord } from "../record.js";
import { isPlainObject } from "./text.js";

const toRecord = (element: unknown, location: string): RawRecord =>
  isPlainObject(element)
    ? { kind: "values", location, values: new Map(Object.entries(element)) }
    : { kind: "problem", location, problem: "not an object" };

const parseWith = (parse: (text: string) => unknown, text: string, input: string): unknown => {
  try {
    return parse(text);
  } catch (error) {
    throw new FatalError(`${input}: cannot parse: ${String(error)}`);
  }
};

const sequenceRecords = (parsed: unknown, input: string): RawRecord[] => {
  if (!Array.isArray(parsed)) throw new FatalError(`${input}: top-level value is not a list`);
  return parsed.map((element: unknown, index) => toRecord(element, `#${index + 1}`));
};

export const jsonRecords = (text: string, input: string): RawRecord[] =>
  sequenceRecords(parseWith(JSON.parse, text, input), input);

export const yamlRecords = (text: string, input: string): RawRecord[] =>
  sequenceRecords(
    parseWith((source) => YAML.parse(source), text, input),
    input,
  );

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

export const jsonlRecords = (text: string): RawRecord[] =>
  text
    .split("\n")
    .map((line, index) => ({ line: line.replace(/\r$/, ""), location: String(index + 1) }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, location }) => toRecord(parseLine(line), location));
