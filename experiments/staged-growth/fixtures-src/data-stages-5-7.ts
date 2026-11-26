// Stage 5–7 fixture contents. As in data.ts, expected outputs are computed by
// hand from these rows and live in each stage's cases.json / api-cases.json.
import { ORDERS_CSV, ORDERS_JSON } from "./data-stages-3-4.js";

const COLUMNS = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount", "notes"];
const S5H = "stage-5/hidden-tests/fixtures/";
const S5V = "stage-5/visible-tests/fixtures/";

const tsv = (rows: string[][]): string => [COLUMNS, ...rows].map((row) => row.join("\t")).join("\n");
const pipe = (rows: string[][]): string => [COLUMNS, ...rows].map((row) => row.join("|")).join("\n");
const latin1 = (text: string): Uint8Array => Uint8Array.from([...text].map((character) => character.charCodeAt(0)));
const BOM = "﻿";

// The weeks cross 1 January 2027, which falls in ISO week 2026-W53. Line 7 is empty, line 9 duplicates
// line 2, line 10 has an invalid price, line 11 is short, and line 12 has a customer id with spaces around it.
const ORDERS_TSV = `${[
  tsv([
    ["1", "C1", "2026-12-28", "A", "2", "10.00", "", ""],
    ["2", "C2", "2026-12-31", '"B"', "1", "5.50", "0.10", ""],
    ["3", "C1", "2027-01-01", "A", "3", "1.25", "", ""],
    ["4", "C/3", "2027-01-03", "A", "1", "7.00", "", ""],
    ["5", "C2", "2027-01-04", "B", "1", "0.99", "0.5", ""],
  ]),
  "",
  ["6", "C1", "2026-12-27", "A", "4", "2.50", "", "note"].join("\t"),
  ["1", "C9", "2027-01-05", "A", "1", "100.00", "", ""].join("\t"),
  ["7", "C3", "2027-01-05", "A", "1", "abc", "", ""].join("\t"),
  ["8", "C2", "2027-01-05"].join("\t"),
  ["9", " C.1 ", "2027-01-10", "X", "1", "1.00", "", ""].join("\t"),
].join("\n")}\n`;

// Line 4 duplicates line 2, line 5 is short and line 6 has a quantity of 0.
const ORDERS_PIPE = `${pipe([
  ["1", "P1", "2026-03-01", "A", "2", "1.00", "", ""],
  ["2", "P1", "2026-03-02", "B", "1", "2.50", "0.2", "x"],
  ["1", "P2", "2026-03-03", "A", "1", "9.00", "", ""],
  ["3", "P2", "2026-03-03"],
  ["4", "P2", "2026-03-04", "A", "0", "1.00", "", ""],
])}\n`;

const STAGE_5_HIDDEN: Record<string, string | Uint8Array> = {
  "orders.tsv": ORDERS_TSV,
  "orders.data": ORDERS_TSV,
  "upper.TSV": ORDERS_TSV,
  "bom.tsv": `${BOM}${tsv([["1", "B1", "2026-03-02", "A", "1", "2.00", "", ""]])}\n`,
  "header.tsv": `${COLUMNS.join("\t")}\n`,
  // Line 2 lacks only the optional discount and notes, but is still short.
  "short.tsv": `${tsv([
    ["1", "S1", "2026-03-02", "A", "1", "1.00"],
    ["2", "S1", "2026-03-02", "A", "1", "2.00", "", ""],
  ])}\n`,
  "missing-column.tsv": "order_id\tcustomer_id\torder_date\tsku\tunit_price\n1\tC1\t2026-03-01\tA\t1.00\n",
  "empty.tsv": "",
  "latin1.tsv": latin1(`${tsv([["1", "C1", "2026-03-01", "café", "1", "1.00", "", ""]])}\n`),
  "orders.csv": ORDERS_CSV,
  "orders.json": ORDERS_JSON,
  "cfg-tsv.json": '{"groupBy": ["customer"], "format": "tsv"}\n',
  "blocker.txt": "a regular file, so no directory can be created below it\n",
  "orders.pipe": ORDERS_PIPE,
  "orders.txt": ORDERS_PIPE,
  "upper.PIPE": ORDERS_PIPE,
  "bom.pipe": `${BOM}${ORDERS_PIPE}`,
  "latin1.pipe": latin1(`${pipe([["1", "P1", "2026-03-01", "café", "1", "1.00", "", ""]])}\n`),
  "any.typed": "the typed test plugin ignores its input\n",
};

const S6H = "stage-6/hidden-tests/fixtures/";
const S6V = "stage-6/visible-tests/fixtures/";
const HEADER_6 = "order_id,customer_id,order_date,sku,quantity,unit_price,currency,discount,notes";

// Line 4 is 1 March in New York but 2 March in UTC; line 5 is 1 March in UTC but 2 March in Tokyo. Line 9 is
// 9 March in New York only under daylight saving time; line 12's +05:30 offset puts it on 2 March in UTC only
// if its minutes are counted. Lines 6, 8, 10, 11, 15 and 16 are invalid; line 15 duplicates line 3.
const ORDERS_6_CSV = `${[
  HEADER_6,
  "1,C1,2026-03-01,A,2,10.00,,,",
  "2,C1,2026-03-01,A,1,5.00,EUR,,",
  "3,C2,2026-03-01T23:30:00-05:00,B,1,3.00,USD,,",
  "4,C2,2026-03-02T00:30:00+09:00,A,1,4.00,JPY,,",
  "5,C1,2026-03-02,B,3,1.25,eur,0.20,",
  "6,C3,2026-03-02T10:00:00Z,A,1,2.00,EUR,,",
  "7,C1,2026-03-02T12:00,A,1,1.00,,,",
  "8,C3,2026-03-09T04:30:00Z,B,1,1.00,,,",
  "9,C2,2026-02-30T10:00:00Z,A,1,1.00,,,",
  "10,C1,2026-03-03T24:00:00Z,A,1,1.00,,,",
  "11,C4,2026-03-03T05:15+05:30,A,2,0.50,USD,,",
  "12,C1,2026-03-04,A,1,7.00,USD,0.10,note",
  "13,C2,2026-03-04T12:00:00Z,A,1,2.00,EUR,0.5,",
  "2,C9,2026-03-05,A,1,99.00,GBP,,",
  "15,C1,2026-03-05,A,1,1.00,EURO,,",
].join("\n")}\n`;

// The currency is the last column, as an exporter that appends new columns would write it.
const ORDERS_6_TSV = `${[
  [...COLUMNS, "currency"],
  ["1", "T1", "2026-03-01T22:00:00-03:00", "A", "1", "1.00", "", "", "EUR"],
  ["2", "T1", "2026-03-02", "A", "1", "2.00", "", "", ""],
  ["3", "T2", "2026-03-02", "B", "2", "1.50", "", "", "JPY"],
]
  .map((row) => row.join("\t"))
  .join("\n")}\n`;

const ORDERS_6_JSON = `${JSON.stringify(
  [
    {
      order_id: "j1",
      customer_id: "J1",
      order_date: "2026-03-01T20:00:00-08:00",
      sku: "A",
      quantity: 1,
      unit_price: 3.5,
      currency: "EUR",
    },
    {
      order_id: "j2",
      customer_id: "J1",
      order_date: "2026-03-01",
      sku: "A",
      quantity: 2,
      unit_price: "1.00",
      currency: null,
    },
    {
      order_id: "j3",
      customer_id: "J2",
      order_date: "2026-03-01T12:00:00Z",
      sku: "B",
      quantity: 1,
      unit_price: 1,
      currency: 978,
    },
    {
      order_id: "j4",
      customer_id: "J2",
      order_date: "2026-03-01T12:00:00+00:00",
      sku: "B",
      quantity: 1,
      unit_price: 1,
      currency: "usd",
    },
    { order_id: "j5", customer_id: "J2", order_date: "2026-03-01T12:00:00.000Z", sku: "B", quantity: 1, unit_price: 1 },
    { order_id: "j6", customer_id: "J2", order_date: "2026-03-01t12:00:00z", sku: "B", quantity: 1, unit_price: 1 },
    {
      order_id: "j7",
      customer_id: "J2",
      order_date: "2026-03-01T12:00:00+24:00",
      sku: "B",
      quantity: 1,
      unit_price: 1,
    },
  ],
  null,
  2,
)}\n`;

const ORDERS_6_PIPE =
  "order_id|customer_id|order_date|sku|quantity|unit_price|currency\n1|P1|2026-03-01T23:00:00-01:00|A|1|1.00|EUR\n";

const STAGE_6_HIDDEN: Record<string, string | Uint8Array> = {
  "orders6.csv": ORDERS_6_CSV,
  "orders6.tsv": ORDERS_6_TSV,
  "orders6.json": ORDERS_6_JSON,
  "orders6.pipe": ORDERS_6_PIPE,
  "orders.csv": ORDERS_CSV,
  "orders.tsv": ORDERS_TSV,
  "orders.pipe": ORDERS_PIPE,
  "any.typed": "the typed test plugin ignores its input\n",
  "cfg-all.json":
    '{"groupBy": ["customer", "day", "sku"], "output": "json", "from": "2026-03-01", "to": "2026-03-05", "skuPrefix": ""}\n',
  "cfg-sku-markdown.json": '{"groupBy": ["sku"], "output": "markdown"}\n',
  "cfg-tokyo.json": '{"groupBy": ["day"], "timeZone": "Asia/Tokyo"}\n',
  "cfg-bad-zone.json": '{"groupBy": ["day"], "timeZone": "Asia/Tokio"}\n',
  "cfg-zone-type.json": '{"groupBy": ["day"], "timeZone": 9}\n',
};

const S7H = "stage-7/hidden-tests/fixtures/";
const S7A = "stage-7/attachments/";
const crlf = (rows: string[][]): string => `${rows.map((row) => row.join("\t")).join("\r\n")}\r\n`;
const csv = (rows: string[][]): string => `${rows.map((row) => row.join(",")).join("\n")}\n`;
const NAMES_HEADER = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
const NAMES_ROWS = [
  ["1", "Müller", "2026-03-02", "A", "1", "1.00"],
  ["2", "田中", "2026-03-03", "A", "2", "1.00"],
  ["3", "Zoë-1", "2026-03-04", "A", "1", "3.00"],
  ["4", "🙂x", "2026-03-05", "A", "1", "4.00"],
  ["5", "A_b", "2026-03-06", "A", "1", "5.00"],
];

const STAGE_7_HIDDEN: Record<string, string> = {
  // orders6.tsv with CRLF line ends and an empty line after the first record.
  "crlf6.tsv": crlf([
    [...COLUMNS, "currency"],
    ["1", "T1", "2026-03-01T22:00:00-03:00", "A", "1", "1.00", "", "", "EUR"],
    [],
    ["2", "T1", "2026-03-02", "A", "1", "2.00", "", "", ""],
    ["3", "T2", "2026-03-02", "B", "2", "1.50", "", "", "JPY"],
  ]),
  "names.csv": csv([NAMES_HEADER, ...NAMES_ROWS]),
  "names.json": `${JSON.stringify(
    NAMES_ROWS.map((row) => Object.fromEntries(NAMES_HEADER.map((name, index) => [name, row[index]]))),
    null,
    2,
  )}\n`,
  "orders6.csv": ORDERS_6_CSV,
  "cfg-tokyo.json": '{"groupBy": ["day"], "timeZone": "Asia/Tokyo"}\n',
  "orders-c.csv": csv([
    ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "currency"],
    ["1", "K1", "2026-03-01T22:00:00Z", "A", "1", "3.00", ""],
    ["2", "K2", "2026-03-02T02:00:00Z", "B", "2", "1.50", ""],
  ]),
};

const STAGE_7_ATTACHMENTS: Record<string, string> = {
  "windows-export.tsv": crlf([
    [...COLUMNS, "currency"],
    ["1", "W1", "2026-03-02", "A", "1", "10.00", "", "", "EUR"],
    ["2", "W1", "2026-03-03", "A", "1", "2.00", "", "", ""],
    ["3", "W2", "2026-03-03T23:30:00+01:00", "B", "1", "5.00", "", "", "GBP"],
  ]),
  "customers.csv": csv([
    NAMES_HEADER,
    ["1", "Müller", "2026-03-02", "A", "1", "12.00"],
    ["2", "田中", "2026-03-03", "B", "1", "8.00"],
    ["3", "Schmidt", "2026-03-03", "A", "1", "5.00"],
  ]),
  "orders.csv": csv([
    ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "currency"],
    ["1", "K1", "2026-03-01T20:00:00Z", "A", "1", "4.00", ""],
    ["2", "K1", "2026-03-02T01:00:00Z", "A", "1", "6.00", ""],
  ]),
  "team.json": '{"groupBy": ["day"], "timeZone": "Asia/Tokyo"}\n',
};

const prefixed = <T>(prefix: string, files: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(files).map(([name, content]) => [`${prefix}${name}`, content]));

export const STAGE_5_7_FILES: Record<string, string | Uint8Array> = {
  ...prefixed(S5H, STAGE_5_HIDDEN),
  ...prefixed(S5V, { "orders.tsv": ORDERS_TSV, "orders.pipe": ORDERS_PIPE }),
  ...prefixed(S6H, STAGE_6_HIDDEN),
  ...prefixed(S6V, { "orders6.csv": ORDERS_6_CSV }),
  ...prefixed(S7H, STAGE_7_HIDDEN),
  ...prefixed(S7A, STAGE_7_ATTACHMENTS),
};
