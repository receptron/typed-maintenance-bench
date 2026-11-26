# Stages 3–4: more outputs and a config file, then a library split

Issue: receptron/typed-maintenance-bench#5

## Why

Stages 1–2 do not separate the arms on correctness (every pilot run passed every case). Stages 3–4 are the first where a contract has to be kept across several moving parts: option combinations and a config file (stage 3), then a public API that other code calls (stage 4).

## Stage 3 decisions

- **Group-by takes one to three distinct keys** (`--group-by day,sku`). Rows are sorted by comparing keys component by component, in code point order. A fixture has the SKUs `A` and `A-1`, so joining the components with a separator that sorts above `-` gives a different order and fails.
- **Filters** `--from`, `--to` (inclusive calendar dates) and `--sku-prefix` (case-sensitive) apply to valid records **after** the duplicate rule. A fixture has a duplicate whose first occurrence is outside the date range, so filtering first and deduplicating second accepts it and fails.
- **Outputs** `text` (stage 1 layout, generalised), `markdown`, `html` (a `<table>` fragment) and `json` (compact, revenues as two-decimal strings). Each has exactly one escaping rule, and every rule is exercised: `|` in Markdown; `& < > " '` in HTML; JSON's own string escaping.
- **Config file**: a JSON object with optional `groupBy`, `format`, `output`, `from`, `to`, `skuPrefix`. A flag overrides the same setting in the config. Unknown keys, wrong types and invalid values are fatal, as are an unreadable file, invalid JSON and a top-level value that is not an object.
- Nothing is tested that the task does not state. Repeating an option, for example, is left unspecified and untested.

## Stage 4 decisions

- **API**: `read(source)` (async), `aggregate(records, spec)`, `render(result, format)`; plain objects and arrays only, so results compare as JSON. `render` returns exactly what the CLI prints.
- **Two error kinds**: wrong arguments give a `TypeError`; a problem with the file or its content gives an `Error` named `ReadError`. Either may be thrown or returned as a rejected promise.
- **Inputs are not modified**: the API runner compares every argument before and after the call.
- **Entry point** is fixed per arm (`src/index.js`, or `src/index.ts` compiled to `dist/index.js`), like the CLI entry point.
- **API cases are data** (`api-cases.json`), run one per child process by a runner that uses only Node built-ins and ships into the tree like the CLI case runner. A case is a call, its arguments and either the expected JSON return value (with `{"$anyString": true}` for free-text reasons) or the expected error kind.
- The CLI cases of stages 1–3 keep running at stage 4.

## Expectations

Computed by hand from small fixtures, as for stages 1–2, then checked against the reference; a disagreement is resolved by reading the task text.

## Steps

1. Stage 3: task text, fixtures, visible and hidden cases, reference
2. Harness: API case format, runner and grading; stage range up to 4
3. Stage 4: task text, fixtures, visible and hidden API cases, reference
4. Self-test (`yarn check:reference`) and planted-bug check for both stages
5. Pilot over stages 1–4

## Planted bugs

Each was planted alone in the reference; the hidden cases of every stage up to that one ran against it, and each made at least one named case fail.

- **Stage 3:** filtering before the duplicate rule; sorting by keys joined with `|`; no `|` escape in Markdown; no `'` escape in HTML; JSON revenue as a number; config overriding flags; an unknown config key ignored; `--from` exclusive; the date filter in local time; the text `TOTAL` row without empty fields; a case-insensitive SKU prefix; repeated group-by keys accepted; empty group-by items dropped; a string `groupBy` in the config accepted; a blank line in an empty HTML `<tbody>`.
- **Stage 4:** an extra property on records; `notes` dropped; no duplicate rule in `read`; `TypeError` instead of `ReadError` for file problems; an unknown `source` property accepted; `aggregate` sorting its input in place; `aggregate` applying the duplicate rule; rounding the sum instead of each record; `render` defaulting to `text`; `#` dropped from locations; `ReadError` without its name; `from` later than `to` accepted; `ReadError` instead of `TypeError` for an unknown extension; an unknown `spec` property accepted; an empty `groupBy` in the result.
- Two first attempts at stage-4 bugs (`notes` missing from records, `location` as a number) did not compile against the reference's own types, so they were rewritten in a form that compiles.
- The first stage-3 run missed the unknown-key bug: that case's config had no `groupBy`, so it was fatal for another reason. The case now passes `--group-by`.
