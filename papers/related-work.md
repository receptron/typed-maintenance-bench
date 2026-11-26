# Related work

What has been measured about types, defects and coding agents, and what is still missing. Figures are as reported by each source; "limit" is our reading.

## Studies and reports

| Source | Finding | Limit |
|---|---|---|
| [Evil Martians (2026)](https://evilmartians.com/chronicles/type-errors-cost-our-coding-agents-under-one-percent-of-their-time) | Type errors took under 1% of agent time in Ruby, 1–3% for Rust compile errors. JS matched or beat TS on three benchmarks (by 2–6 points). In one Rails experiment, writing and checking types took 20–28% of time. Language-server tools went unused until a hook forced them | Short tasks; TS and JS compared on different repositories, so type effect and task difficulty are confounded (the article says so). No latent defects, regressions or long-term cost measured |
| [Gao, Bird, Barr (ICSE 2017)](https://discovery-pp.ucl.ac.uk/id/eprint/10064729/1/typestudy.pdf) | Of 400 fixed public bugs, 15% were detectable by TS or Flow annotations added before the fix | Lower bound (public bugs only); not an actual migration |
| [Bogner & Merkel (MSR 2022)](https://arxiv.org/abs/2203.11115) | Across 604 apps, TS had better code quality and understandability, but a *higher* share of bug-fix commits | Correlational; repositories differ |
| Airbnb ([secondary report](https://www.infoq.com/news/2020/08/airbnb-typescript-migration)) | Postmortem review: 38% of bugs preventable with TS | Method and sample not published |
| [Khan et al. (TSE 2021)](https://rebels.cs.uwaterloo.ca/papers/tse2021_khan.pdf) | 15% of Python defects preventable by mypy | Lower bound |
| [Slack](https://slack.engineering/typescript-at-slack/), [Stripe](https://stripe.dev/blog/migrating-to-typescript), [Yelp](https://engineeringblog.yelp.com/2026/08/migrating-a-large-flow-monorepo-to-typescript.html), [Sentry](https://blog.sentry.io/slow-and-steady-converting-sentrys-entire-frontend-to-typescript/) | Slack was surprised by how many small bugs conversion surfaced; Stripe and Yelp report suppression counts (the cost side) | No counts of bugs found |
| [AgenticTyper (2026)](https://arxiv.org/abs/2602.21251) | An agent typed two JS repositories, resolving 633 type errors in about 20 minutes for about $25 | Closest to our question, but no breakdown of how many errors were real bugs; `strict` not reached |
| [Lee et al. (2026)](https://arxiv.org/abs/2602.17955) | AI agents use `any` about 9× as often as humans, and more type-check bypasses | May cancel the benefit of types |
| [Mündler et al. (PLDI 2025)](https://arxiv.org/abs/2504.09246) | 94% of compile errors in LLM-generated TS are type-check failures | Function-level tasks |
| [Krishnamurthi & Flatt (2026)](https://arxiv.org/abs/2606.01522) | Richer type-error messages raise agent fix rates (24–41% → 41–63%) | Small programs, one language |
| [Tang et al. (MSR 2026)](https://arxiv.org/abs/2601.21186) | About two thirds of 633 TS bugs are tooling/configuration, API misuse or type errors | Not about migration |

Not yet verified first-hand: the original Airbnb talk, Figma's migration report, TypeT5.

## Gaps this benchmark targets

1. A count, verified by humans, of real bugs, edge cases and dead code surfaced when an agent migrates a mature JS codebase (experiment A).
2. Cost of types to an agent and defects prevented by types, measured **in the same experiment** (experiment C).
3. Agent performance with and without types over a **long sequence** of changes to the **same** code, including breaking changes and maintenance without context (experiment C).
4. How much escape-hatch use by agents cancels the benefit of types (the `-noany` arms).
