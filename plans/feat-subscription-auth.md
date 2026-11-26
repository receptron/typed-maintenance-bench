# Run the claude agent on a Claude subscription

## Decisions

- **`--auth api-key|subscription`**, default `api-key`. `api-key` keeps `--bare`; `subscription` uses `--safe-mode`, which also skips the host's CLAUDE.md, skills, plugins, hooks and MCP servers but accepts the logged-in subscription. Everything else in the command is identical, and a test pins that.
- **Checked by running both**: with `--include-hook-events`, neither mode fired a hook, and both loaded only built-in skills. `--safe-mode` additionally passes the account e-mail as context; it does not affect the task.
- **`subscription` refuses to start when `ANTHROPIC_API_KEY` is set**, because Claude Code would then use the key and the run would be mislabelled.
- The auth mode is recorded in `meta.json` with the other settings. `--max-budget-usd` still applies; on a subscription it caps the estimated cost, not a bill.
