// Writes every fixture byte for byte, so BOMs, CRLF, encodings and XLSX cell
// types are reproducible. Run `yarn build && yarn gen:fixtures`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { CSV_FILES, TEXT_FILES, LARGE_ROW_COUNT, XLSX_FILES, type Sheet } from "./data.js";
import { STAGE_3_4_FILES } from "./data-stages-3-4.js";
import { STAGE_5_7_FILES } from "./data-stages-5-7.js";

const STAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "experiments",
  "staged-growth",
);

const writeBytes = (relativePath: string, bytes: Uint8Array | string): void => {
  const target = path.join(STAGE_ROOT, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
};

const largeCsv = (): string => {
  const header = "order_id,customer_id,order_date,sku,quantity,unit_price,discount,notes";
  const rows = Array.from(
    { length: LARGE_ROW_COUNT },
    (_, index) => `${index},C${index % 7},2026-05-01,S${index % 3},1,0.01,,`,
  );
  return [header, ...rows, ""].join("\n");
};

const writeSheet = async (relativePath: string, sheet: Sheet): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("orders");
  sheet.rows.forEach((row, index) => {
    const excelRow = worksheet.getRow(index + 1);
    row.forEach((value, column) => {
      if (value !== null) excelRow.getCell(column + 1).value = value;
    });
    excelRow.commit();
  });
  worksheet.getColumn(sheet.dateColumn).numFmt = "yyyy-mm-dd";
  writeBytes(relativePath, new Uint8Array(await workbook.xlsx.writeBuffer()));
};

const main = async (): Promise<void> => {
  Object.entries(CSV_FILES).forEach(([relativePath, lines]) => writeBytes(relativePath, lines.join("\n")));
  Object.entries(TEXT_FILES).forEach(([relativePath, bytes]) => writeBytes(relativePath, bytes));
  Object.entries(STAGE_3_4_FILES).forEach(([relativePath, text]) => writeBytes(relativePath, text));
  Object.entries(STAGE_5_7_FILES).forEach(([relativePath, bytes]) => writeBytes(relativePath, bytes));
  writeBytes("stage-1/hidden-tests/fixtures/large.csv", largeCsv());
  await Promise.all(Object.entries(XLSX_FILES).map(([relativePath, sheet]) => writeSheet(relativePath, sheet)));
};

await main();
