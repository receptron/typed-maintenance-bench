# experiments

One directory per experiment (see `docs/protocol.md`).

| Directory | Experiment | State |
|---|---|---|
| `staged-growth/` | C — one tool grown through seven stages | Stages 1–2 runnable for `js`, `ts`, `ts-noany`; stages 3–7 drafted in `stages.md` |
| `migration-findings/` | A — classify what a JS→TS migration surfaces | Not created |
| `bug-replay/` | B — would TS `strict` have flagged past bugs? | Not created |

## staged-growth layout

| Path | Contents |
|---|---|
| `stage-<n>/task.md` | Exactly what the agent receives, with `{{RUN}}` and `{{ARM_NOTES}}` filled from the arm |
| `stage-<n>/visible-tests/` | Cases and fixtures copied into the agent's tree |
| `stage-<n>/hidden-tests/` | Cases and fixtures the agent never sees. Expectations are computed by hand from the fixture rows |
| `fixtures-src/` | Source of every fixture; `yarn gen:fixtures` writes them byte for byte |
| `templates/<arm>/` | Starting tree for stage 1: `package.json`, `tsconfig.json`, lint config |
| `reference/stage-<n>/` | A correct implementation, used to check the hidden cases and as the starting point in reset mode. The JS arm gets it compiled by `tsc` |

A hidden case may only check what `task.md` states. To confirm the cases can fail, break the reference on purpose (float money, local-time dates, locale sort, no duplicate check, wrong line counting, no UTF-8 check, no trimming) and check that each change makes a named case fail.
