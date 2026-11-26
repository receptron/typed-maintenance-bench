# Run the claude agent on a Claude subscription

## Decisions

- **`--auth api-key|subscription`**, default `api-key`. `api-key` keeps `--bare`; `subscription` uses `--safe-mode`, which also skips the host's CLAUDE.md, skills, plugins, hooks and MCP servers but accepts the logged-in subscription. Everything else in the command is identical, and a test pins that.
- **Checked by running both**: with `--include-hook-events`, neither mode fired a hook, and both loaded only built-in skills. `--safe-mode` additionally passes the account e-mail as context; it does not affect the task.
- **`subscription` refuses to start when `ANTHROPIC_API_KEY` is set**, because Claude Code would then use the key and the run would be mislabelled.
- The auth mode is recorded in `meta.json` with the other settings. `--max-budget-usd` still applies; on a subscription it caps the estimated cost, not a bill.

## Pilot findings fixed before the next repeats

- **The stage-2 task contradicted itself on `notes`**: stage 1 says `notes` may be anything, stage 2 says objects are invalid in every field. Every arm read it the first way. The task now says the type rules apply to `notes` too; the hidden case is unchanged.
- **`harnessDirty` was always true**, because the run's own output under `results/` counted as a change. The check now excludes `results/`.
- Earlier runs stay as written (results are append-only); new repeats get new ids.
