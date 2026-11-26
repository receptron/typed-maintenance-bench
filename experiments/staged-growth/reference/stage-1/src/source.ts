import { readFile } from "node:fs/promises";
import type { Options } from "./args.js";
import { FatalError } from "./fatal.js";
import { csvRecords } from "./formats/csv.js";
import { decodeUtf8 } from "./formats/text.js";
import type { RawRecord } from "./record.js";

const readBytes = async (input: string): Promise<Uint8Array> => {
  try {
    return await readFile(input);
  } catch (error) {
    throw new FatalError(`${input}: cannot read: ${String(error)}`);
  }
};

export const readRecords = async ({ input }: Options): Promise<RawRecord[]> =>
  csvRecords(decodeUtf8(await readBytes(input), input), input);
