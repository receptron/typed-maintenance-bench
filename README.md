# typed-maintenance-bench

**Do static types pay off for AI coding agents once software has to be maintained?**

A benchmark that grows one tool through many stages — new data formats, a library split, composition with other code, a breaking change, maintenance by someone with no context — and compares untyped and typed versions of the same work, run by the same agent.

[English](#english) | [日本語](#日本語)

---

## English

### Why this exists

Evil Martians reported that [type errors cost their coding agents under 1% of their time](https://evilmartians.com/chronicles/type-errors-cost-our-coding-agents-under-one-percent-of-their-time), and that JS did as well as or better than TS on their benchmarks. That matches intuition for **short, self-contained tasks**. It says nothing about what happens when code grows, gets reused and is changed by someone who did not write it. The same article also measured 20–28% of time spent *writing* types in one experiment, a cost that a "type errors" figure does not show.

Our survey ([papers/related-work.md](papers/related-work.md)) found no study that measures, in one experiment, both the cost of types to an agent and the defects types prevent across a long sequence of changes.

### The claim under test

> Small throwaway programs are fine without types. Anything that must be maintained should be typed as far as possible. This holds for Python as much as for JavaScript.

Stated as a falsifiable hypothesis:

- **H1** At early stages (a fresh, small tool), untyped arms are as successful as typed arms and cheaper.
- **H2** As stages accumulate — especially breaking changes and maintenance without context — typed arms regress less and finish more stages, so the curves **cross**.
- **H3** Without a ban on escape hatches (`any`, `Any`, `@ts-ignore`, `# type: ignore`), the typed arm drifts towards the untyped one.

If the curves do not cross, the second half of the claim is weak. Either outcome is worth publishing.

### Design in one table

| Stage | Work | Where types should matter |
|---|---|---|
| 1 | Minimal CLI: read CSV, aggregate, print a table | Hardly at all (throwaway level) |
| 2 | More input formats: JSON, JSONL, YAML, XLSX; missing values, numbers as strings, encodings | Normalising slightly different shapes |
| 3 | More outputs and a config file | Combinations of options |
| 4 | Split into a library with a public API | Keeping the API contract |
| 5 | Another tool consumes the library; formats become plugins | Misuse from other code |
| 6 | Breaking change: money gets a currency, dates get a time zone | Finding every affected call site |
| 7 | Maintenance in a fresh session: bug reports, no explanation | Types as documentation |

Arms (same model, harness and instructions):

| Arm | JS / TS | Python |
|---|---|---|
| untyped | JS | no annotations |
| light | JS + JSDoc + `checkJs` | annotations, not checked |
| typed | TS `strict` | annotations + `pyright --strict` |
| typed-strict | TS `strict` + no `any` | the above + no `Any` |

Each arm runs in two modes: **cumulative** (each stage builds on that arm's own previous result) and **reset** (every arm starts each stage from the same reference implementation). Hidden tests for *all* earlier stages run after every stage. Full protocol: [docs/protocol.md](docs/protocol.md). Stage specifications: [experiments/staged-growth/](experiments/staged-growth/).

### Repository layout

| Path | Contents |
|---|---|
| `docs/` | Protocol, metrics, threats to validity |
| `experiments/` | One directory per experiment: task specs, hidden tests, fixtures |
| `src/` | Harness: runner, graders, log parsers |
| `results/` | Raw run outputs, append-only, one directory per run |
| `reports/` | Analyses derived from `results/`, each with the command that produced it |
| `papers/` | Related work, and our own write-ups |

### Status

Stages 1–4 are runnable for the pilot arms (`js`, `ts`, `ts-noany`), in both modes. The harness passes its self-test (the reference implementation passes every hidden case in every arm and mode). A pilot with Claude Code (arms `js`, `ts`, `ts-noany`, cumulative, stages 1–2) has been run; the raw outputs are in [results/](results/README.md) and the first report is [reports/2026-11-26-pilot-stages-1-2.md](reports/2026-11-26-pilot-stages-1-2.md). Stages 1–2 turned out too easy to separate the arms on correctness, so stages 3 (more outputs, multi-key grouping, filters, a config file) and 4 (a library with a public API, tested by calling it) have been added.

### Reproducing

```
yarn install && yarn build
yarn check:reference                                   # harness self-test, no API calls
ANTHROPIC_API_KEY=... yarn bench --arm ts --mode cumulative --repeat r1
yarn bench --arm ts --mode cumulative --repeat r1 --auth subscription   # on a logged-in Claude subscription
```

Each run writes one directory per stage under `results/`, with the transcript, the diff, the grade and the final tree. Every report will name the command and the commit it was produced from. Details: [src/README.md](src/README.md).

### Discussing

Disagreement with the design is the most useful contribution at this stage: a confound we missed, a stage that favours one arm, a metric that can be gamed. Open an issue, or comment on the protocol. Please separate **what was measured** from **what is inferred**.

---

## 日本語

### なぜ作るのか

Evil Martians は、[型のエラーを直す時間はコーディングエージェントの作業時間の 1% 未満だった](https://evilmartians.com/chronicles/type-errors-cost-our-coding-agents-under-one-percent-of-their-time)と報告しました。ベンチマークでも JS は TS と同等以上でした。これは、**短く閉じた作業**についての直感と合います。しかし、コードが育ち、再利用され、書いた本人ではない人が変更するときに何が起きるかは、何も言っていません。同じ記事の別の実験では、型を**書く**作業に時間の 20〜28% を使っていました。「型のエラーを直す時間」の数字には、この費用が出てきません。

関連研究を調べた結果（[papers/related-work.md](papers/related-work.md)）、長く続く変更のなかで、エージェントにとっての型の費用と、型が防いだ不具合の両方を、同じ実験で測った研究は見つかりませんでした。

### 確かめたい主張

> 小さな使い捨てのプログラムなら、型なしでさっと書けばよい。保守が必要なものは、できる限り型がある方がよい。これは JavaScript だけでなく Python でも同じ。

反証できる形にすると、次の 3 つです。

- **H1** 初めの段階（新しく小さなツール）では、型なしの組も型ありの組と同じくらい成功し、しかも安い。
- **H2** 段階が積み重なると（特に破壊的な変更と、文脈を知らない保守で）、型ありの組の方が退行が少なく、多くの段階を終える。つまり線が**交差する**。
- **H3** 逃げ道（`any`、`Any`、`@ts-ignore`、`# type: ignore`）を禁止しないと、型ありの組は型なしの組に近づいていく。

線が交差しなければ、主張の後半は弱いことになります。どちらの結果でも、公開する価値があります。

### 設計の概要

| 段階 | 作業 | 型が効きそうな点 |
|---|---|---|
| 1 | 最小の CLI：CSV を読み、集計して表で出す | ほぼ効かない（使い捨て相当） |
| 2 | 入力形式を増やす：JSON、JSONL、YAML、XLSX。欠損値、文字列の数値、文字コードの違い | 少しずつ違うデータの形を揃えるところ |
| 3 | 出力形式と設定ファイルを増やす | 設定の組み合わせ |
| 4 | 公開 API を持つライブラリに分ける | API の約束を守れるか |
| 5 | 別のツールがライブラリを使う。形式をプラグインにする | 他のコードからの誤用 |
| 6 | 破壊的な変更：金額に通貨、日付にタイムゾーンを持たせる | 影響する呼び出し元をすべて見つけられるか |
| 7 | 新しいセッションでの保守：説明なしでバグ報告を渡す | 型が説明書の代わりになるか |

比べる組（モデル、ハーネス、指示はすべて揃えます）：

| 組 | JS／TS | Python |
|---|---|---|
| 型なし | JS | 型注釈なし |
| 軽い型 | JS ＋ JSDoc ＋ `checkJs` | 型注釈あり、検査なし |
| 型あり | TS `strict` | 型注釈 ＋ `pyright --strict` |
| 型あり・逃げ道禁止 | TS `strict` ＋ `any` 禁止 | 上 ＋ `Any` 禁止 |

各組を 2 つの進め方で走らせます。**積み上げ**（各段階を、その組自身の前の段階の成果の上に作る）と、**リセット**（各段階の開始時に、全組に同じ基準の実装を渡す）です。各段階の後には、それまでの**全段階**の隠したテストを走らせます。手順の詳細は [docs/protocol.md](docs/protocol.md)、段階ごとの仕様は [experiments/staged-growth/](experiments/staged-growth/) にあります。

### ディレクトリの構成

| パス | 中身 |
|---|---|
| `docs/` | 実験の手順、測るもの、結果を損なう要因 |
| `experiments/` | 実験ごとのディレクトリ：作業の仕様、隠したテスト、テスト用のデータ |
| `src/` | ハーネス：実行、採点、ログの解析 |
| `results/` | 実行の生の出力。追記のみ。1 回の実行につき 1 ディレクトリ |
| `reports/` | `results/` から作った分析。作ったコマンドを必ず添える |
| `papers/` | 関連研究と、自分たちの論文・記事の原稿 |

### 現状

段階 1〜4 を、小さく試す組（`js`、`ts`、`ts-noany`）で、2 つの進め方の両方で走らせられます。ハーネスは自己確認に通っています（参照実装が、全組・全進め方で、隠したテストにすべて通る）。Claude Code での小さな試し走り（`js`、`ts`、`ts-noany`、積み上げ、段階 1〜2）を走らせました。生の出力は [results/](results/README.md) に、最初のレポートは [reports/2026-11-26-pilot-stages-1-2.md](reports/2026-11-26-pilot-stages-1-2.md) にあります。段階 1〜2 は易しすぎて、正しさでは組の差が出なかったので、段階 3（出力形式、複数のキーでの集計、絞り込み、設定ファイル）と段階 4（公開 API を持つライブラリ。API を直接呼んでテストする）を足しました。

### 再現する

```
yarn install && yarn build
yarn check:reference                                   # ハーネスの自己確認。API は呼ばない
ANTHROPIC_API_KEY=... yarn bench --arm ts --mode cumulative --repeat r1
yarn bench --arm ts --mode cumulative --repeat r1 --auth subscription   # ログイン中の Claude のサブスクリプションで走らせる
```

1 回の実行で、段階ごとに 1 つのディレクトリが `results/` の下にでき、エージェントのやり取りの記録、変更の差分、採点、最後のコードが残ります。どのレポートにも、それを作ったコマンドとコミットを書きます。詳しくは [src/README.md](src/README.md)。

### 議論する

今の段階で一番役に立つのは、設計への反論です。見落としている交絡、特定の組に有利な段階、ごまかせてしまう指標などです。issue を立てるか、手順の文書にコメントしてください。その際は、**測ったこと**と**推測したこと**を分けて書いてください。
