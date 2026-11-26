# Stages 5–7: a second tool and plugins, a breaking change, maintenance without context

Issue: receptron/typed-maintenance-bench#7

## Why

Stages 1–4 do not separate the arms on correctness: every pilot run passed every case. H2 is about what happens when existing code has to change shape and when someone maintains code they did not write. Stages 5–7 are those situations: a second consumer and a plugin contract (stage 5), a change to the data shapes that every consumer must follow (stage 6), and bug reports handed to a fresh session (stage 7).

## Stage 5 decisions

- **Plugins**: the library exports `registerFormat({ name, extensions, parse })`. `parse(text)` gets the file decoded as UTF-8 with a leading BOM removed and returns entries `{ location, fields }` or `{ location, problem }`. Fields follow the typed-format rules of stage 2, and the duplicate rule applies as for every format. A bad plugin argument, or a name or extension that is already taken, is a `TypeError`; `parse` throwing or returning the wrong shape makes `read` reject with a `ReadError`.
- **TSV** is added as a plugin, registered when the library loads, and is then available to `read`, the CLI and the report tool by name (`tsv`) and extension (`.tsv`). No quoting; a short line is an invalid record; a missing column is fatal.
- **Report tool**: `--input`, `--out-dir`, optional `--format`. One file per customer with valid records, named by percent-encoding every UTF-8 byte outside `A–Z a–z 0–9 - _` (so `/` and `.` cannot leave the directory). Content: revenue per ISO 8601 week, then a total. Fixtures cross a year boundary where the ISO week-year differs from the calendar year.
- **Harness**: CLI cases can name the report tool and expect the exact set of files in a directory; the runner deletes that directory before the case. API cases can register plugins built by the worker from a name (`pipe`, `typed`, `throws`, `bad-return`), since a case file cannot hold a function.
- Customer ids that differ only by case are avoided in fixtures: the grader runs on case-insensitive file systems too.

## Stage 6 decisions

- **Currency**: an optional `currency` column, empty or absent meaning `USD`, otherwise three uppercase letters. Amounts in different currencies are never added. A row is a (key, currency) pair; there is one `TOTAL` line per currency.
- **Compatibility of human-readable outputs**: a USD amount is written as before and any other amount as `<amount> <code>`, so `text`, `markdown`, `html` and the reports of an all-USD input are unchanged. `json` is for programs and always states the currency, so its shape changes.
- **Time zones**: `order_date` may also be a timestamp with `Z` or an offset. Its day is the calendar date of that instant in the configured zone (`--time-zone`, config `timeZone`, default `UTC`), for grouping, filters and report weeks alike. A plain date is that day in every zone. Fixtures cross a daylight-saving change and use an offset with minutes.
- **API breaks**: a record's `unitPriceCents` becomes `unitPrice: { cents, currency }`; `aggregate` takes `timeZone` and returns rows with a `currency` and `totals` per currency instead of `totalCents`. `render` takes that shape.
- **Retired cases**: the earlier cases whose expected output is the old JSON shape or the old API shapes are listed in `stage-6/hidden-tests/retired.json` and skipped from stage 6 on; stage 6 has new versions of them. Every other earlier case keeps running.
- Case ids name the consumer (`s6-cli-…`, `s6-report-…`, `s6-api-…`, `s6-tsv-…`), so a consumer that still uses the old shape shows up by name.

## Stage 7 decisions

- **Three bug reports**, written as users write them (symptom, sample input, expected output), in an area each that earlier hidden cases leave open: TSV files with CRLF line ends lose the currency in the last column; report file names for non-ASCII customer ids are not percent-encoded byte by byte; `--time-zone` does not override `timeZone` from the config file.
- **Seeding**: in reset mode, and for the reference agent, the bugs are planted by fixed text replacements in the stage 6 reference (`stage-7/seeded-bugs.json`). In cumulative mode the arm's own code differs per run, so a separate agent session plants them from behaviour descriptions (`stage-7/plant.md`) before the maintainer's session starts.
- **Checking the seeding**: the stage 7 hidden cases of each bug run before and after planting. A bug whose cases already fail is native and is not planted. `seed.json` records, per bug, whether it was native, planted or failed to plant, plus any earlier case that the planting broke and whether build and verify still pass. The planting session's transcript and diff are kept next to it.
- The maintainer gets only the bug reports and the tree, with no git history and no visible tests.
- The stage 7 reference is the stage 6 reference.

## Steps

1. Harness: report command, file expectations, plugin cases, retired cases, stage range up to 7
2. Stage 5: task text, fixtures, cases, reference
3. Stage 6: task text, fixtures, cases, reference, retired list
4. Stage 7: bug reports, seeded bugs, planting prompt, seeding and its check
5. Self-test (`yarn check:reference`) and the planted-bug check for stages 5–6
6. Trial run over stages 1–7

## Planted bugs

Each was planted alone in the reference; the hidden cases of every stage up to that one ran against it, and each made at least one named case fail unless noted.

- **Stage 5:** a short TSV line accepted; empty TSV lines kept; TSV locations off by one; quotes stripped in TSV; the byte-order mark kept for plugins (and invalid UTF-8 accepted); a plugin's `problem` replaced by an empty record; a plugin error passed through instead of a `ReadError`; a taken name, a taken extension, an uppercase name or an extra plugin property accepted; ISO weeks numbered by the calendar year; weeks starting on Sunday; `.` kept in file names; lowercase hexadecimal in file names; report weeks out of order; `--format` ignored by the report tool.
- The first run missed two: every short TSV line in the fixtures also lacked a required field, so it was invalid for another reason (a fixture now lacks only optional fields), and plugin reasons were not checked although the task says the reason is the plugin's `problem` (now checked). Taking the weekday from local midnight of the same date was not caught and cannot be: it gives the same weekday.
- **Stage 6:** an empty currency not read as USD; a lowercase currency accepted; USD written with its code; a timestamp without an offset accepted; offset minutes ignored; the offset sign inverted; days always in UTC; days in the machine's zone; filters on the raw date text; rows not split by currency; currencies sorted descending; one `TOTAL` row in HTML; JSON totals with the code; the report tool ignoring `--time-zone`; an overridden config time zone not checked; an unknown API time zone falling back to UTC; `orderDate` cut to the date.
- **Stage 7:** the seeded bugs themselves; each makes only its own stage 7 cases fail (checked with each bug alone and with all three).
