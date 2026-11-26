# results — raw outputs

Append-only. Never edit a run after it is written; a rerun gets a new directory.

One directory per run: `<experiment>/<arm>/<mode>/<repeat>/stage-<n>/`, each holding the agent log, the final tree (or its diff), grader output, and `meta.json` (model and version, harness version, commit of this repository, seed, start/end time).

## Runs

| Runs | What differs |
|---|---|
| `staged-growth/*/cumulative/r1` | Pilot on a Claude subscription, before the stage-2 task said that the type rules apply to `notes` too; every arm failed `s2-invalid-json` on that. Its `meta.json` says `harnessDirty: true` only because `results/` itself was uncommitted |
| `staged-growth/*/cumulative/r2`–`r4` | Pilot after both fixes |
