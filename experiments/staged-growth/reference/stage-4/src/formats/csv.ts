import { parseCsv } from "../csv.js";
import { FatalError } from "../fatal.js";
import type { RawRecord } from "../record.js";
import { requireColumns } from "./text.js";

const TRIMMED = /^[ \t]+|[ \t]+$/g;

export const csvRecords = (text: string, input: string): RawRecord[] => {
  const [headerRow, ...rows] = parseCsv(text);
  if (headerRow === undefined) throw new FatalError(`${input}: no header line`);
  const header = headerRow.fields.map((name) => name.replace(TRIMMED, ""));
  requireColumns(header, input);
  return rows
    .filter((row) => !row.blank)
    .map((row): RawRecord => {
      const location = String(row.line);
      if (row.fields.length < header.length) return { kind: "problem", location, problem: "too few fields" };
      return { kind: "values", location, values: new Map(header.map((name, index) => [name, row.fields[index]])) };
    });
};
