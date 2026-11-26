import { REQUIRED_COLUMNS } from "../record.js";

type Entry = { location: string; fields: Record<string, string> } | { location: string; problem: string };

const TRIMMED = /^ +| +$/g;

const entryFor = (header: string[], line: string, location: string): Entry => {
  const values = line.split("\t");
  if (values.length < header.length) return { location, problem: "too few fields" };
  return { location, fields: Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])) };
};

// The library hands over the text without its byte-order mark.
const parse = (text: string): Entry[] => {
  if (text === "") throw new Error("no header line");
  const [headerLine = "", ...lines] = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const header = headerLine.split("\t").map((name) => name.replace(TRIMMED, ""));
  const missing = REQUIRED_COLUMNS.find((column) => !header.includes(column));
  if (missing !== undefined) throw new Error(`missing column ${missing}`);
  return lines
    .map((line, index) => ({ line, location: String(index + 2) }))
    .filter(({ line }) => line !== "")
    .map(({ line, location }) => entryFor(header, line, location));
};

export const TSV_PLUGIN = { name: "tsv", extensions: [".tsv"], parse };
