# Task: a report tool and format plugins

This repository contains an order aggregation library and a CLI built on it. Add three things: a way to register input formats as plugins, a TSV format added through that mechanism, and a second tool that writes a weekly report per customer. The CLI, `{{RUN}}`, and every library function must keep working exactly as before.

{{ARM_NOTES}}

## Format plugins

The library's entry point, {{LIB}}, also exports `registerFormat(plugin)`. After a call, the format is available everywhere a format is chosen: `read`, `--format` and file extensions in the CLI, and the report tool below. It returns `undefined`.

`plugin` is an object with exactly these properties:

| Property | Value |
|---|---|
| `name` | the format name: one or more lowercase ASCII letters and digits, starting with a letter. It must not be the name of a format that is already registered |
| `extensions` | an array of distinct extensions, possibly empty, each a `.` followed by one or more lowercase ASCII letters and digits, such as `.tsv`. None may already belong to a registered format |
| `parse` | a function `parse(text)` |

The built-in formats count as registered: `csv`, `json`, `jsonl`, `yaml`, `xlsx` and their extensions from stage 2. Extensions still match ignoring case.

When a file in a plugin format is read, the library reads it, decodes it as UTF-8 (invalid UTF-8 is a fatal error, as for the other text formats), removes a leading byte-order mark and calls `parse` with the text. `parse` returns an array of entries, in file order:

- `{ location, fields }`: a record. `location` is a string used in warnings in place of the line number. `fields` is an object from field name to value, read with the rules for typed formats in stage 2: a string, a number or `null`, a missing field and `null` both meaning empty, and any other value making the record invalid.
- `{ location, problem }`: an invalid record, reported with `problem` as the reason.

Records from a plugin then follow every rule of the other formats: validity, the duplicate rule, warnings and the computation.

### Errors

- An argument to `registerFormat` that does not follow the table above throws a `TypeError`, and nothing is registered.
- If `parse` throws, or returns anything other than an array of such entries, the file has a problem: `read` rejects with a `ReadError`, and for the CLI and the report tool it is a fatal error.

## TSV

Add a `tsv` format with the extension `.tsv`, registered with `registerFormat` when the library is loaded, like any other plugin.

- UTF-8 text, lines ending with LF or CRLF. The first line is a header with the same column names as CSV.
- Fields are separated by a tab. There is no quoting: `"` is an ordinary character. Leading and trailing spaces of every field are removed.
- A record with fewer fields than the header is invalid. Lines that are completely empty are skipped silently.
- The location in warnings is the line number.
- A file with no header line, or a header missing a required column, is a fatal error.

## The report tool

```
{{REPORT}} --input <file> --out-dir <dir> [--format <name>]
```

`--input` and `--out-dir` are required. `--format` works as in the CLI, plugin formats included. Records are read exactly as by the CLI, and invalid records are reported on stderr in the same form.

For each customer with at least one valid record, the tool writes one file in `<dir>`, creating `<dir>` and its parents if needed. A file of the same name is replaced; other files in `<dir>` are left alone. Nothing is written on stdout.

**File name:** the `customer_id` with every UTF-8 byte that is not an ASCII letter, digit, `-` or `_` written as `%` and two uppercase hexadecimal digits, followed by `.txt`. For example `C/3` gives `C%2F3.txt` and `ü` gives `%C3%BC.txt`.

**Content:** tab-separated lines, each ending with LF:

```
customer	<customer_id>
week	revenue
<week>	<revenue>
...
TOTAL	<total>
```

- `<week>` is the ISO 8601 week of the record's `order_date`, written `YYYY-Www` (for example `2026-W09`). Weeks start on Monday and week 1 is the week with the year's first Thursday, so `YYYY` is the ISO week-numbering year, which can differ from the calendar year around 1 January.
- There is one line per week that has at least one of the customer's valid records, in ascending order. Revenue is the sum of each record's revenue as in the CLI, written with two decimals; `<total>` is the sum over the customer's weeks.

**Fatal errors** (exit code 2, a message on stderr, no files written): everything that is fatal for the CLI's input, a missing or unknown option or option value, and a `<dir>` that cannot be created.

The output must not depend on the machine's time zone or locale.

## Tests

`tests/visible/` holds example cases. Run them with:

```
node tests/runner/caseRunner.js tests/visible
node tests/runner/apiRunner.js tests/visible
```

Passing the visible cases is necessary but not sufficient. Your library and both tools will also be checked against further cases that follow the rules above, including all the rules of the earlier stages.
