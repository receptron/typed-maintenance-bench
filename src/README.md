# src — harness

Not written yet. Planned pieces:

| Piece | Job |
|---|---|
| runner | Start a fresh agent session for one (experiment, arm, mode, stage, repeat) with a fixed prompt, budget and working tree; save the full log |
| grader | Run the hidden tests for this stage and every earlier stage; record pass/fail per test |
| log classifier | Split time and tokens into writing types / fixing type errors / other, by fixed rules applied to the tool-call log |
| escape-hatch counter | Count `any`, `Any`, casts and ignore comments in a tree |
| fuzz + mutation | Run property-based fuzzing and mutation testing on a final tree |

Every piece must be runnable on its own against a saved run, so any number in `reports/` can be recomputed from `results/`.
