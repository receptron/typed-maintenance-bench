// Stage 3–4 fixture contents. As in data.ts, expected outputs are computed by
// hand from these rows and live in each stage's cases.json / api-cases.json.

const HEADER = "order_id,customer_id,order_date,sku,quantity,unit_price,discount,notes";
const S3H = "stage-3/hidden-tests/fixtures/";
const S3V = "stage-3/visible-tests/fixtures/";
const S4H = "stage-4/hidden-tests/fixtures/";
const S4V = "stage-4/visible-tests/fixtures/";

// Line 8 duplicates line 2 on a later date, so it stays a duplicate when --from excludes line 2.
// SKUs A and A-1 order differently component by component than joined with a separator above "-".
export const ORDERS_CSV = [
  HEADER,
  "1,C1,2026-03-01,A-1,2,10.00,,",
  "2,C2,2026-03-01,B|x,1,5.50,0.10,",
  "3,C1,2026-03-02,A-1,3,1.25,,",
  `4,C'3,2026-03-02,"<b>&""q""",1,7.00,,`,
  "5,C2,2026-03-03,A-2,1,0.99,0.5,",
  "6,C1,2026-03-03,ß,4,2.50,,gift wrap",
  "1,C9,2026-03-04,A-1,1,100.00,,",
  "7,C3,2026-03-04,A-1,1,abc,,",
  "8,C2,2026-03-05,B|x,2,3.00,,",
  "9,C1,2026-03-05,A,1,1.00,,",
  "",
].join("\n");

const COLUMNS = HEADER.split(",");

export const ORDERS_JSON = `${JSON.stringify(
  [
    ["1", "C1", "2026-03-01", "A-1", "2", "10.00", "", ""],
    ["2", "C2", "2026-03-01", "B|x", "1", "5.50", "0.10", ""],
    ["3", "C1", "2026-03-02", "A-1", "3", "1.25", "", ""],
    ["4", "C'3", "2026-03-02", '<b>&"q"', "1", "7.00", "", ""],
    ["5", "C2", "2026-03-03", "A-2", "1", "0.99", "0.5", ""],
    ["6", "C1", "2026-03-03", "ß", "4", "2.50", "", "gift wrap"],
    ["1", "C9", "2026-03-04", "A-1", "1", "100.00", "", ""],
    ["7", "C3", "2026-03-04", "A-1", "1", "abc", "", ""],
    ["8", "C2", "2026-03-05", "B|x", "2", "3.00", "", ""],
    ["9", "C1", "2026-03-05", "A", "1", "1.00", "", ""],
  ].map((values) => Object.fromEntries(COLUMNS.map((column, index) => [column, values[index]]))),
  null,
  2,
)}\n`;

const CONFIGS: Record<string, string> = {
  "cfg-sku-markdown.json": '{"groupBy": ["sku"], "output": "markdown"}\n',
  "cfg-range.json": '{"groupBy": ["day"], "from": "2026-03-02", "to": "2026-03-03"}\n',
  "cfg-format.json": '{"groupBy": ["day"], "format": "csv"}\n',
  "cfg-prefix.json": '{"groupBy": ["sku"], "skuPrefix": "A"}\n',
  "cfg-all.json":
    '{"groupBy": ["customer", "day", "sku"], "output": "json", "from": "2026-03-01", "to": "2026-03-05", "skuPrefix": ""}\n',
  "cfg-empty.json": "{}\n",
  "bad-unknown-key.json": '{"groupby": ["day"]}\n',
  "bad-groupby-string.json": '{"groupBy": "day"}\n',
  "bad-groupby-empty.json": '{"groupBy": []}\n',
  "bad-groupby-dup.json": '{"groupBy": ["day", "day"]}\n',
  "bad-groupby-key.json": '{"groupBy": ["week"]}\n',
  "bad-output.json": '{"groupBy": ["day"], "output": "pdf"}\n',
  "bad-format.json": '{"groupBy": ["day"], "format": "pdf"}\n',
  "bad-from-type.json": '{"groupBy": ["day"], "from": 20260301}\n',
  "bad-from-date.json": '{"groupBy": ["day"], "from": "2026-02-30"}\n',
  "bad-syntax.json": '{"groupBy": [\n',
  "bad-array.json": '[{"groupBy": ["day"]}]\n',
};

const prefixed = (prefix: string, files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([name, content]) => [`${prefix}${name}`, content]));

export const STAGE_3_4_FILES: Record<string, string> = {
  ...prefixed(S3H, { "orders.csv": ORDERS_CSV, "orders.data": ORDERS_CSV, "orders.json": ORDERS_JSON, ...CONFIGS }),
  ...prefixed(S3V, { "orders.csv": ORDERS_CSV, "cfg-sku-markdown.json": CONFIGS["cfg-sku-markdown.json"] ?? "" }),
  ...prefixed(S4H, {
    "orders.csv": ORDERS_CSV,
    "orders.data": ORDERS_CSV,
    "orders.json": ORDERS_JSON,
    "syntax.json": '[{"order_id": "1",',
    "missing-column.csv": "order_id,customer_id,order_date,sku,unit_price\n1,C1,2026-03-01,A,1.00\n",
  }),
  ...prefixed(S4V, { "orders.csv": ORDERS_CSV }),
};
