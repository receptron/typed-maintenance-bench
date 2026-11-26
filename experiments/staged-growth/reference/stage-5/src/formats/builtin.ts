import { csvRecords } from "./csv.js";
import { jsonRecords, jsonlRecords, yamlRecords } from "./json.js";
import { addFormat } from "./registry.js";
import { decodeUtf8 } from "./text.js";
import { xlsxRecords } from "./xlsx.js";

export const registerBuiltinFormats = (): void => {
  addFormat("csv", [".csv"], (bytes, input) => csvRecords(decodeUtf8(bytes, input), input));
  addFormat("json", [".json"], (bytes, input) => jsonRecords(decodeUtf8(bytes, input), input));
  addFormat("jsonl", [".jsonl", ".ndjson"], (bytes, input) => jsonlRecords(decodeUtf8(bytes, input)));
  addFormat("yaml", [".yaml", ".yml"], (bytes, input) => yamlRecords(decodeUtf8(bytes, input), input));
  addFormat("xlsx", [".xlsx"], xlsxRecords);
};
