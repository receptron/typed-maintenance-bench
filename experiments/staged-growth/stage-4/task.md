# Task: split into a library

This repository contains an order aggregation CLI. Split it into a library with a public API, and make the CLI a thin consumer of that API. The CLI, `{{RUN}}`, must keep every option and behaviour exactly as before.

{{ARM_NOTES}}

## Entry point

The library's entry point is {{LIB}}. It exports three functions by name: `read`, `aggregate` and `render`. Other code will import it and call them, so their behaviour below is a contract. The CLI must be built on these functions.

The values the functions take and return are plain objects, arrays, strings and numbers, as described below. Objects have exactly the properties listed, no others.

## `read(source)`

Reads one input file and returns a promise of `{ records, warnings }`.

- `source` is an object `{ path, format }`. `path` is a string, relative to the current directory or absolute. `format` is optional and is one of `csv`, `json`, `jsonl`, `yaml`, `xlsx`; without it, the format comes from the extension, as in the CLI.
- `records` is an array of the valid records, after the duplicate rule, in the order they appear in the file. Each record is:

| Property | Value |
|---|---|
| `orderId`, `customerId`, `sku` | the text values, as strings |
| `orderDate` | the date as a `YYYY-MM-DD` string |
| `quantity` | the quantity, an integer |
| `unitPriceCents` | the unit price in cents, an integer |
| `discountPercent` | the discount × 100, an integer from 0 to 100; 0 when empty |
| `notes` | the notes as a string; `""` when empty |

- `warnings` is an array with one entry per invalid record, in file order: `{ file, location, reason }`. `file` is `path` exactly as given, `location` is the line number or `#<n>` index as a string (for example `"8"` or `"#7"`), exactly as in the CLI's warnings, and `reason` is free text.

## `aggregate(records, spec)`

Returns `{ groupBy, rows, totalCents }` for an array of records as `read` returns them.

- `spec` is an object `{ groupBy, from, to, skuPrefix }`. `groupBy` is required: an array of one to three distinct keys from `day`, `sku` and `customer`. `from`, `to` and `skuPrefix` are optional and work like `--from`, `--to` and `--sku-prefix`.
- `aggregate` sums every record it is given. The duplicate rule belongs to `read`.
- `groupBy` in the result is a copy of `spec.groupBy`. `rows` is an array of `{ key, revenueCents }`, where `key` is an array of strings, one per group-by key, sorted as in the CLI. `totalCents` is the sum of all rows. Revenue is computed per record and rounded per record, as in the CLI.

## `render(result, format)`

Returns, as a string, exactly what the CLI prints on stdout for that result with `--output <format>`. `format` is one of `text`, `markdown`, `html`, `json`.

## Errors

- **Wrong arguments** throw a `TypeError`, or for `read` reject with one: an argument of the wrong type, a missing required property, a property that is not listed above, an invalid value (an unknown format or group-by key, repeated keys, a date that is not a calendar date, `from` later than `to`), or a `path` whose extension does not name a format when `format` is absent.
- **Problems with the file or its content** make `read` reject with an `Error` whose `name` is `"ReadError"`: everything that is a fatal error for the CLI's input, such as a file that cannot be read, invalid JSON or YAML, or a missing column.

None of the functions may modify its arguments.

## Tests

`tests/visible/` holds example cases. Run them with:

```
node tests/runner/caseRunner.js tests/visible
node tests/runner/apiRunner.js tests/visible
```

Passing the visible cases is necessary but not sufficient. Your library and CLI will also be checked against further cases that follow the rules above, including all the rules of the earlier stages.
