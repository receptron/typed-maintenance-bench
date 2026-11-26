# experiments

One directory per experiment (see `docs/protocol.md`).

| Directory | Experiment | State |
|---|---|---|
| `staged-growth/` | C — one tool grown through seven stages | Stages 1–7 runnable for `js`, `ts`, `ts-noany` |
| `migration-findings/` | A — classify what a JS→TS migration surfaces | Not created |
| `bug-replay/` | B — would TS `strict` have flagged past bugs? | Not created |

## staged-growth layout

| Path | Contents |
|---|---|
| `stage-<n>/task.md` | Exactly what the agent receives, with `{{RUN}}`, `{{REPORT}}`, `{{ARM_NOTES}}` and `{{LIB}}` filled from the arm |
| `stage-<n>/visible-tests/` | Cases and fixtures copied into the agent's tree |
| `stage-<n>/hidden-tests/` | Cases and fixtures the agent never sees. Expectations are computed by hand from the fixture rows. `cases.json` drives the CLI and, from stage 5, the report tool (a case can expect the exact files in a directory); `api-cases.json` (stage 4 on) calls the library |
| `stage-6/hidden-tests/retired.json` | Earlier cases that assert the shapes stage 6 changes (the JSON output, records, aggregates). They are skipped from stage 6 on; stage 6 has new versions of them |
| `stage-7/bugs.json`, `plant.md`, `attachments/` | The seeded bugs (fixed text replacements in the stage 6 reference, and a description for planting them in an arm's own tree), the prompt for the planting session, and the files the bug reports refer to |
| `fixtures-src/cases_stage_<n>.py` | Writes the stage 3–7 case files from hand-computed rows; the layout rules follow `task.md` |
| `fixtures-src/` | Source of every fixture; `yarn gen:fixtures` writes them byte for byte |
| `templates/<arm>/` | Starting tree for stage 1: `package.json`, `tsconfig.json`, lint config |
| `reference/stage-<n>/` | A correct implementation, used to check the hidden cases and as the starting point in reset mode. The JS arm gets it compiled by `tsc` |

A hidden case may only check what `task.md` states. To confirm the cases can fail, break the reference on purpose (float money, local-time dates, locale sort, no duplicate check, wrong line counting, no UTF-8 check, no trimming) and check that each change makes a named case fail. For stages 3–4 the planted bugs are listed in `plans/feat-stages-3-4.md`, for stages 5–6 in `plans/feat-stages-5-7.md`.
