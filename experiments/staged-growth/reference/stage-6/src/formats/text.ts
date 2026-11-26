import { FatalError } from "../fatal.js";
import { REQUIRED_COLUMNS } from "../record.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export const decodeUtf8 = (bytes: Uint8Array, input: string): string => {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new FatalError(`${input}: not UTF-8`);
  }
};

export const requireColumns = (header: string[], input: string): void => {
  const missing = REQUIRED_COLUMNS.find((column) => !header.includes(column));
  if (missing !== undefined) throw new FatalError(`${input}: missing column ${missing}`);
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
