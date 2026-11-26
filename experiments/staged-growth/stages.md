# Stages — order-aggregation tool

Stages 1 and 2 are implemented: the binding text is `stage-1/task.md` and `stage-2/task.md`, and the hidden cases are in each stage's `hidden-tests/`. Stages 3–7 below are drafts.

## Data

An order record has: order id, customer id, order date, product SKU, quantity, unit price, optional discount, optional notes.

Adversarial fixtures used across stages: missing fields, `null`, empty strings, numbers written as strings (`"1,200"`, `"1.2e3"`), negative quantities, duplicated ids, dates in several formats, non-UTF-8 files, a header-only file, a very large file, a field containing the delimiter.

## Stage 1 — minimal CLI

Read a CSV of orders, aggregate revenue by day and by SKU, print a text table. Flags: input path, group-by key.

## Stage 2 — more input formats

Add JSON (array), JSONL, YAML and XLSX input, detected by extension or `--format`. All formats must yield the same aggregate for the same data. Malformed rows are reported with file and line, and skipped.

## Stage 3 — more outputs and a config file

Add Markdown, HTML and JSON output. Add a config file selecting group-by keys, filters (date range, SKU prefix) and output format; flags override the config.

## Stage 4 — library split

Split into a package with a public API: `read(source, options)`, `aggregate(records, spec)`, `render(result, format)`. The CLI becomes a thin consumer. The API is documented; the hidden tests call it directly.

## Stage 5 — composition

A second tool, a report sender, consumes the library: it builds a weekly report per customer and writes one file per customer. Input formats become plugins registered through the library; the task adds one new plugin (TSV).

## Stage 6 — breaking change

Money gains a currency (unit price becomes amount + currency; aggregates are per currency) and dates gain a time zone (day boundaries follow a configured zone). Every consumer — CLI, all renderers, the report sender, the plugins — must follow. Hidden fixtures exercise each consumer, so missed call sites are counted individually.

## Stage 7 — maintenance without context

A fresh session receives three bug reports written the way users write them (symptom, sample input, expected output), and nothing else. The bugs are seeded into the reference implementation in reset mode; in cumulative mode they are reports against behaviour the hidden tests already show to be wrong in that arm's tree, or seeded the same way if none exist.
