# Harness and hidden tests for stages 1–2

Issue: receptron/typed-maintenance-bench#2

## Decisions

- **Hidden tests are data, not code.** Each case is CLI arguments, environment and expected exit code / stdout / stderr, in `hidden-tests/cases.json`. The same file format and the same dependency-free runner serve the visible tests in the agent's tree, so every arm is graded by exactly the same thing and the grader never imports agent code.
- **Expectations are computed by hand**, not by running the reference. The reference implementation is then checked against them; a disagreement means one of the two is wrong and is resolved by reading the spec, never by copying the reference's output.
- **The task text pins everything a test checks**: column names, validity rules, integer-cent rounding, output layout, sort order, location format in warnings, exit codes, time-zone independence. A hidden test that checks something the task does not state is a bug in the test.
- **Adversarial cases test stated rules the visible tests do not exercise**: BOM, CRLF, quoted delimiters and newlines, numbers as strings, impossible dates, duplicates, YAML/XLSX date values read under a non-UTC `TZ`, non-UTF-8 input, header-only files.
- **Arms are configuration.** An arm defines its template, its build command, its check command and how the CLI is invoked. Task texts differ only through placeholders filled from the arm.
- **Work trees live outside this repository**, so the agent cannot read hidden tests or the reference.
- **Default agent is Claude Code in `--bare` mode** (no CLAUDE.md, hooks, plugins or memory from the host machine), so a run does not depend on whose machine it is on. It authenticates only with `ANTHROPIC_API_KEY`. A `reference` agent copies the reference implementation into the tree; it exists to test the harness end to end without spending tokens.
- **JS reference for reset mode is the TS reference compiled by `tsc`**, i.e. the same logic with types stripped.
- **Escape hatches are counted with the TypeScript parser**, not regexes: `any`, `as` (except `as const`), `<T>x`, non-null `!`, `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, `eslint-disable`.

## Steps

1. Task texts for stages 1–2, arm templates
2. Fixtures (generator for XLSX/YAML/JSON from one canonical dataset) and hand-computed cases
3. Reference implementations; check them against the cases
4. Harness: case runner, grader, escape counter, setup, runner
5. Unit tests for the pure parts; end-to-end run with the `reference` agent for every pilot arm in both modes
