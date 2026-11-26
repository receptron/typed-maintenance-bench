# Protocol

The design of the staged-growth experiment, and two smaller experiments that use the same harness. This file is the thing to argue with before anything is run.

## 1. Experiments

| ID | Name | Question | Directory |
|---|---|---|---|
| C | Staged growth (main) | Do typed arms pull ahead as one tool is extended, split, combined, changed and maintained? | `experiments/staged-growth/` |
| A | Migration findings | When an agent migrates a mature JS codebase to TS `strict`, how many of the type errors it hits are real bugs? | `experiments/migration-findings/` (not yet created) |
| B | Bug replay | What share of a project's past bug fixes would TS `strict` have flagged before the fix? | `experiments/bug-replay/` (not yet created) |

C is the one that tests the claim directly. A and B measure the benefit side on existing code.

## 2. Experiment C — staged growth

### 2.1 Subject

One tool, an order-aggregation CLI, grown through seven stages. Each stage has a written task (what a user would ask for), hidden tests, and adversarial fixtures. See `experiments/staged-growth/stages.md`.

The domain is chosen because it is boring: no algorithmic difficulty, so differences come from keeping data shapes consistent, which is what types are for.

### 2.2 Arms

| Arm ID | Language | Checking | Escape hatches |
|---|---|---|---|
| `js` | JavaScript | none | n/a |
| `js-checkjs` | JavaScript + JSDoc | `tsc --checkJs --noEmit` | allowed |
| `ts` | TypeScript | `tsc --strict` | allowed |
| `ts-noany` | TypeScript | `tsc --strict` + lint banning `any`, `as`, `@ts-ignore`, `@ts-expect-error` | banned |
| `py` | Python | none | n/a |
| `py-hints` | Python + annotations | none | n/a |
| `py-pyright` | Python + annotations | `pyright --strict` | allowed |
| `py-noany` | Python + annotations | `pyright --strict` + ban on `Any`, `cast`, `# type: ignore` | banned |

An optional variant of each checked arm runs the checker in a post-edit hook, so the agent sees errors without choosing to run the tool. Evil Martians observed that agents ignored language-server tools until a hook forced them.

What is held equal across arms: model and version, harness and version, system prompt, task text (only the language name and the check command differ), time and token budgets, test runner, starting fixtures.

### 2.3 Modes

- **Cumulative.** Stage *n* starts from the arm's own output of stage *n−1*. Shows whether differences compound.
- **Reset.** Stage *n* starts from a reference implementation of stage *n−1*, the same logic in every arm (the JS reference is produced by stripping types from the TS reference, so logic is identical). Isolates the effect of types on one stage.

Every stage starts a **fresh agent session** with no memory of earlier stages. This is what makes stage 7 (and every later stage) a maintenance situation rather than a continuation.

### 2.4 What the agent sees and does not see

- Sees: the repository, the task text, the visible tests shipped with the task, the check command for its arm.
- Does not see: hidden tests, adversarial fixtures, the reference implementation, other arms' output.

### 2.5 Metrics

Per stage:

| Metric | How |
|---|---|
| Stage success | Hidden tests for this stage pass |
| Regressions | Hidden tests for all earlier stages, re-run after this stage; count newly failing |
| Missed call sites (stage 6) | Fixtures that exercise every consumer of the changed type; count consumers still using the old shape |
| Cost | Wall time, input/output tokens, agent turns |
| Cost split | Time and tokens spent writing types vs fixing type errors vs everything else, classified from the tool-call log |
| Escape hatches | Count of `any` / `Any` / casts / ignore comments in the final tree |

At the end of each run:

| Metric | How |
|---|---|
| Latent bugs | Property-based fuzzing over the input formats, and mutation testing of the final tree; count distinct failures |
| Readability for maintenance | Stage 7 success rate is the operational measure; no subjective rating |

### 2.6 Repeats and noise

- At least 3 repeats per (arm, mode). Report every run, not only the mean.
- Before comparing arms, run one arm twice under identical conditions. A difference between arms smaller than the run-to-run difference is not reported as a difference.
- Seeds, model version, harness version and the commit of this repository are recorded in every run directory.

### 2.7 Expected shape of the result

Plot stage on the x-axis and success rate (or cumulative cost) on the y-axis, one line per arm.

- **H1** holds if untyped arms are at least as successful and cheaper at stages 1–2.
- **H2** holds if typed arms have fewer regressions and more completed stages from stage 4 on, so the lines cross.
- **H3** holds if `ts` sits between `js` and `ts-noany`, with more escape hatches than `ts-noany`.

### 2.8 Pilot

The smallest run that can say anything: JS/TS only, arms `js`, `ts`, `ts-noany`, cumulative mode, stages 1–7, 3 repeats. The expensive part is the hidden tests and adversarial fixtures, which must be written and reviewed by a human before any run.

## 3. Experiment A — migration findings

1. Pick a public JS repository with a long history and many bug-fix commits.
2. Let the agent migrate it: JSDoc + `checkJs` first, then TS, then `strict`.
3. Classify every type error the agent hit, and every suppression it added:

| Class | How it is confirmed |
|---|---|
| Real bug | A failing test reproduces it |
| Latent bug | An input that triggers it can be constructed |
| Later-fixed bug | The same location was fixed later in the repository's history |
| Dead code | `knip` or `ts-prune` shows it is unreachable |
| Suspicious behaviour | A human judges whether it is intended |
| Type-system limitation / noise | Disappears when the type is written differently |

Two people classify independently; report agreement. Without that, the number is as opaque as Airbnb's "38%".

## 4. Experiment B — bug replay

Repeat Gao et al. (ICSE 2017) with today's tools: check out the commit before each past bug fix, have the agent add types under TS `strict`, and record whether the checker flags the bug. Compare with the 15% of 2017.

## 5. Threats to validity

| Threat | Mitigation |
|---|---|
| Task text favours one language | Task texts differ only in language name and check command; reviewed side by side |
| Hidden tests written with one arm in mind | Tests are black-box (CLI input → output, public API calls), written before any run |
| Reference implementation leaks style | Reference is used only in reset mode, and identical in logic across arms |
| Model trained on similar tools | Unavoidable; the comparison between arms is what matters, not absolute scores |
| Agent games the checker with escape hatches | Counted, and banned in the `-noany` arms |
| One domain only | Stated as a limitation; a second domain is future work |
| Cost classification from logs is approximate | Classification rules published in `src/`, applied mechanically |
