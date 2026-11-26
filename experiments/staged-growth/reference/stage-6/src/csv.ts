export type CsvRow = { line: number; fields: string[]; blank: boolean };

const QUOTED = /"((?:[^"]|"")*)"/y;
const UNQUOTED = /[^,\r\n]*/y;
const ESCAPED_QUOTE = /""/g;

type Field = { value: string; end: number; quoted: boolean };

const readField = (text: string, start: number): Field => {
  QUOTED.lastIndex = start;
  const quoted = QUOTED.exec(text);
  if (quoted !== null) {
    UNQUOTED.lastIndex = QUOTED.lastIndex;
    const trailing = UNQUOTED.exec(text)?.[0] ?? "";
    return { value: (quoted[1] ?? "").replace(ESCAPED_QUOTE, '"') + trailing, end: UNQUOTED.lastIndex, quoted: true };
  }
  if (text[start] === '"') return { value: text.slice(start + 1), end: text.length, quoted: true };
  UNQUOTED.lastIndex = start;
  const plain = UNQUOTED.exec(text)?.[0] ?? "";
  return { value: plain, end: start + plain.length, quoted: false };
};

const recordEnd = (text: string, position: number): number => {
  if (text.startsWith("\r\n", position)) return position + 2;
  return text[position] === "\n" ? position + 1 : position;
};

const readRecord = (text: string, start: number): { fields: Field[]; end: number } => {
  const fields: Field[] = [];
  const next = (position: number): number => {
    const field = readField(text, position);
    fields.push(field);
    return text[field.end] === "," ? next(field.end + 1) : field.end;
  };
  const fieldsEnd = next(start);
  const end = recordEnd(text, fieldsEnd);
  return { fields, end: end === fieldsEnd && end < text.length ? end + 1 : end };
};

const countNewlines = (text: string, from: number, to: number): number => {
  const segment = text.slice(from, to);
  return segment.length - segment.replaceAll("\n", "").length;
};

export const parseCsv = (text: string): CsvRow[] => {
  const rows: CsvRow[] = [];
  // A loop rather than recursion: files can hold far more records than the call stack allows.
  let start = 0;
  let line = 1;
  while (start < text.length) {
    const { fields, end } = readRecord(text, start);
    const blank = fields.length === 1 && fields[0]?.quoted === false && fields[0].value === "";
    rows.push({ line, fields: fields.map((field) => field.value), blank });
    line += countNewlines(text, start, end);
    start = end;
  }
  return rows;
};
