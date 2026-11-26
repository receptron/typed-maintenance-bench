import type { RawRecord } from "../record.js";

export type Reader = (bytes: Uint8Array, input: string) => Promise<RawRecord[]> | RawRecord[];
type Registered = { name: string; extensions: string[]; reader: Reader };

const registered = new Map<string, Registered>();

export const isFormat = (name: string): boolean => registered.has(name);

export const formatOfExtension = (extension: string): string | undefined =>
  [...registered.values()].find((format) => format.extensions.includes(extension))?.name;

export const isClaimedExtension = (extension: string): boolean => formatOfExtension(extension) !== undefined;

export const addFormat = (name: string, extensions: string[], reader: Reader): void => {
  registered.set(name, { name, extensions: [...extensions], reader });
};

export const readerFor = (name: string): Reader => {
  const format = registered.get(name);
  if (format === undefined) throw new Error(`format ${name} is not registered`);
  return format.reader;
};
