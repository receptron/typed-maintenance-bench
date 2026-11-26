# src — harness

```
yarn install && yarn build
yarn gen:fixtures       # rewrite every fixture from experiments/staged-growth/fixtures-src/
yarn check:reference    # self-test: the reference implementation must pass every hidden case in every arm and mode
yarn test               # unit tests for the pure parts
yarn bench --arm ts --mode cumulative --repeat r1 [--stages 1-2] [--agent claude|reference] [--auth api-key|subscription] [--model <id>]
yarn grade --tree results/.../stage-2/tree --arm ts --stage 2   # recompute a grade from a saved tree
yarn escapes <dir>      # count escape hatches in a tree
```

`yarn bench` with the default `claude` agent runs Claude Code with `--bare`, so the host's CLAUDE.md, hooks, plugins and memory do not leak into a run. In that mode Claude Code authenticates only with `ANTHROPIC_API_KEY`. To run on a logged-in Claude subscription instead, pass `--auth subscription` with `ANTHROPIC_API_KEY` unset: the agent then runs with `--safe-mode`, which skips the same host configuration.

| File | Job |
|---|---|
| `cases.ts`, `caseRunner.ts` | Case format, judging, running a case directory. Node built-ins only: copied into the agent's tree as the visible-test runner |
| `arms.ts` | Each arm's template, build, verify and run commands, and the notes inserted into the task |
| `tree.ts` | Build a work tree outside this repository: template, previous stage (cumulative) or reference (reset), visible tests, `TASK.md`, `yarn install`, a git baseline |
| `agents.ts` | `claude` (the agent under test) and `reference` (copies the reference implementation; for testing the harness) |
| `grade.ts` | Build, verify, then run the hidden cases of this stage and every earlier stage on a copy of the fixtures |
| `escapes.ts` | Count `any`, `as`, `<T>x`, `!`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` with the TypeScript parser |
| `runStage.ts`, `runCli.ts` | One stage end to end, writing `results/<experiment>/<arm>/<mode>/<repeat>/stage-<n>/` |
| `gradeCli.ts`, `escapesCli.ts`, `checkReference.ts` | The commands above |

Each run directory holds `meta.json` (settings, timings, harness commit, agent version), `agent.jsonl` (the transcript), `agent.stderr.log`, `diff.patch` (everything the agent changed), `grade.json`, `escapes.json` and `tree/` (the final tree without `node_modules`).

Not written yet: the log classifier (time spent writing types vs fixing type errors), fuzzing, mutation testing, Python arms.
