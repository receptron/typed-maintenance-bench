import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { FatalError } from "../fatal.js";
import type { RawRecord } from "../record.js";
import { isPlainObject, requireColumns } from "./text.js";

const cellValue = (value: unknown): unknown => {
  if (!isPlainObject(value)) return value;
  if (Array.isArray(value.richText)) {
    return value.richText.map((run: unknown) => (isPlainObject(run) ? String(run.text ?? "") : "")).join("");
  }
  if ("result" in value) return cellValue(value.result);
  if ("text" in value) return value.text;
  return value;
};

const loadSheet = async (bytes: Uint8Array, input: string): Promise<ExcelJS.Worksheet> => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.read(Readable.from([bytes]));
  } catch (error) {
    throw new FatalError(`${input}: cannot open workbook: ${String(error)}`);
  }
  const sheet = workbook.worksheets[0];
  if (sheet === undefined || sheet.actualRowCount === 0) throw new FatalError(`${input}: no header row`);
  return sheet;
};

const rowValues = (row: ExcelJS.Row, width: number): unknown[] =>
  Array.from({ length: width }, (_, index) => cellValue(row.getCell(index + 1).value));

export const xlsxRecords = async (bytes: Uint8Array, input: string): Promise<RawRecord[]> => {
  const sheet = await loadSheet(bytes, input);
  const header = rowValues(sheet.getRow(1), sheet.columnCount).map((name) => String(name ?? "").trim());
  requireColumns(header, input);
  const records: RawRecord[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = rowValues(row, header.length);
    if (values.every((value) => value === null || value === undefined)) return;
    records.push({
      kind: "values",
      location: String(rowNumber),
      values: new Map(header.map((name, index) => [name, values[index]])),
    });
  });
  return records;
};
