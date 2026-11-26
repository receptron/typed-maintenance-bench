"""Writes stage-6 cases.json, api-cases.json (hidden and visible) and retired.json from hand-computed values.

usage: python3 cases_stage_6.py ../stage-6
"""
import json, os, sys

from cases_stage_3 import CUST_DAY_SKU, DAY_SKU, SKU, money

# The stage 5 TSV by SKU (see cases_stage_5.py), all USD.
TSV_SKU = [(('"B"',), 495), (("A",), 4075), (("B",), 50), (("X",), 100)]

ANY = {"$anyString": True}
TYPE_ERROR = {"throws": "TypeError"}
returns = lambda value: {"returns": value}

# Rows are (key, currency, cents). Valid records of orders6.csv, by line, with their instants:
# 2 C1 A 2026-03-01 USD 2000 | 3 C1 A 2026-03-01 EUR 500 | 4 C2 B 03-02T04:30Z USD 300 | 5 C2 A 03-01T15:30Z JPY 400
# 7 C3 A 03-02T10:00Z EUR 200 | 9 C3 B 03-09T04:30Z USD 100 | 12 C4 A 03-02T23:45Z USD 100 (2 × 0.50)
# 13 C1 A 2026-03-04 USD 630 (7.00 less 10%) | 14 C2 A 03-04T12:00Z EUR 100 (2.00 less 50%)
DAY_UTC = [(("2026-03-01",), "EUR", 500), (("2026-03-01",), "JPY", 400), (("2026-03-01",), "USD", 2000),
           (("2026-03-02",), "EUR", 200), (("2026-03-02",), "USD", 400), (("2026-03-04",), "EUR", 100),
           (("2026-03-04",), "USD", 630), (("2026-03-09",), "USD", 100)]
# New York: line 4 is 23:30 on 1 March; line 9 is 00:30 on 9 March under daylight saving time (from 8 March).
DAY_NEW_YORK = [(("2026-03-01",), "EUR", 500), (("2026-03-01",), "JPY", 400), (("2026-03-01",), "USD", 2300),
                (("2026-03-02",), "EUR", 200), (("2026-03-02",), "USD", 100), (("2026-03-04",), "EUR", 100),
                (("2026-03-04",), "USD", 630), (("2026-03-09",), "USD", 100)]
# Tokyo: lines 4 and 5 are on 2 March, line 12 on 3 March.
DAY_TOKYO = [(("2026-03-01",), "EUR", 500), (("2026-03-01",), "USD", 2000), (("2026-03-02",), "EUR", 200),
             (("2026-03-02",), "JPY", 400), (("2026-03-02",), "USD", 300), (("2026-03-03",), "USD", 100),
             (("2026-03-04",), "EUR", 100), (("2026-03-04",), "USD", 630), (("2026-03-09",), "USD", 100)]
# Kolkata (+05:30): line 5 stays on 1 March, line 12 is on 3 March.
DAY_KOLKATA = [(("2026-03-01",), "EUR", 500), (("2026-03-01",), "JPY", 400), (("2026-03-01",), "USD", 2000),
               (("2026-03-02",), "EUR", 200), (("2026-03-02",), "USD", 300), (("2026-03-03",), "USD", 100),
               (("2026-03-04",), "EUR", 100), (("2026-03-04",), "USD", 630), (("2026-03-09",), "USD", 100)]
SKU_6 = [(("A",), "EUR", 800), (("A",), "JPY", 400), (("A",), "USD", 2730), (("B",), "USD", 400)]
CUST_6 = [(("C1",), "EUR", 500), (("C1",), "USD", 2630), (("C2",), "EUR", 100), (("C2",), "JPY", 400),
          (("C2",), "USD", 300), (("C3",), "EUR", 200), (("C3",), "USD", 100), (("C4",), "USD", 100)]
CUST_DAY_UTC = [(("C1", "2026-03-01"), "EUR", 500), (("C1", "2026-03-01"), "USD", 2000), (("C1", "2026-03-04"), "USD", 630),
                (("C2", "2026-03-01"), "JPY", 400), (("C2", "2026-03-02"), "USD", 300), (("C2", "2026-03-04"), "EUR", 100),
                (("C3", "2026-03-02"), "EUR", 200), (("C3", "2026-03-09"), "USD", 100), (("C4", "2026-03-02"), "USD", 100)]
# --from 2026-03-02 --to 2026-03-03 by customer: the days, and so the records kept, depend on the zone.
RANGE_UTC = [(("C2",), "USD", 300), (("C3",), "EUR", 200), (("C4",), "USD", 100)]
RANGE_TOKYO = [(("C2",), "JPY", 400), (("C2",), "USD", 300), (("C3",), "EUR", 200), (("C4",), "USD", 100)]
RANGE_NEW_YORK = [(("C3",), "EUR", 200), (("C4",), "USD", 100)]
for rows in [DAY_UTC, DAY_NEW_YORK, DAY_TOKYO, DAY_KOLKATA, SKU_6, CUST_6, CUST_DAY_UTC]:
    totals = {}
    for _, currency, cents in rows:
        totals[currency] = totals.get(currency, 0) + cents
    assert totals == {"EUR": 800, "JPY": 400, "USD": 3130}, rows
WARN_6 = [f"orders6.csv:{line}:" for line in [6, 8, 10, 11, 15, 16]]

# orders6.tsv: T1 A 03-02T01:00Z EUR 100 | T1 A 2026-03-02 USD 200 | T2 B 2026-03-02 JPY 300
TSV6_CUST = [(("T1",), "EUR", 100), (("T1",), "USD", 200), (("T2",), "JPY", 300)]
TSV6_DAY_NEW_YORK = [(("2026-03-01",), "EUR", 100), (("2026-03-02",), "JPY", 300), (("2026-03-02",), "USD", 200)]
# orders6.json: j1 J1 A 03-02T04:00Z EUR 350 | j2 J1 A 2026-03-01 USD 200; #3 to #7 are invalid.
JSON6_CUST = [(("J1",), "EUR", 350), (("J1",), "USD", 200)]
JSON6_DAY_NEW_YORK = [(("2026-03-01",), "EUR", 350), (("2026-03-01",), "USD", 200)]
WARN_JSON6 = [f"orders6.json:#{n}:" for n in range(3, 8)]

usd = lambda rows: [(k, "USD", c) for k, c in rows]


def amount(cents, currency):
    return money(cents) if currency == "USD" else f"{money(cents)} {currency}"


def totals_of(rows):
    sums = {}
    for _, currency, cents in rows:
        sums[currency] = sums.get(currency, 0) + cents
    return sorted(sums.items())


def total_lines(keys, rows):
    totals = totals_of(rows) or [("USD", 0)]
    return [["TOTAL", *[""] * (len(keys) - 1), amount(c, cur)] for cur, c in totals]


def text(keys, rows):
    lines = [[*keys, "revenue"], *[[*k, amount(c, cur)] for k, cur, c in rows], *total_lines(keys, rows)]
    return "\n".join("\t".join(cells) for cells in lines) + "\n"


def markdown(keys, rows):
    line = lambda cells: "| " + " | ".join(cells) + " |"
    esc = lambda s: s.replace("|", "\\|")
    lines = [line([*keys, "revenue"]), "|" + "|".join(["---"] * len(keys) + ["---:"]) + "|"]
    lines += [line([*map(esc, k), amount(c, cur)]) for k, cur, c in rows]
    lines += [line(cells) for cells in total_lines(keys, rows)]
    return "\n".join(lines) + "\n"


def html(keys, rows):
    def esc(s):
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;")
    tr = lambda tag, cells: "<tr>" + "".join(f"<{tag}>{x}</{tag}>" for x in cells) + "</tr>"
    lines = ["<table>", "<thead>", tr("th", [*keys, "revenue"]), "</thead>", "<tbody>"]
    lines += [tr("td", [*map(esc, k), amount(c, cur)]) for k, cur, c in rows]
    lines += ["</tbody>", "<tfoot>", *[tr("td", cells) for cells in total_lines(keys, rows)], "</tfoot>", "</table>"]
    return "\n".join(lines) + "\n"


def as_json(keys, rows):
    body = {"groupBy": list(keys), "rows": [{"key": list(k), "currency": cur, "revenue": money(c)} for k, cur, c in rows],
            "totals": [{"currency": cur, "total": money(c)} for cur, c in totals_of(rows)]}
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")) + "\n"


RENDER = {"text": text, "markdown": markdown, "html": html, "json": as_json}

cases = []


def cli(case_id, desc, args, stdout=None, warn=(), exit_code=0, tool=None, out=None, env=None):
    expect = {"exitCode": exit_code, "stdout": stdout if exit_code == 0 and stdout is not None else ""}
    if exit_code == 0:
        expect["stderrPrefixes"] = list(warn)
    else:
        expect["stderrNonEmpty"] = True
    if out is not None:
        expect["files"] = out
    cases.append({"id": case_id, "description": desc, **({"tool": tool} if tool else {}), "args": args,
                  **({"env": env} if env else {}), "expect": expect})


IN6 = ["--input", "orders6.csv"]
cli("s6-cli-text-day-utc", "Rows per day and currency, UTC by default", [*IN6, "--group-by", "day"], text(["day"], DAY_UTC), WARN_6)
cli("s6-cli-text-day-new-york", "Days in New York, across the change to daylight saving time",
    [*IN6, "--group-by", "day", "--time-zone", "America/New_York"], text(["day"], DAY_NEW_YORK), WARN_6)
cli("s6-cli-text-day-tokyo", "Days in Tokyo", [*IN6, "--group-by", "day", "--time-zone", "Asia/Tokyo"], text(["day"], DAY_TOKYO), WARN_6)
cli("s6-cli-text-day-kolkata", "Days in a zone with a half-hour offset", [*IN6, "--time-zone", "Asia/Kolkata", "--group-by", "day"],
    text(["day"], DAY_KOLKATA), WARN_6)
cli("s6-cli-text-sku", "Rows per SKU and currency", [*IN6, "--group-by", "sku"], text(["sku"], SKU_6), WARN_6)
cli("s6-cli-text-customer", "Rows per customer and currency", [*IN6, "--group-by", "customer"], text(["customer"], CUST_6), WARN_6)
cli("s6-cli-text-two-keys", "Two keys, then the currency", [*IN6, "--group-by", "customer,day"], text(["customer", "day"], CUST_DAY_UTC), WARN_6)
cli("s6-cli-markdown-customer", "Markdown with a TOTAL line per currency", [*IN6, "--group-by", "customer", "--output", "markdown"],
    markdown(["customer"], CUST_6), WARN_6)
cli("s6-cli-html-customer", "HTML with a TOTAL row per currency", [*IN6, "--group-by", "customer", "--output", "html"],
    html(["customer"], CUST_6), WARN_6)
cli("s6-cli-json-customer", "JSON states the currency", [*IN6, "--group-by", "customer", "--output", "json"], as_json(["customer"], CUST_6), WARN_6)
cli("s6-cli-json-day-new-york", "JSON by day in New York", [*IN6, "--group-by", "day", "--output", "json", "--time-zone", "America/New_York"],
    as_json(["day"], DAY_NEW_YORK), WARN_6)
cli("s6-cli-json-empty", "JSON with no rows", [*IN6, "--group-by", "day", "--sku-prefix", "Z", "--output", "json"], as_json(["day"], []), WARN_6)
cli("s6-cli-text-empty", "Text with no rows keeps one TOTAL line", [*IN6, "--group-by", "day", "--sku-prefix", "Z"], text(["day"], []), WARN_6)
cli("s6-cli-filter-utc", "Filters use the day in the zone: UTC", [*IN6, "--group-by", "customer", "--from", "2026-03-02", "--to", "2026-03-03"],
    text(["customer"], RANGE_UTC), WARN_6)
cli("s6-cli-filter-tokyo", "Filters use the day in the zone: Tokyo",
    [*IN6, "--group-by", "customer", "--from", "2026-03-02", "--to", "2026-03-03", "--time-zone", "Asia/Tokyo"], text(["customer"], RANGE_TOKYO), WARN_6)
cli("s6-cli-filter-new-york", "Filters use the day in the zone: New York",
    [*IN6, "--group-by", "customer", "--from", "2026-03-02", "--to", "2026-03-03", "--time-zone", "America/New_York"],
    text(["customer"], RANGE_NEW_YORK), WARN_6)
cli("s6-cli-config-zone", "The config file sets the time zone", [*IN6, "--config", "cfg-tokyo.json"], text(["day"], DAY_TOKYO), WARN_6)
cli("s6-cli-machine-zone-default", "The machine's zone does not change the UTC default", [*IN6, "--group-by", "day"], text(["day"], DAY_UTC), WARN_6,
    env={"TZ": "America/Los_Angeles"})
cli("s6-cli-machine-zone-flag", "The machine's zone does not change the configured zone",
    [*IN6, "--group-by", "day", "--time-zone", "America/New_York"], text(["day"], DAY_NEW_YORK), WARN_6, env={"TZ": "Asia/Tokyo"})
cli("s6-cli-json-input-customer", "Typed values: a number or lowercase code is invalid", ["--input", "orders6.json", "--group-by", "customer"],
    text(["customer"], JSON6_CUST), WARN_JSON6)
cli("s6-cli-json-input-new-york", "Timestamps in JSON input", ["--input", "orders6.json", "--group-by", "day", "--time-zone", "America/New_York"],
    text(["day"], JSON6_DAY_NEW_YORK), WARN_JSON6)
cli("s6-tsv-customer", "TSV with the currency last", ["--input", "orders6.tsv", "--group-by", "customer"], text(["customer"], TSV6_CUST))
cli("s6-tsv-day-new-york", "TSV timestamps in New York", ["--input", "orders6.tsv", "--group-by", "day", "--time-zone", "America/New_York"],
    text(["day"], TSV6_DAY_NEW_YORK))
cli("s6-tsv-json-stage-5", "Stage 5 TSV in the new JSON shape", ["--input", "orders.tsv", "--group-by", "sku", "--output", "json"],
    as_json(["sku"], usd(TSV_SKU)), ["orders.tsv:9:", "orders.tsv:10:", "orders.tsv:11:"])
WARN_3 = ["orders.csv:8:", "orders.csv:9:"]
cli("s6-cli-json-stage-3", "Stage 3 data in the new JSON shape", ["--input", "orders.csv", "--group-by", "day,sku", "--output", "json"],
    as_json(["day", "sku"], usd(DAY_SKU)), WARN_3)
cli("s6-cli-json-config-all", "Config file asking for JSON", ["--input", "orders.csv", "--config", "cfg-all.json"],
    as_json(["customer", "day", "sku"], usd(CUST_DAY_SKU)), WARN_3)
cli("s6-cli-json-config-flag-output", "--output json over a config file", ["--input", "orders.csv", "--config", "cfg-sku-markdown.json", "--output", "json"],
    as_json(["sku"], usd(SKU)), WARN_3)
for case_id, desc, args in [
    ("s6-cli-fatal-zone", "Unknown time zone", [*IN6, "--group-by", "day", "--time-zone", "Mars/Olympus"]),
    ("s6-cli-fatal-zone-no-value", "--time-zone without a value", [*IN6, "--group-by", "day", "--time-zone"]),
    ("s6-cli-fatal-config-zone", "Unknown time zone in the config file", [*IN6, "--config", "cfg-bad-zone.json"]),
    ("s6-cli-fatal-config-zone-type", "timeZone that is not a string", [*IN6, "--config", "cfg-zone-type.json"]),
    ("s6-cli-fatal-config-zone-flag", "An invalid config value stays fatal when a flag overrides it",
     [*IN6, "--config", "cfg-bad-zone.json", "--time-zone", "UTC"]),
]:
    cli(case_id, desc, args, exit_code=2)


def report_file(customer, lines):
    """lines: (week, currency, cents), already summed."""
    rows = sorted(lines)
    totals = {}
    for _, currency, cents in rows:
        totals[currency] = totals.get(currency, 0) + cents
    body = [f"customer\t{customer}", "week\trevenue", *[f"{w}\t{amount(c, cur)}" for w, cur, c in rows]]
    return "\n".join([*body, *[f"TOTAL\t{amount(c, cur)}" for cur, c in sorted(totals.items())]]) + "\n"


def files(directory, reports):
    return {"dir": directory, "contents": {f"{name}.txt": report_file(name, lines) for name, lines in reports.items()}}


# Weeks: 1 March is a Sunday in 2026-W09, 2 to 8 March is 2026-W10 and 9 March is in 2026-W11.
REPORT_UTC = {
    "C1": [("2026-W09", "EUR", 500), ("2026-W09", "USD", 2000), ("2026-W10", "USD", 630)],
    "C2": [("2026-W09", "JPY", 400), ("2026-W10", "EUR", 100), ("2026-W10", "USD", 300)],
    "C3": [("2026-W10", "EUR", 200), ("2026-W11", "USD", 100)],
    "C4": [("2026-W10", "USD", 100)],
}
REPORT_NEW_YORK = {**REPORT_UTC, "C2": [("2026-W09", "JPY", 400), ("2026-W09", "USD", 300), ("2026-W10", "EUR", 100)]}
REPORT_TOKYO = {**REPORT_UTC, "C2": [("2026-W10", "EUR", 100), ("2026-W10", "JPY", 400), ("2026-W10", "USD", 300)]}
REPORT_TSV6 = {"T1": [("2026-W10", "EUR", 100), ("2026-W10", "USD", 200)], "T2": [("2026-W10", "JPY", 300)]}
cli("s6-report-utc", "A line per week and currency, a TOTAL per currency", [*IN6, "--out-dir", "out"], warn=WARN_6, tool="report",
    out=files("out", REPORT_UTC))
cli("s6-report-new-york", "Report weeks in New York, across daylight saving time", [*IN6, "--out-dir", "out", "--time-zone", "America/New_York"],
    warn=WARN_6, tool="report", out=files("out", REPORT_NEW_YORK))
cli("s6-report-tokyo", "Report weeks in Tokyo", [*IN6, "--time-zone", "Asia/Tokyo", "--out-dir", "out"], warn=WARN_6, tool="report",
    out=files("out", REPORT_TOKYO))
cli("s6-report-machine-zone", "The machine's zone does not change report weeks", [*IN6, "--out-dir", "out"], warn=WARN_6, tool="report",
    out=files("out", REPORT_UTC), env={"TZ": "Pacific/Kiritimati"})
cli("s6-report-tsv", "Report from TSV with the currency last", ["--input", "orders6.tsv", "--out-dir", "out"], tool="report",
    out=files("out", REPORT_TSV6))
cli("s6-report-fatal-zone", "Unknown time zone", [*IN6, "--out-dir", "out", "--time-zone", "Mars/Olympus"], exit_code=2, tool="report",
    out=files("out", {}))

api_cases = []


def api(case_id, desc, call, args, expect, setup=None, **extra):
    api_cases.append({"id": case_id, "description": desc, **({"setup": setup} if setup else {}), "call": call, "args": args,
                      **extra, "expect": expect})


def rec(order_id, customer, date, sku, quantity, cents, currency="USD", discount=0, notes=""):
    return {"orderId": order_id, "customerId": customer, "orderDate": date, "sku": sku, "quantity": quantity,
            "unitPrice": {"cents": cents, "currency": currency}, "discountPercent": discount, "notes": notes}


def result(keys, rows):
    return {"groupBy": keys, "rows": [{"key": list(k), "currency": cur, "revenueCents": c} for k, cur, c in rows],
            "totals": [{"currency": cur, "cents": c} for cur, c in totals_of(rows)]}


# A plugin's problem is the reason; every other reason is free text.
PLUGIN_REASONS = {("orders.pipe", "5"): "too few fields", ("any.typed", "d"): "rejected by the plugin"}
warnings = lambda file, locations: [{"file": file, "location": loc, "reason": PLUGIN_REASONS.get((file, loc), ANY)} for loc in locations]
RECORDS_6 = [
    rec("1", "C1", "2026-03-01", "A", 2, 1000), rec("2", "C1", "2026-03-01", "A", 1, 500, "EUR"),
    rec("3", "C2", "2026-03-01T23:30:00-05:00", "B", 1, 300), rec("4", "C2", "2026-03-02T00:30:00+09:00", "A", 1, 400, "JPY"),
    rec("6", "C3", "2026-03-02T10:00:00Z", "A", 1, 200, "EUR"), rec("8", "C3", "2026-03-09T04:30:00Z", "B", 1, 100),
    rec("11", "C4", "2026-03-03T05:15+05:30", "A", 2, 50), rec("12", "C1", "2026-03-04", "A", 1, 700, "USD", 10, "note"),
    rec("13", "C2", "2026-03-04T12:00:00Z", "A", 1, 200, "EUR", 50),
]
Q = '<b>&"q"'
RECORDS_3 = [rec("1", "C1", "2026-03-01", "A-1", 2, 1000), rec("2", "C2", "2026-03-01", "B|x", 1, 550, "USD", 10),
             rec("3", "C1", "2026-03-02", "A-1", 3, 125), rec("4", "C'3", "2026-03-02", Q, 1, 700),
             rec("5", "C2", "2026-03-03", "A-2", 1, 99, "USD", 50), rec("6", "C1", "2026-03-03", "ß", 4, 250, "USD", 0, "gift wrap"),
             rec("8", "C2", "2026-03-05", "B|x", 2, 300), rec("9", "C1", "2026-03-05", "A", 1, 100)]
RECORDS_TSV_5 = [rec("1", "C1", "2026-12-28", "A", 2, 1000), rec("2", "C2", "2026-12-31", '"B"', 1, 550, "USD", 10),
                 rec("3", "C1", "2027-01-01", "A", 3, 125), rec("4", "C/3", "2027-01-03", "A", 1, 700),
                 rec("5", "C2", "2027-01-04", "B", 1, 99, "USD", 50), rec("6", "C1", "2026-12-27", "A", 4, 250, "USD", 0, "note"),
                 rec("9", "C.1", "2027-01-10", "X", 1, 100)]
CSV6 = {"path": "orders6.csv"}
api("s6-api-read-csv", "Records carry unitPrice with a currency, and orderDate as written", "read", [CSV6],
    returns({"records": RECORDS_6, "warnings": warnings("orders6.csv", ["6", "8", "10", "11", "15", "16"])}))
api("s6-api-read-json", "Typed values in the new record shape", "read", [{"path": "orders6.json"}],
    returns({"records": [rec("j1", "J1", "2026-03-01T20:00:00-08:00", "A", 1, 350, "EUR"), rec("j2", "J1", "2026-03-01", "A", 2, 100)],
             "warnings": warnings("orders6.json", [f"#{n}" for n in range(3, 8)])}))
api("s6-api-read-tsv", "TSV with the currency last", "read", [{"path": "orders6.tsv"}],
    returns({"records": [rec("1", "T1", "2026-03-01T22:00:00-03:00", "A", 1, 100, "EUR"), rec("2", "T1", "2026-03-02", "A", 1, 200),
                         rec("3", "T2", "2026-03-02", "B", 2, 150, "JPY")], "warnings": []}))
api("s6-api-read-stage-3", "Stage 3 data in the new record shape", "read", [{"path": "orders.csv"}],
    returns({"records": RECORDS_3, "warnings": warnings("orders.csv", ["8", "9"])}))
api("s6-api-read-tsv-stage-5", "Stage 5 TSV in the new record shape", "read", [{"path": "orders.tsv"}],
    returns({"records": RECORDS_TSV_5, "warnings": warnings("orders.tsv", ["9", "10", "11"])}))
PIPE = {"call": "registerFormat", "args": [{"name": "pipe", "extensions": [".pipe"], "parse": {"$plugin": "pipe"}}]}
TYPED = {"call": "registerFormat", "args": [{"name": "typed", "extensions": [".typed"], "parse": {"$plugin": "typed"}}]}
api("s6-api-plugin-read", "Plugin records in the new shape", "read", [{"path": "orders.pipe"}],
    returns({"records": [rec("1", "P1", "2026-03-01", "A", 2, 100), rec("2", "P1", "2026-03-02", "B", 1, 250, "USD", 20, "x")],
             "warnings": warnings("orders.pipe", ["4", "5", "6"])}), [PIPE])
api("s6-api-plugin-typed", "Typed plugin values in the new shape", "read", [{"path": "any.typed"}],
    returns({"records": [rec("1", "T1", "2026-03-01", "T", 2, 150, "USD", 0, "5"), rec("4", "T3", "2026-03-03", "U", 3, 50)],
             "warnings": warnings("any.typed", ["b", "c", "d", "e", "f"])}), [TYPED])
api("s6-api-plugin-currency", "A plugin's fields carry the currency and a timestamp", "pipeline",
    [{"path": "orders6.pipe"}, {"groupBy": ["day"]}, "text"], returns(text(["day"], [(("2026-03-02",), "EUR", 100)])), [PIPE])

FROM6 = {"recordsFrom": CSV6}
api("s6-api-agg-day-utc", "aggregate by day in UTC by default", "aggregate", [{"groupBy": ["day"]}], returns(result(["day"], DAY_UTC)), **FROM6)
api("s6-api-agg-day-new-york", "aggregate by day in New York", "aggregate", [{"groupBy": ["day"], "timeZone": "America/New_York"}],
    returns(result(["day"], DAY_NEW_YORK)), **FROM6)
api("s6-api-agg-day-tokyo-machine", "The machine's zone does not matter", "aggregate", [{"groupBy": ["day"], "timeZone": "Asia/Tokyo"}],
    returns(result(["day"], DAY_TOKYO)), env={"TZ": "America/New_York"}, **FROM6)
api("s6-api-agg-sku", "aggregate by SKU and currency", "aggregate", [{"groupBy": ["sku"]}], returns(result(["sku"], SKU_6)), **FROM6)
api("s6-api-agg-customer-day", "Two keys, then the currency", "aggregate", [{"groupBy": ["customer", "day"]}],
    returns(result(["customer", "day"], CUST_DAY_UTC)), **FROM6)
api("s6-api-agg-range-tokyo", "A date range in Tokyo", "aggregate",
    [{"groupBy": ["customer"], "from": "2026-03-02", "to": "2026-03-03", "timeZone": "Asia/Tokyo"}], returns(result(["customer"], RANGE_TOKYO)), **FROM6)
api("s6-api-agg-empty", "No rows: empty totals", "aggregate", [{"groupBy": ["day"], "skuPrefix": "Z"}], returns(result(["day"], [])), **FROM6)
CHATHAM = [rec("h1", "H", "2026-03-01T10:15:00Z", "A", 1, 100, "NZD"), rec("h2", "H", "2026-03-01T10:14:59Z", "A", 1, 100, "NZD")]
api("s6-api-agg-chatham", "A zone 13:45 ahead under daylight saving time", "aggregate", [CHATHAM, {"groupBy": ["day"], "timeZone": "Pacific/Chatham"}],
    returns(result(["day"], [(("2026-03-01",), "NZD", 100), (("2026-03-02",), "NZD", 100)])))
ROUNDING = [rec("r1", "C1", "2026-03-01", "R", 1, 99, "EUR", 50), rec("r2", "C1", "2026-03-01", "R", 1, 99, "EUR", 50),
            rec("r3", "C1", "2026-03-01", "R", 1, 99, "USD", 50)]
api("s6-api-agg-round-per-record", "Each record rounds on its own, per currency", "aggregate", [ROUNDING, {"groupBy": ["sku"]}],
    returns(result(["sku"], [(("R",), "EUR", 100), (("R",), "USD", 50)])))
SAME = [rec("d", "C1", "2026-03-01", "D", 1, 100, "GBP"), rec("d", "C1", "2026-03-01", "D", 1, 100, "GBP")]
api("s6-api-agg-no-dedup", "aggregate sums every record it is given", "aggregate", [SAME, {"groupBy": ["customer"]}],
    returns(result(["customer"], [(("C1",), "GBP", 200)])))
UNSORTED = [rec("u1", "C2", "2026-03-02T01:00:00+09:00", "B", 1, 100, "JPY"), rec("u2", "C1", "2026-03-01", "A", 1, 200, "CHF")]
api("s6-api-agg-no-mutation", "Records and spec stay as given", "aggregate", [UNSORTED, {"groupBy": ["day", "customer"], "timeZone": "UTC"}],
    returns(result(["day", "customer"], [(("2026-03-01", "C1"), "CHF", 200), (("2026-03-01", "C2"), "JPY", 100)])))
api("s6-api-agg-type-zone", "timeZone that is not a string", "aggregate", [{"groupBy": ["day"], "timeZone": 9}], TYPE_ERROR, **FROM6)
api("s6-api-agg-type-unknown-zone", "Unknown time zone", "aggregate", [{"groupBy": ["day"], "timeZone": "Mars/Olympus"}], TYPE_ERROR, **FROM6)
CUST_RESULT = result(["customer"], CUST_6)
for output in ["text", "markdown", "html", "json"]:
    api(f"s6-api-render-{output}", f"render {output} with several currencies", "render", [CUST_RESULT, output], returns(RENDER[output](["customer"], CUST_6)))
api("s6-api-render-empty-text", "render with no rows", "render", [result(["day"], []), "text"], returns(text(["day"], [])))
api("s6-api-render-empty-json", "render JSON with no rows", "render", [result(["day"], []), "json"], returns(as_json(["day"], [])))
api("s6-api-pipeline-json-new-york", "read, aggregate in New York, render JSON", "pipeline",
    [CSV6, {"groupBy": ["day"], "timeZone": "America/New_York"}, "json"], returns(as_json(["day"], DAY_NEW_YORK)))
api("s6-api-pipeline-stage-3", "Stage 3 data through the new JSON shape", "pipeline", [{"path": "orders.csv"}, {"groupBy": ["customer", "day", "sku"]}, "json"],
    returns(as_json(["customer", "day", "sku"], usd(CUST_DAY_SKU))))

RETIRED = [
    "s3-json-day-sku", "s3-json-customer", "s3-json-empty", "s3-config-flag-output", "s3-config-all",
    "s4-read-csv", "s4-read-json", "s4-read-format", "s4-agg-sku", "s4-agg-day", "s4-agg-day-sku", "s4-agg-sku-day",
    "s4-agg-range", "s4-agg-range-tokyo", "s4-agg-prefix", "s4-agg-empty", "s4-agg-round-per-record", "s4-agg-no-dedup",
    "s4-agg-no-mutation", "s4-render-text", "s4-render-markdown", "s4-render-html", "s4-render-json", "s4-render-empty-json",
    "s4-pipeline-json-three",
    "s5-tsv-json-output", "s5-api-plugin-read", "s5-api-plugin-format", "s5-api-plugin-extension-case", "s5-api-plugin-bom",
    "s5-api-plugin-no-extensions", "s5-api-plugin-typed", "s5-api-tsv-read",
]


def main():
    ids = [c["id"] for c in cases + api_cases]
    assert len(ids) == len(set(ids))
    root = sys.argv[1]
    write = lambda rel, value: open(os.path.join(root, rel), "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    write("hidden-tests/cases.json", {"cases": cases})
    write("hidden-tests/api-cases.json", {"cases": api_cases})
    write("hidden-tests/retired.json", {"retired": RETIRED})
    visible = lambda items, keep: [dict(c, id=c["id"].replace("s6-", "s6-visible-")) for c in items if c["id"] in keep]
    write("visible-tests/cases.json", {"cases": visible(cases, ["s6-cli-text-day-new-york", "s6-cli-json-customer", "s6-report-utc"])})
    write("visible-tests/api-cases.json", {"cases": visible(api_cases, ["s6-api-read-csv", "s6-api-agg-day-new-york"])})
    print(len(cases), "CLI cases,", len(api_cases), "API cases,", len(RETIRED), "retired")


if __name__ == "__main__":
    main()
