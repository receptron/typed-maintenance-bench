# Pilot, stages 1–2 (2026-11-26)

Produced by `yarn build && yarn summarize --repeats r2,r3,r4` (and `--repeats r1` for the second table) at commit `06ca9ab`.
Runs: Claude Code 2.1.332, model `claude-sonnet-5-5`, `--auth subscription`, cumulative mode, stages 1–2, arms `js`, `ts`, `ts-noany`. Costs are Claude Code's own estimates; on a subscription they are not a bill.

[English](#english) | [日本語](#日本語)

## English

### r2–r4 (after the fixes)

| Arm | Mode | Stage | Runs | Runs passing every case | Mean cases passed | Mean escape hatches (min–max) | Mean agent minutes | Mean estimated cost |
|---|---|---|---|---|---|---|---|---|
| js | cumulative | 1 | 3 | 3/3 | 21.0/21 | 0.0 (0–0) | 0.7 | $0.11 |
| js | cumulative | 2 | 3 | 3/3 | 54.0/54 | 0.0 (0–0) | 1.9 | $0.28 |
| ts | cumulative | 1 | 3 | 3/3 | 21.0/21 | 14.0 (10–19) | 0.7 | $0.11 |
| ts | cumulative | 2 | 3 | 3/3 | 54.0/54 | 25.7 (23–28) | 1.8 | $0.28 |
| ts-noany | cumulative | 1 | 3 | 3/3 | 21.0/21 | 0.0 (0–0) | 0.7 | $0.11 |
| ts-noany | cumulative | 2 | 3 | 3/3 | 54.0/54 | 0.0 (0–0) | 2.2 | $0.35 |

`ts` stage-2 escape hatches by kind, summed over r2–r4: `!` 51, `as` 23, `any` 3. Recount with `yarn escapes results/staged-growth/ts/cumulative/<repeat>/stage-2/tree`.

### r1 (before the fixes)

| Arm | Mode | Stage | Runs | Runs passing every case | Mean cases passed | Mean escape hatches (min–max) | Mean agent minutes | Mean estimated cost |
|---|---|---|---|---|---|---|---|---|
| js | cumulative | 1 | 1 | 1/1 | 21.0/21 | 0.0 (0–0) | 0.5 | $0.09 |
| js | cumulative | 2 | 1 | 0/1 | 53.0/54 | 0.0 (0–0) | 1.9 | $0.28 |
| ts | cumulative | 1 | 1 | 1/1 | 21.0/21 | 12.0 (12–12) | 0.7 | $0.10 |
| ts | cumulative | 2 | 1 | 0/1 | 53.0/54 | 22.0 (22–22) | 1.8 | $0.27 |
| ts-noany | cumulative | 1 | 1 | 1/1 | 21.0/21 | 0.0 (0–0) | 0.6 | $0.10 |
| ts-noany | cumulative | 2 | 1 | 0/1 | 52.0/54 | 0.0 (0–0) | 3.1 | $0.45 |

In r1 every arm failed `s2-invalid-json`, because the stage-2 task contradicted itself on `notes`; the task was fixed before r2 (see [results/README.md](../results/README.md)). `ts-noany` also failed `s2-fatal-yaml-syntax`: it called the `yaml` library with `logLevel: "silent"`, which suppresses parse errors, so invalid YAML produced an empty table and exit code 0.

### What this does and does not show

- **Stages 1–2 do not separate the arms on correctness.** Every r2–r4 run passed every hidden case. This is consistent with H1, but it is a ceiling: the stages are too easy for a difference to appear.
- **Banning escape hatches cost more at stage 2.** `ts-noany` took longer and cost more than `js` and `ts` there; at stage 1 the arms were level.
- **Without the ban, escape hatches accumulate.** `ts` roughly doubled its count from stage 1 to stage 2, mostly non-null assertions. This points the same way as H3; whether it keeps growing is a question for later stages.
- **H2 is untested.** It needs the stages where types are expected to matter (library split, breaking change, maintenance without context).
- Three repeats per arm: these are directions, not effects. No test of significance was run.

## 日本語

### r2〜r4（直したあと）

数字の表は英語の節と同じです。

- **段階 1〜2 では、正しさで組の差が出ない。** r2〜r4 はすべての回が、隠したテストに全件合格した。H1 とは合うが、天井に当たっているだけで、差が出るほど難しくない。
- **逃げ道を禁止すると、段階 2 で手間が増えた。** `ts-noany` は `js` と `ts` より時間も見積もり費用も多くかかった。段階 1 では差がなかった。
- **禁止しないと、逃げ道が溜まっていく。** `ts` は段階 1 から段階 2 でおよそ倍に増え、多くは null でないと言い切る `!` だった。H3 と同じ向き。後の段階でも増え続けるかは、これから確かめる。
- **H2 はまだ確かめていない。** 型が効くと考えている段階（ライブラリへの分割、破壊的な変更、事情を知らない保守）が必要。
- 各組 3 回だけなので、傾向であって効果ではない。統計的な検定はしていない。

### r1（直す前）

r1 では全組が `s2-invalid-json` に落ちた。段階 2 の仕様が `notes` について矛盾していたためで、r2 の前に直した。`ts-noany` は `s2-fatal-yaml-syntax` にも落ちた。`yaml` ライブラリを `logLevel: "silent"` で呼んだため文法の誤りが例外にならず、壊れた YAML で空の表を出して終了コード 0 になった。
