import { readFile } from "node:fs/promises";
import type { Format } from "./args.js";
import { FatalError } from "./fatal.js";
import { csvRecords } from "./formats/csv.js";
import { jsonRecords, jsonlRecords, yamlRecords } from "./formats/json.js";
import { decodeUtf8 } from "./formats/text.js";
import { xlsxRecords } from "./formats/xlsx.js";
import type { RawRecord } from "./record.js";

const readBytes = async (input: string): Promise<Uint8Array> => {
  try {
    return await readFile(input);
  } catch (error) {
    throw new FatalError(`${input}: cannot read: ${String(error)}`);
  }
};

export const readRecords = async (input: string, format: Format): Promise<RawRecord[]> => {
  const bytes = await readBytes(input);
  if (format === "xlsx") return xlsxRecords(bytes, input);
  const text = decodeUtf8(bytes, input);
  if (format === "csv") return csvRecords(text, input);
  if (format === "json") return jsonRecords(text, input);
  return format === "jsonl" ? jsonlRecords(text) : yamlRecords(text, input);
};
