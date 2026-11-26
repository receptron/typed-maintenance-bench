// Parse functions for the plugins that API cases register by name.
// Shipped into the agent's tree with the API runner, so it may import only Node built-ins.

type Entry = { location: string; fields: Record<string, unknown> } | { location: string; problem: string };

const PIPE = "|";

const pipeEntry = (header: string[], line: string, index: number): Entry => {
  const values = line.split(PIPE);
  const location = String(index + 1);
  if (values.length < header.length) return { location, problem: "too few fields" };
  return { location, fields: Object.fromEntries(header.map((name, column) => [name, values[column]])) };
};

// A header line, then one record per line, fields separated by "|"; empty lines are skipped.
const parsePipe = (text: string): Entry[] => {
  const [headerLine = "", ...lines] = text.split("\n");
  const header = headerLine.split(PIPE);
  return lines
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => line !== "")
    .map(({ line, index }) => pipeEntry(header, line, index));
};

// Ignores its input: values of every type the typed-format rules decide on, a problem entry and a duplicate.
const TYPED_ENTRIES: readonly Entry[] = [
  {
    location: "a",
    fields: {
      order_id: 1,
      customer_id: "T1",
      order_date: "2026-03-01",
      sku: "T",
      quantity: 2,
      unit_price: 1.5,
      discount: null,
      notes: 5,
    },
  },
  {
    location: "b",
    fields: { order_id: "2", customer_id: "T1", order_date: "2026-03-01", sku: "T", quantity: 2.5, unit_price: "1" },
  },
  {
    location: "c",
    fields: {
      order_id: "3",
      customer_id: "T1",
      order_date: "2026-03-02",
      sku: "T",
      quantity: 1,
      unit_price: "1",
      notes: true,
    },
  },
  { location: "d", problem: "rejected by the plugin" },
  {
    location: "e",
    fields: { order_id: 1, customer_id: "T2", order_date: "2026-03-02", sku: "T", quantity: 1, unit_price: "9.99" },
  },
  { location: "f", fields: { customer_id: "T1", order_date: "2026-03-03", sku: "T", quantity: 1, unit_price: "1" } },
  {
    location: "g",
    fields: {
      order_id: "4",
      customer_id: " T3 ",
      order_date: "2026-03-03",
      sku: "U",
      quantity: "3",
      unit_price: "0.50",
    },
  },
];

const parseTyped = (): Entry[] => structuredClone([...TYPED_ENTRIES]);

const parseThrows = (): never => {
  throw new Error("the plugin cannot parse this file");
};

const parseBadReturn = (): unknown => ({ entries: [] });

const parseBadEntry = (): unknown => [{ location: 1, fields: {} }];

export const PLUGIN_PARSERS: Record<string, (text: string) => unknown> = {
  pipe: parsePipe,
  typed: parseTyped,
  throws: parseThrows,
  "bad-return": parseBadReturn,
  "bad-entry": parseBadEntry,
};
