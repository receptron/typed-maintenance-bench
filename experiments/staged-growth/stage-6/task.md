# Task: currencies and time zones

This repository contains an order aggregation library, a CLI and a report tool built on it, and a TSV format plugin. Orders now come in several currencies, and order dates may be timestamps from different time zones. Change the library, both tools and the plugin so that every part follows the rules below. Behaviour that these rules do not change must stay exactly as before.

{{ARM_NOTES}}

The tools are run as `{{RUN}}` and `{{REPORT}}`; the library's entry point is {{LIB}}.

## Records

Two things change in what a record is. Everything else about reading, validity, the duplicate rule and warnings stays as it is.

### Currency

Every input format may carry a new column or field, `currency`. Empty or absent means `USD`. Otherwise, after the usual trimming, it must be exactly three uppercase ASCII letters, such as `EUR` or `JPY`; anything else makes the record invalid. Prices keep two decimal places in every currency.

A record's revenue is computed as before, in the record's currency. **Amounts in different currencies are never added together.**

### Order dates and time zones

`order_date` may still be a `YYYY-MM-DD` calendar date. It may now also be a timestamp:

```
YYYY-MM-DDTHH:MM[:SS]Z
YYYY-MM-DDTHH:MM[:SS]±HH:MM
```

The date must be a calendar date, the hour 00–23, the minutes and seconds 00–59, and the offset's hours 00–23 and minutes 00–59. `T` and `Z` are uppercase. A timestamp without `Z` or an offset is invalid, as is anything else that is neither a date nor a timestamp.

Each record has a **day**. For a calendar date, the day is that date. For a timestamp, the day is the calendar date of that instant in the configured time zone. The time zone is an IANA time zone name such as `UTC`, `Asia/Tokyo` or `America/New_York`, and the default is `UTC`. Daylight saving time follows the zone's rules.

The day is used everywhere a date was used before: grouping by `day`, `--from` and `--to`, and the report tool's weeks. XLSX date cells and YAML dates stand for their calendar date, as before.

## Amounts in the outputs

An amount in USD is written as before, for example `12.34`. An amount in any other currency is written with a space and the code: `12.34 EUR`. So the output for an input that is all USD does not change, except in JSON (below).

## The CLI

New option, also available as the config file key `timeZone` (a string), with the same rules as every other setting:

```
--time-zone <name>
```

An unknown time zone is a fatal error, whether it comes from the option or the config file.

**Rows.** A row is now a key and a currency: there is one row for each key and currency that have records. Rows are sorted by key as before; rows with the same key are sorted by currency code in code point order.

**Totals.** There is one `TOTAL` line per currency that appears in the rows, in currency code order, with the same layout as before. With no rows there is a single `TOTAL` line with `0.00`, as before. In `html`, each `TOTAL` line is its own `<tr>` in `<tfoot>`.

**JSON.** The `json` output is for programs, so it always states the currency and no longer has `total`:

```
{"groupBy":["k1",…],"rows":[{"key":["<key 1>",…],"currency":"<code>","revenue":"<amount>"},…],"totals":[{"currency":"<code>","total":"<amount>"},…]}
```

Amounts here have no code after them. With no rows, `rows` and `totals` are both empty arrays.

## The report tool

New option `--time-zone <name>`, as in the CLI. A file's lines are now one per week and currency that have records, sorted by week and then by currency code, followed by one `TOTAL` line per currency in currency code order. Amounts are written as in the CLI.

## The library

### `read(source)`

A record now has `unitPrice`, an object `{ cents, currency }`, in place of `unitPriceCents`. `orderDate` is the `order_date` value as text after trimming: a `YYYY-MM-DD` date (also for XLSX and YAML dates) or the timestamp exactly as written.

| Property | Value |
|---|---|
| `orderId`, `customerId`, `sku` | the text values, as strings |
| `orderDate` | the date or timestamp, as a string |
| `quantity` | the quantity, an integer |
| `unitPrice` | `{ cents, currency }`: the unit price in cents, an integer, and the currency code |
| `discountPercent` | the discount × 100, an integer from 0 to 100; 0 when empty |
| `notes` | the notes as a string; `""` when empty |

### `aggregate(records, spec)`

`spec` may also have `timeZone`, a string; an unknown time zone is a `TypeError`. The result is now:

```
{ groupBy, rows: [{ key, currency, revenueCents }, …], totals: [{ currency, cents }, …] }
```

with `rows` and `totals` sorted as in the CLI. `totalCents` is gone.

### `render(result, format)`

Takes the result in this shape and returns exactly what the CLI prints.

### Plugins

The plugin contract does not change. A plugin's `fields` may carry `currency` like any other field.

## Tests

`tests/visible/` holds example cases. Run them with:

```
node tests/runner/caseRunner.js tests/visible
node tests/runner/apiRunner.js tests/visible
```

Passing the visible cases is necessary but not sufficient. Your library and both tools will also be checked against further cases that follow the rules above, including all the rules of the earlier stages that these rules leave unchanged.
