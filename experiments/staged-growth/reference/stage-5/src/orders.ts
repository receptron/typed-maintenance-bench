import { checkRecord, type OrderLine, type RawRecord } from "./record.js";
import { readRecords } from "./source.js";

export type Warning = { location: string; reason: string };
export type Orders = { lines: OrderLine[]; warnings: Warning[] };

const acceptRecord = (record: RawRecord, seen: Set<string>): OrderLine | string => {
  if (record.kind === "problem") return record.problem;
  const checked = checkRecord(record.values);
  if (!checked.ok) return checked.reason;
  const identity = JSON.stringify([checked.line.orderId, checked.line.sku]);
  if (seen.has(identity)) return "duplicate order_id and sku";
  seen.add(identity);
  return checked.line;
};

export const validOrders = (records: RawRecord[]): Orders => {
  const seen = new Set<string>();
  return records.reduce<Orders>(
    (orders, record) => {
      const accepted = acceptRecord(record, seen);
      if (typeof accepted === "string") orders.warnings.push({ location: record.location, reason: accepted });
      else orders.lines.push(accepted);
      return orders;
    },
    { lines: [], warnings: [] },
  );
};

export const readOrders = async (input: string, format: string): Promise<Orders> =>
  validOrders(await readRecords(input, format));
