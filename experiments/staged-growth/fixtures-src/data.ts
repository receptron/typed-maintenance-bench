// Fixture contents. Expected outputs live in each stage's cases.json and are
// computed by hand from these rows, never by running an implementation.

export const LARGE_ROW_COUNT = 100_000;

const HEADER = "order_id,customer_id,order_date,sku,quantity,unit_price,discount,notes";
const BOM = "﻿";
const S1H = "stage-1/hidden-tests/fixtures/";
const S1V = "stage-1/visible-tests/fixtures/";
const S2H = "stage-2/hidden-tests/fixtures/";
const S2V = "stage-2/visible-tests/fixtures/";

const BASIC_CSV = [
  HEADER,
  "1001,C01,2026-01-05,APPLE,3,1.20,,",
  "1001,C01,2026-01-05,PEAR,1,2.50,0.10,gift",
  "1002,C02,2026-01-06,APPLE,10,1.20,0.15,",
  "1003,C01,2026-01-04,KIWI,2,0.99,,",
  "",
];

const ROUNDING_CSV = [
  HEADER,
  "1,C01,2026-01-01,A,1,0.05,0.50,",
  "2,C01,2026-01-01,B,3,0.01,0.5,",
  "3,C01,2026-01-01,C,1,0.33,0.15,",
  "4,C01,2026-01-01,D,7,19.99,0.07,",
  "5,C01,2026-01-01,E,1,1.15,0.50,",
  "6,C01,2026-01-01,F,2,5.00,1,",
  "7,C01,2026-01-01,G,5,0,,",
  "",
];

const QUOTING_CSV = [
  `${BOM}sku,notes,order_id,extra,customer_id,order_date,quantity,unit_price,discount\r`,
  `"WIDGET, LARGE","said ""hi""",2001,x,C10,2026-02-01,2,10.00,\r`,
  `GADGET,"line one\r`,
  `line two",2002,y,C11,2026-02-01,1,5.5,0.2\r`,
  `  BOLT  ,,2003,z,  C10 ,2026-02-02, 4 , 0.25 ,\r`,
  `NUT,,2004,w,C12,2026-02-30,1,1.00,\r`,
  "",
];

const INVALID_CSV = [
  HEADER,
  "3001,C20,2026-03-01,A,1,1.00,,ok",
  ",C20,2026-03-01,A,1,1.00,,missing order id",
  "3002,,2026-03-01,A,1,1.00,,missing customer",
  "3003,C20,2026-3-1,A,1,1.00,,bad date format",
  "3004,C20,2026-02-29,A,1,1.00,,not a leap year",
  "3005,C20,2026-03-01,,1,1.00,,missing sku",
  "3006,C20,2026-03-01,A,0,1.00,,zero quantity",
  "3007,C20,2026-03-01,A,-1,1.00,,negative quantity",
  "3008,C20,2026-03-01,A,1.5,1.00,,fractional quantity",
  '3009,C20,2026-03-01,A,1,"1,200",,thousands separator',
  "3010,C20,2026-03-01,A,1,$1.00,,currency symbol",
  "3011,C20,2026-03-01,A,1,1.005,,three decimals",
  "3012,C20,2026-03-01,A,1,1.00,1.5,discount above 1",
  "3013,C20,2026-03-01,A,1,1.00,0.155,discount three decimals",
  "3001,C20,2026-03-02,A,1,1.00,,duplicate of line 2",
  "3014,C20,2026-03-01,A,1",
  "",
  "3015,C21,2028-02-29,B,2,0.50,,leap year",
  "3016,C20,2026-03-01,A,1e2,1.00,,exponent",
  "3017,C20,2026-03-01,A,1,-1.00,,negative price",
  "3018,C20,2026-03-01,A,1,1.00,-0.1,negative discount",
  "3019,C20,2026-13-01,A,1,1.00,,month 13",
  "3001,C20,2026-03-01,B,1,1.00,,same order other sku",
  "3020,C20,2026-03-01,C,0,1.00,,invalid first occurrence",
  "3020,C20,2026-03-01,C,1,1.00,,valid because the earlier one was invalid",
  "",
];

const UNICODE_CSV = [
  HEADER,
  "4001,顧客A,2026-04-01,りんご,1,1.00,,",
  "4002,顧客B,2026-04-01,みかん,2,1.00,,",
  "4003,顧客A,2026-04-01,apple,3,1.00,,",
  "4004,顧客B,2026-04-01,Zebra,4,1.00,,",
  "",
];

export const CSV_FILES: Record<string, string[]> = {
  [`${S1H}basic.csv`]: BASIC_CSV,
  [`${S1H}rounding.csv`]: ROUNDING_CSV,
  [`${S1H}quoting.csv`]: QUOTING_CSV,
  [`${S1H}invalid.csv`]: INVALID_CSV,
  [`${S1H}header-only.csv`]: [HEADER, ""],
  [`${S1H}empty.csv`]: [""],
  [`${S1H}missing-column.csv`]: [
    "order_id,customer_id,order_date,sku,quantity,discount,notes",
    "1,C,2026-01-01,A,1,,",
    "",
  ],
  [`${S1H}unicode.csv`]: UNICODE_CSV,
  [`${S1V}basic.csv`]: BASIC_CSV,
  [`${S1V}header-only.csv`]: [HEADER, ""],
  [`${S2H}BASIC.CSV`]: BASIC_CSV,
  [`${S2H}basic.txt`]: BASIC_CSV,
  [`${S2V}basic.csv`]: BASIC_CSV,
};

type Row = Record<string, string | number | boolean | null | object>;

const order = (id: string | number, sku: string, extra: Row = {}): Row => ({
  order_id: id,
  customer_id: "C30",
  order_date: "2026-06-01",
  sku,
  quantity: 1,
  unit_price: 2,
  ...extra,
});

const BASIC_ROWS: Row[] = [
  {
    order_id: "1001",
    customer_id: "C01",
    order_date: "2026-01-05",
    sku: "APPLE",
    quantity: "3",
    unit_price: "1.20",
    discount: "",
    notes: "",
  },
  {
    order_id: "1001",
    customer_id: "C01",
    order_date: "2026-01-05",
    sku: "PEAR",
    quantity: "1",
    unit_price: "2.50",
    discount: "0.10",
    notes: "gift",
  },
  {
    order_id: "1002",
    customer_id: "C02",
    order_date: "2026-01-06",
    sku: "APPLE",
    quantity: "10",
    unit_price: "1.20",
    discount: "0.15",
    notes: "",
  },
  {
    order_id: "1003",
    customer_id: "C01",
    order_date: "2026-01-04",
    sku: "KIWI",
    quantity: "2",
    unit_price: "0.99",
    discount: "",
    notes: "",
  },
];

const TYPED_ROUNDING_ROWS: Row[] = [
  { order_id: 1, customer_id: "C01", order_date: "2026-01-01", sku: "A", quantity: 1, unit_price: 0.05, discount: 0.5 },
  { order_id: 2, customer_id: "C01", order_date: "2026-01-01", sku: "B", quantity: 3, unit_price: 0.01, discount: 0.5 },
  {
    order_id: 3,
    customer_id: "C01",
    order_date: "2026-01-01",
    sku: "C",
    quantity: 1,
    unit_price: 0.33,
    discount: 0.15,
  },
  {
    order_id: 4,
    customer_id: "C01",
    order_date: "2026-01-01",
    sku: "D",
    quantity: 7,
    unit_price: 19.99,
    discount: 0.07,
  },
  { order_id: 5, customer_id: "C01", order_date: "2026-01-01", sku: "E", quantity: 1, unit_price: 1.15, discount: 0.5 },
  { order_id: 6, customer_id: "C01", order_date: "2026-01-01", sku: "F", quantity: 2, unit_price: 5, discount: 1 },
  { order_id: 7, customer_id: "C01", order_date: "2026-01-01", sku: "G", quantity: 5, unit_price: 0, discount: null },
];

const INVALID_JSON_ELEMENTS: unknown[] = [
  order("5001", "A"),
  5,
  "text",
  null,
  [1, 2],
  order("5010", "X", { quantity: 2.5 }),
  order("5011", "X", { quantity: true }),
  order("5012", "X", { unit_price: 19.999 }),
  order("5013", "X", { order_date: 20260601 }),
  order("5014", "X", { customer_id: null }),
  order("5001", "A"),
  order(5002, "B", { quantity: "2", unit_price: "1.50", discount: 0.1 }),
  order("5003", "X", { unit_price: { amount: 1 } }),
  order("5004", "X", { discount: null, notes: { x: 1 } }),
  order("5005", "D", { unit_price: 100 }),
  order("5006", "E", { unit_price: 0.1, discount: 0.01 }),
];

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const jsonLines = (rows: unknown[]): string => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

const INVALID_JSONL = [
  JSON.stringify(order("6001", "A", { unit_price: 1 })),
  "not json",
  "",
  "[1]",
  JSON.stringify(order("6002", "X", { quantity: "0" })),
  JSON.stringify(order("6003", "B", { quantity: 2, unit_price: "0.5" })),
  JSON.stringify(order("6001", "A", { unit_price: 1 })),
  "null",
  "",
].join("\n");

const BASIC_YAML = `- order_id: 1001
  customer_id: C01
  order_date: 2026-01-05
  sku: APPLE
  quantity: 3
  unit_price: 1.20
- order_id: 1001
  customer_id: C01
  order_date: 2026-01-05
  sku: PEAR
  quantity: 1
  unit_price: 2.50
  discount: 0.10
  notes: gift
- order_id: 1002
  customer_id: C02
  order_date: 2026-01-06
  sku: APPLE
  quantity: 10
  unit_price: 1.20
  discount: 0.15
- order_id: 1003
  customer_id: C01
  order_date: 2026-01-04
  sku: KIWI
  quantity: 2
  unit_price: 0.99
`;

const INVALID_YAML = `- order_id: 7001
  customer_id: C40
  order_date: 2026-07-01
  sku: A
  quantity: 2
  unit_price: 1.25
- just a string
- order_id: "7002"
  customer_id: C40
  order_date: "2026-07-32"
  sku: A
  quantity: 1
  unit_price: 1
- order_id: "7003"
  customer_id: C41
  order_date: 2026-07-02
  sku: B
  quantity: 3
  unit_price: "0.10"
  discount: 0.5
- order_id: "7004"
  customer_id: C41
  order_date: 2026-07-02
  sku: C
  quantity: 1
  unit_price: 1
  discount: true
`;

const latin1 = (text: string): Uint8Array => Uint8Array.from([...text].map((character) => character.charCodeAt(0)));

export const TEXT_FILES: Record<string, string | Uint8Array> = {
  [`${S2H}basic.json`]: json(BASIC_ROWS),
  [`${S2H}basic.jsonl`]: jsonLines(BASIC_ROWS),
  [`${S2H}basic.yaml`]: BASIC_YAML,
  [`${S2H}basic.dat`]: json(BASIC_ROWS),
  [`${S2H}bom.json`]: BOM + json(BASIC_ROWS),
  [`${S2H}typed.json`]: json(TYPED_ROUNDING_ROWS),
  [`${S2H}invalid.json`]: json(INVALID_JSON_ELEMENTS),
  [`${S2H}invalid.jsonl`]: INVALID_JSONL,
  [`${S2H}invalid.yaml`]: INVALID_YAML,
  [`${S2H}syntax.json`]: '[{"order_id": "1",',
  [`${S2H}object.json`]: json({ orders: BASIC_ROWS }),
  [`${S2H}syntax.yaml`]: "- order_id: 1\n  sku: [unclosed\n",
  [`${S2H}mapping.yaml`]: "orders:\n  - order_id: 1\n",
  [`${S2H}broken.xlsx`]: "this is not a workbook\n",
  [`${S2H}latin1.csv`]: latin1(`${HEADER}\n9001,C01,2026-01-01,café,1,1.00,,\n`),
  [`${S2H}latin1.json`]: latin1(
    `[{"order_id":"9001","customer_id":"C01","order_date":"2026-01-01","sku":"café","quantity":1,"unit_price":1}]\n`,
  ),
  [`${S2V}basic.json`]: json(BASIC_ROWS),
  [`${S2V}basic.jsonl`]: jsonLines(BASIC_ROWS),
  [`${S2V}basic.yaml`]: BASIC_YAML,
};

type Cell = string | number | Date | null;
export type Sheet = { rows: Cell[][]; dateColumn: number };

const DATE_COLUMN = 3;
const SHEET_HEADER: Cell[] = [
  "order_id",
  "customer_id",
  "order_date",
  "sku",
  "quantity",
  "unit_price",
  "discount",
  "notes",
];
const utcDate = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

const BASIC_SHEET: Sheet = {
  dateColumn: DATE_COLUMN,
  rows: [
    SHEET_HEADER,
    [1001, "C01", utcDate(2026, 1, 5), "APPLE", 3, 1.2, null, null],
    [1001, "C01", utcDate(2026, 1, 5), "PEAR", 1, 2.5, 0.1, "gift"],
    [1002, "C02", utcDate(2026, 1, 6), "APPLE", 10, 1.2, 0.15, null],
    [1003, "C01", utcDate(2026, 1, 4), "KIWI", 2, 0.99, null, null],
  ],
};

const INVALID_SHEET: Sheet = {
  dateColumn: DATE_COLUMN,
  rows: [
    SHEET_HEADER,
    [8001, "C50", utcDate(2026, 8, 1), "A", 2, 1.5, null, null],
    [null, null, null, null, null, null, null, null],
    ["8002", "C50", "2026-08-01", "B", 2.5, 1, null, null],
    ["8003", "C51", utcDate(2026, 8, 2), "B", 1, "3.00", 0.25, null],
    ["8004", "C51", utcDate(2026, 8, 2), "C", 1, 19.999, null, null],
    ["8001", "C50", utcDate(2026, 8, 1), "A", 1, 1, null, null],
  ],
};

export const XLSX_FILES: Record<string, Sheet> = {
  [`${S2H}basic.xlsx`]: BASIC_SHEET,
  [`${S2H}invalid.xlsx`]: INVALID_SHEET,
  [`${S2H}missing-column.xlsx`]: {
    dateColumn: DATE_COLUMN,
    rows: [SHEET_HEADER.filter((name) => name !== "quantity")],
  },
  [`${S2H}noheader.xlsx`]: { dateColumn: DATE_COLUMN, rows: [] },
  [`${S2V}basic.xlsx`]: BASIC_SHEET,
};
