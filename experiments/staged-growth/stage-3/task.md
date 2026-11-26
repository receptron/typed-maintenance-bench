# Task: more outputs and a config file

This repository contains an order aggregation CLI that reads CSV, JSON, JSONL, YAML and XLSX. Extend it with more output formats, grouping by several keys, filters, and a config file. Everything the tool already does must keep working exactly as before when none of the new options is used.

{{ARM_NOTES}}

## Invocation

```
{{RUN}} --input <file> [--group-by <keys>] [--format <csv|json|jsonl|yaml|xlsx>]
    [--output <text|markdown|html|json>] [--from <date>] [--to <date>] [--sku-prefix <prefix>]
    [--config <file>]
```

- `--group-by` is a comma-separated list of one to three distinct keys from `day`, `sku` and `customer`, for example `day,sku`. Empty items (`day,`) and repeated keys (`day,day`) are fatal errors. It is required unless the config file gives it.
- `--output` defaults to `text`.
- `--from` and `--to` are `YYYY-MM-DD` calendar dates and are inclusive. A value that is not a real calendar date, or a `--from` later than `--to`, is a fatal error.
- `--sku-prefix` keeps only records whose `sku` starts with the given text, case-sensitively. An empty prefix keeps every record.
- `--config` names a config file, relative to the current directory or absolute.

## Records, filters and grouping

Reading, validity, the duplicate rule, warnings and the revenue of each record are unchanged. Filters apply to valid records **after** the duplicate rule: a record is a duplicate if its (`order_id`, `sku`) pair appeared in an earlier valid record, whether or not that earlier record passes the filters. Invalid records are reported on stderr whether or not they would pass the filters.

A row's key is the tuple of the record's values for the `--group-by` keys, in the order given. Revenue is summed per key. Rows are sorted by comparing keys component by component: the first components in ascending Unicode code point order, then, where they are equal, the second, and so on.

## Output

Revenue is written in units with exactly two decimals, as before. Below, `k1 … kn` are the `--group-by` keys in the order given, and every output ends with a line feed.

### `text`

Tab-separated, as before, one column per key:

```
k1	…	kn	revenue
<key 1>	…	<key n>	<revenue>
TOTAL	<n − 1 empty fields>	<total>
```

With a single key this is exactly the stage 1 output.

### `markdown`

A table. Every `|` in a key is written as `\|`. No other character is changed.

```
| k1 | … | kn | revenue |
|---|…|---|---:|
| <key 1> | … | <key n> | <revenue> |
| TOTAL |  | … |  | <total> |
```

Each line is `| ` followed by its cells joined with ` | ` and then ` |`, so an empty cell appears as `|  |`. The separator line has `---` for each key column and `---:` for the revenue column.

### `html`

A table fragment, one element per line:

```
<table>
<thead>
<tr><th>k1</th>…<th>kn</th><th>revenue</th></tr>
</thead>
<tbody>
<tr><td><key 1></td>…<td><key n></td><td><revenue></td></tr>
</tbody>
<tfoot>
<tr><td>TOTAL</td><td></td>…<td></td><td><total></td></tr>
</tfoot>
</table>
```

In keys, `&` `<` `>` `"` and `'` are written as `&amp;` `&lt;` `&gt;` `&quot;` and `&#39;`. With no rows, `<tbody>` is followed directly by `</tbody>` on the next line.

### `json`

One line: compact JSON with no spaces outside strings, keys in this order, revenues as strings:

```
{"groupBy":["k1",…],"rows":[{"key":["<key 1>",…],"revenue":"<revenue>"},…],"total":"<total>"}
```

Strings are written as JSON writes them (`"` as `\"`, `\` as `\\`, control characters escaped); every other character, including non-ASCII, is written as itself.

## Config file

A JSON object (UTF-8) with any of these keys:

| Key | Value | Same as |
|---|---|---|
| `groupBy` | a non-empty array of distinct keys, at most three | `--group-by` |
| `format` | a string | `--format` |
| `output` | a string | `--output` |
| `from` | a string | `--from` |
| `to` | a string | `--to` |
| `skuPrefix` | a string | `--sku-prefix` |

Values follow the same rules as the options. A flag overrides the same setting in the config file; settings the flags do not give come from the config file.

## Fatal errors (exit code 2, nothing on stdout)

Everything fatal before stays fatal. In addition:

- an invalid `--group-by`, `--output`, `--from` or `--to` value, or a `--from` later than `--to`
- no group-by keys from either the flags or the config file
- a config file that cannot be read, is not valid JSON, or whose top-level value is not an object
- a config file with an unknown key, a value of the wrong type, or an invalid value

The output must not depend on the machine's time zone or locale.

## Tests

`tests/visible/` holds example cases. Run them with:

```
node tests/runner/caseRunner.js tests/visible
```

Passing the visible cases is necessary but not sufficient. Your tool will also be checked against further cases that follow the rules above, including all the rules of the earlier stages.
