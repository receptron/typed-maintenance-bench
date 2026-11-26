# Task: order aggregation CLI

Build a command-line tool that reads a CSV file of order lines and prints revenue aggregated by a key.

Write the tool in TypeScript for Node.js 22 or later. You may add npm packages with `yarn add`. The entry point is `src/cli.ts`; `yarn build` compiles it to `dist/cli.js`. `yarn verify` runs the type checker and must pass. Do not weaken `tsconfig.json`.

## Invocation

```
node dist/cli.js --input <file> --group-by <day|sku|customer>
```

Both options are required. `<file>` is a path, relative to the current directory or absolute.

## Input

UTF-8 text. A leading UTF-8 byte-order mark is ignored. Lines end with LF or CRLF.

The first line is a header. Records follow RFC 4180: a field may be wrapped in double quotes, and a quoted field may contain commas, line breaks and doubled double quotes (`""` stands for `"`). After unquoting, leading and trailing spaces and tabs of every field are removed.

The header must contain these column names, in any order. Other columns are ignored.

| Column | Required value | Rule |
|---|---|---|
| `order_id` | yes | non-empty |
| `customer_id` | yes | non-empty |
| `order_date` | yes | `YYYY-MM-DD`, and a real calendar date |
| `sku` | yes | non-empty |
| `quantity` | yes | an integer ≥ 1, digits only |
| `unit_price` | yes | a decimal ≥ 0 with at most 2 digits after the point: `12`, `12.5`, `12.50`. No sign, thousands separators or currency symbols |
| `discount` | no | empty, or a decimal from 0 to 1 inclusive with at most 2 digits after the point: `0`, `0.15`, `1` |
| `notes` | no | anything |

A record is **invalid** if any rule fails, if it has fewer fields than the header, or if the pair (`order_id`, `sku`) already appeared in an earlier valid record. Lines that are completely empty are skipped silently and are not records.

## Computation

Work in integer cents. For each valid record:

```
line_revenue_cents = round_half_up(unit_price_cents × quantity × (100 − discount_percent) / 100)
```

where `discount_percent` is the discount × 100 (an integer from 0 to 100) and an empty discount is 0. Sum `line_revenue_cents` per key:

| `--group-by` | Key |
|---|---|
| `day` | `order_date` |
| `sku` | `sku` |
| `customer` | `customer_id` |

## Output

On stdout, tab-separated, one line per row, each ending with LF:

```
<group-by>	revenue
<key>	<revenue>
...
TOTAL	<sum of all revenue>
```

- The header's first field is the `--group-by` value (`day`, `sku` or `customer`).
- Keys are sorted in ascending Unicode code point order.
- Revenue is written in units with exactly two decimals: 1234 cents is `12.34`, 5 cents is `0.05`.
- With no valid records, the output is the header and `TOTAL	0.00`.

## Errors

- **Invalid record:** skip it, continue, and write one line to stderr: `<file>:<line>: <reason>`. `<file>` is the `--input` value exactly as given. `<line>` is the 1-based line number on which the record starts. `<reason>` is free text. The exit code stays 0.
- **Fatal errors:** write a message to stderr, write nothing to stdout, and exit with code 2. These are: a missing or unknown option or option value, a file that cannot be read, a file with no header line, and a header missing a required column.

The output must not depend on the machine's time zone or locale.

## Tests

`tests/visible/` holds example cases. Run them with:

```
node tests/runner/caseRunner.js tests/visible
```

Passing the visible cases is necessary but not sufficient. Your tool will also be checked against further cases that follow the rules above.
