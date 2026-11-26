# Task: more input formats

This repository contains an order aggregation CLI that reads CSV. Extend it to read four more formats. Everything the tool already does for CSV must keep working exactly as before.

Write the tool in JavaScript (ES modules) for Node.js 22 or later. You may add npm packages with `yarn add`. The entry point is `src/cli.js`.

## Invocation

```
node src/cli.js --input <file> --group-by <day|sku|customer> [--format <csv|json|jsonl|yaml|xlsx>]
```

Without `--format`, the format comes from the file extension, ignoring case:

| Extension | Format |
|---|---|
| `.csv` | `csv` |
| `.json` | `json` |
| `.jsonl`, `.ndjson` | `jsonl` |
| `.yaml`, `.yml` | `yaml` |
| `.xlsx` | `xlsx` |

`--format` overrides the extension. Any other extension without `--format`, or an unknown `--format` value, is a fatal error.

## Formats

Every format carries the same fields as the CSV columns (`order_id`, `customer_id`, `order_date`, `sku`, `quantity`, `unit_price`, `discount`, `notes`), and the validity rules, duplicate rule, computation and output are the same as for CSV. Other fields are ignored.

| Format | Structure | Location in warnings |
|---|---|---|
| `json` | One JSON value: an array of objects | `#<n>`, the 1-based index in the array |
| `jsonl` | One JSON object per line. Empty lines are skipped silently | the 1-based line number |
| `yaml` | One YAML document: a sequence of mappings | `#<n>`, the 1-based index in the sequence |
| `xlsx` | The first worksheet. Row 1 is the header, as in CSV. Rows with no values are skipped silently | the 1-based row number |

So a warning is `<file>:<line>: <reason>` for `csv`, `jsonl` and `xlsx`, and `<file>:#<n>: <reason>` for `json` and `yaml`.

### Values in typed formats

In `json`, `jsonl`, `yaml` and `xlsx`, a field may hold a string or a number. A missing field and a null are both "empty".

- A **string** follows the same rules as the CSV text, with spaces and tabs trimmed.
- A **number** is read as its shortest decimal form: `19.99` is `19.99` and `3` is `3`. It must then meet the column's rule. For example, the number `2.5` as a quantity is invalid, and the number `19.999` as a unit price is invalid.
- A number in a text column (`order_id`, `customer_id`, `sku`) stands for its decimal form: the number `1001` is the id `1001`.
- An **`order_date`** may also be a YAML date (`2026-01-05` without quotes) or an XLSX date cell. Either one stands for that calendar date.
- Booleans, objects and arrays are invalid in every field, `notes` included: in these formats `notes` may be a string, a number or empty.

An element of a `json` array or `yaml` sequence that is not an object or mapping is an invalid record. So is a `jsonl` line that is not a valid JSON object.

### Fatal errors (exit code 2, nothing on stdout)

Everything fatal for CSV stays fatal. In addition:

- a `json` file that is not valid JSON, or whose top-level value is not an array
- a `yaml` file that is not valid YAML, or whose top-level value is not a sequence
- an `xlsx` file that cannot be opened as a workbook, or whose first worksheet has no header row
- an `xlsx` header that is missing a required column
- a `csv`, `json`, `jsonl` or `yaml` file that is not valid UTF-8 (a leading byte-order mark is still allowed)

The output must not depend on the machine's time zone or locale.

## Tests

`tests/visible/` holds example cases. Run them with:

```
node tests/runner/caseRunner.js tests/visible
```

Passing the visible cases is necessary but not sufficient. Your tool will also be checked against further cases that follow the rules above, including all the CSV rules.
