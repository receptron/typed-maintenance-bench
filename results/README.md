# results — raw outputs

Append-only. Never edit a run after it is written; a rerun gets a new directory.

One directory per run: `<experiment>/<arm>/<mode>/<repeat>/stage-<n>/`, each holding the agent log, the final tree (or its diff), grader output, and `meta.json` (model and version, harness version, commit of this repository, seed, start/end time).
