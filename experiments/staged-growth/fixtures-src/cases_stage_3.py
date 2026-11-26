"""Writes stage-3 cases.json and visible cases.json from hand-computed rows (cents), laid out per the stage-3 task text.

usage: python3 cases_stage_3.py ../stage-3/hidden-tests/cases.json ../stage-3/visible-tests/cases.json
"""
import json, sys

Q = '<b>&"q"'
DAY = [(("2026-03-01",), 2495), (("2026-03-02",), 1075), (("2026-03-03",), 1050), (("2026-03-05",), 700)]
SKU = [((Q,), 700), (("A",), 100), (("A-1",), 2375), (("A-2",), 50), (("B|x",), 1095), (("ß",), 1000)]
CUST = [(("C'3",), 700), (("C1",), 3475), (("C2",), 1145)]
DAY_SKU = [
    (("2026-03-01", "A-1"), 2000), (("2026-03-01", "B|x"), 495), (("2026-03-02", Q), 700),
    (("2026-03-02", "A-1"), 375), (("2026-03-03", "A-2"), 50), (("2026-03-03", "ß"), 1000),
    (("2026-03-05", "A"), 100), (("2026-03-05", "B|x"), 600),
]
SKU_DAY = [
    ((Q, "2026-03-02"), 700), (("A", "2026-03-05"), 100), (("A-1", "2026-03-01"), 2000),
    (("A-1", "2026-03-02"), 375), (("A-2", "2026-03-03"), 50), (("B|x", "2026-03-01"), 495),
    (("B|x", "2026-03-05"), 600), (("ß", "2026-03-03"), 1000),
]
CUST_DAY_SKU = [
    (("C'3", "2026-03-02", Q), 700), (("C1", "2026-03-01", "A-1"), 2000), (("C1", "2026-03-02", "A-1"), 375),
    (("C1", "2026-03-03", "ß"), 1000), (("C1", "2026-03-05", "A"), 100), (("C2", "2026-03-01", "B|x"), 495),
    (("C2", "2026-03-03", "A-2"), 50), (("C2", "2026-03-05", "B|x"), 600),
]
RANGE_DAY = [(("2026-03-02",), 1075), (("2026-03-03",), 1050)]
FROM_04_DAY = [(("2026-03-05",), 700)]
TO_01_DAY = [(("2026-03-01",), 2495)]
ONLY_02_DAY = [(("2026-03-02",), 1075)]
PREFIX_A_DASH = [(("A-1",), 2375), (("A-2",), 50)]
PREFIX_A = [(("A",), 100), (("A-1",), 2375), (("A-2",), 50)]
DAY_03_SKU_CUST = [(("A-2", "C2"), 50), (("ß", "C1"), 1000)]

for rows, total in [(DAY, 5320), (SKU, 5320), (CUST, 5320), (DAY_SKU, 5320), (SKU_DAY, 5320), (CUST_DAY_SKU, 5320),
                    (RANGE_DAY, 2125), (PREFIX_A_DASH, 2425), (PREFIX_A, 2525), (DAY_03_SKU_CUST, 1050)]:
    assert sum(c for _, c in rows) == total, (rows, total)

money = lambda cents: f"{cents // 100}.{cents % 100:02d}"
total_of = lambda rows: sum(c for _, c in rows)


def text(keys, rows):
    lines = ["\t".join([*keys, "revenue"])]
    lines += ["\t".join([*k, money(c)]) for k, c in rows]
    lines.append("\t".join(["TOTAL", *[""] * (len(keys) - 1), money(total_of(rows))]))
    return "\n".join(lines) + "\n"


def md_line(cells):
    return "| " + " | ".join(cells) + " |"


def markdown(keys, rows):
    esc = lambda s: s.replace("|", "\\|")
    lines = [md_line([*keys, "revenue"]), "|" + "|".join(["---"] * len(keys) + ["---:"]) + "|"]
    lines += [md_line([*map(esc, k), money(c)]) for k, c in rows]
    lines.append(md_line(["TOTAL", *[""] * (len(keys) - 1), money(total_of(rows))]))
    return "\n".join(lines) + "\n"


def html(keys, rows):
    def esc(s):
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")
    tr = lambda tag, cells: "<tr>" + "".join(f"<{tag}>{x}</{tag}>" for x in cells) + "</tr>"
    lines = ["<table>", "<thead>", tr("th", [*keys, "revenue"]), "</thead>", "<tbody>"]
    lines += [tr("td", [*map(esc, k), money(c)]) for k, c in rows]
    lines += ["</tbody>", "<tfoot>", tr("td", ["TOTAL", *[""] * (len(keys) - 1), money(total_of(rows))]), "</tfoot>", "</table>"]
    return "\n".join(lines) + "\n"


def as_json(keys, rows):
    body = {"groupBy": list(keys), "rows": [{"key": list(k), "revenue": money(c)} for k, c in rows], "total": money(total_of(rows))}
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")) + "\n"


RENDER = {"text": text, "markdown": markdown, "html": html, "json": as_json}
WARN = ["orders.csv:8:", "orders.csv:9:"]
cases = []


def ok(case_id, desc, args, keys, rows, output="text", warn=WARN, env=None):
    case = {"id": case_id, "description": desc, "args": args}
    if env:
        case["env"] = env
    case["expect"] = {"exitCode": 0, "stdout": RENDER[output](keys, rows), "stderrPrefixes": warn}
    cases.append(case)


def fatal(case_id, desc, args):
    cases.append({"id": case_id, "description": desc, "args": args, "expect": {"exitCode": 2, "stdout": "", "stderrNonEmpty": True}})


I = ["--input", "orders.csv"]
ok("s3-text-day", "Single key is the stage 1 layout", I + ["--group-by", "day"], ["day"], DAY)
ok("s3-text-customer", "Customer ids sort by code point (' before digits)", I + ["--group-by", "customer"], ["customer"], CUST)
ok("s3-text-day-sku", "Two keys", I + ["--group-by", "day,sku"], ["day", "sku"], DAY_SKU)
ok("s3-text-sku-day", "Component-wise sort: A before A-1", I + ["--group-by", "sku,day"], ["sku", "day"], SKU_DAY)
ok("s3-text-three-keys", "Three keys", I + ["--group-by", "customer,day,sku"], ["customer", "day", "sku"], CUST_DAY_SKU)
ok("s3-output-text-explicit", "--output text is the default layout", I + ["--group-by", "sku", "--output", "text"], ["sku"], SKU)
for output in ["markdown", "html", "json"]:
    ok(f"s3-{output}-day-sku", f"{output} with two keys and escapes", I + ["--group-by", "day,sku", "--output", output], ["day", "sku"], DAY_SKU, output)
    ok(f"s3-{output}-customer", f"{output} with one key", I + ["--group-by", "customer", "--output", output], ["customer"], CUST, output)
    ok(f"s3-{output}-empty", f"{output} with no rows", I + ["--group-by", "day", "--sku-prefix", "Z", "--output", output], ["day"], [], output)
ok("s3-text-empty", "text with no rows", I + ["--group-by", "day", "--sku-prefix", "Z"], ["day"], [])
ok("s3-filter-range", "Inclusive date range", I + ["--group-by", "day", "--from", "2026-03-02", "--to", "2026-03-03"], ["day"], RANGE_DAY)
ok("s3-filter-to", "--to alone", I + ["--group-by", "day", "--to", "2026-03-01"], ["day"], TO_01_DAY)
ok("s3-filter-dedup-first", "Duplicate judged before filtering", I + ["--group-by", "day", "--from", "2026-03-04"], ["day"], FROM_04_DAY)
ok("s3-filter-dedup-honolulu", "Date filter independent of TZ", I + ["--group-by", "day", "--from", "2026-03-04"], ["day"], FROM_04_DAY, env={"TZ": "Pacific/Honolulu"})
ok("s3-filter-range-tokyo", "Date range independent of TZ", I + ["--group-by", "day", "--from", "2026-03-02", "--to", "2026-03-03"], ["day"], RANGE_DAY, env={"TZ": "Asia/Tokyo"})
ok("s3-filter-same-day", "--from equal to --to, two keys", I + ["--group-by", "sku,customer", "--from", "2026-03-03", "--to", "2026-03-03"], ["sku", "customer"], DAY_03_SKU_CUST)
ok("s3-filter-prefix-dash", "SKU prefix A- excludes A", I + ["--group-by", "sku", "--sku-prefix", "A-"], ["sku"], PREFIX_A_DASH)
ok("s3-filter-prefix-case", "SKU prefix is case-sensitive", I + ["--group-by", "sku", "--sku-prefix", "a"], ["sku"], [])
ok("s3-filter-prefix-empty", "Empty prefix keeps everything", I + ["--group-by", "sku", "--sku-prefix", ""], ["sku"], SKU)
ok("s3-json-input", "JSON input, two keys", ["--input", "orders.json", "--group-by", "day,sku"], ["day", "sku"], DAY_SKU, warn=["orders.json:#7:", "orders.json:#8:"])
ok("s3-config-basic", "Config gives group-by and output", I + ["--config", "cfg-sku-markdown.json"], ["sku"], SKU, "markdown")
ok("s3-config-flag-output", "Flag overrides config output", I + ["--config", "cfg-sku-markdown.json", "--output", "json"], ["sku"], SKU, "json")
ok("s3-config-flag-groupby", "Flag overrides config group-by", I + ["--config", "cfg-sku-markdown.json", "--group-by", "customer"], ["customer"], CUST, "markdown")
ok("s3-config-range", "Config filters", I + ["--config", "cfg-range.json"], ["day"], RANGE_DAY)
ok("s3-config-flag-to", "Flag overrides one end of the config range", I + ["--config", "cfg-range.json", "--to", "2026-03-02"], ["day"], ONLY_02_DAY)
ok("s3-config-prefix-override", "Flag prefix overrides config prefix", I + ["--config", "cfg-prefix.json", "--sku-prefix", "A-"], ["sku"], PREFIX_A_DASH)
ok("s3-config-prefix", "Config prefix", I + ["--config", "cfg-prefix.json"], ["sku"], PREFIX_A)
ok("s3-config-format", "Config gives the input format", ["--input", "orders.data", "--config", "cfg-format.json"], ["day"], DAY, warn=["orders.data:8:", "orders.data:9:"])
ok("s3-config-all", "Config with every key", I + ["--config", "cfg-all.json"], ["customer", "day", "sku"], CUST_DAY_SKU, "json")
ok("s3-config-empty-flag", "Empty config, group-by from flag", I + ["--config", "cfg-empty.json", "--group-by", "day"], ["day"], DAY)
fatal("s3-fatal-config-empty", "No group-by anywhere", I + ["--config", "cfg-empty.json"])
fatal("s3-fatal-config-range-flag", "Flag --from after config --to", I + ["--config", "cfg-range.json", "--from", "2026-03-04"])
for name in ["bad-unknown-key", "bad-groupby-string", "bad-groupby-empty", "bad-groupby-dup", "bad-groupby-key", "bad-output",
             "bad-format", "bad-from-type", "bad-from-date", "bad-syntax", "bad-array"]:
    # Configs without a valid groupBy of their own get a --group-by flag, so the config itself must be what is fatal.
    flag = ["--group-by", "day"] if name in ("bad-syntax", "bad-array", "bad-unknown-key") else []
    fatal(f"s3-fatal-{name}", f"Invalid config {name}.json", I + ["--config", f"{name}.json", *flag])
fatal("s3-fatal-config-missing", "Config file does not exist", I + ["--group-by", "day", "--config", "missing.json"])
fatal("s3-fatal-groupby-dup", "Repeated key", I + ["--group-by", "day,day"])
fatal("s3-fatal-groupby-empty-item", "Empty item", I + ["--group-by", "day,"])
fatal("s3-fatal-groupby-unknown", "Unknown key", I + ["--group-by", "day,week"])
fatal("s3-fatal-groupby-empty", "Empty group-by", I + ["--group-by", ""])
fatal("s3-fatal-output", "Unknown output", I + ["--group-by", "day", "--output", "pdf"])
fatal("s3-fatal-from-date", "Impossible date", I + ["--group-by", "day", "--from", "2026-02-30"])
fatal("s3-fatal-from-shape", "Not YYYY-MM-DD", I + ["--group-by", "day", "--from", "2026-3-1"])
fatal("s3-fatal-from-after-to", "--from later than --to", I + ["--group-by", "day", "--from", "2026-03-05", "--to", "2026-03-01"])
fatal("s3-fatal-missing-groupby", "No group-by and no config", I)

if __name__ == "__main__":
    VISIBLE_IDS = ["s3-text-day-sku", "s3-markdown-customer", "s3-config-basic"]
    visible = [dict(c, id=c["id"].replace("s3-", "s3-visible-")) for c in cases if c["id"] in VISIBLE_IDS]
    assert len(visible) == len(VISIBLE_IDS)
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(json.dumps({"cases": visible}, ensure_ascii=False, indent=2) + "\n")

    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    out = sys.argv[1]
    with open(out, "w", encoding="utf-8") as f:
        f.write(json.dumps({"cases": cases}, ensure_ascii=False, indent=2) + "\n")
    print(len(cases), "cases")
