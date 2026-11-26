import { readFile } from "node:fs/promises";
import { FatalError } from "./fatal.js";
import { readerFor } from "./formats/registry.js";
import type { RawRecord } from "./record.js";

const readBytes = async (input: string): Promise<Uint8Array> => {
  try {
    return await readFile(input);
  } catch (error) {
    throw new FatalError(`${input}: cannot read: ${String(error)}`);
  }
};

export const readRecords = async (input: string, format: string): Promise<RawRecord[]> =>
  readerFor(format)(await readBytes(input), input);
