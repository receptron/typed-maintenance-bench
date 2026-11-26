"""Writes stage-5 cases.json and api-cases.json (hidden and visible) from hand-computed values.

usage: python3 cases_stage_5.py ../stage-5
"""
import json, os, sys

from cases_stage_3 import RENDER, money

ANY = {"$anyString": True}
UNDEFINED = {"$undefined": True}
TYPE_ERROR = {"throws": "TypeError"}
READ_ERROR = {"throws": "ReadError"}
returns = lambda value: {"returns": value}

# orders.tsv, valid records in cents: 1 C1 2026-12-28 A 2000 | 2 C2 2026-12-31 "B" 495 | 3 C1 2027-01-01 A 375
# 4 C/3 2027-01-03 A 700 | 5 C2 2027-01-04 B 50 (49.5 rounds up) | 6 C1 2026-12-27 A 1000 | 9 C.1 2027-01-10 X 100
TSV_DAY = [(("2026-12-27",), 1000), (("2026-12-28",), 2000), (("2026-12-31",), 495), (("2027-01-01",), 375),
           (("2027-01-03",), 700), (("2027-01-04",), 50), (("2027-01-10",), 100)]
TSV_SKU = [(('"B"',), 495), (("A",), 4075), (("B",), 50), (("X",), 100)]
TSV_CUST = [(("C.1",), 100), (("C/3",), 700), (("C1",), 3375), (("C2",), 545)]
TSV_RANGE_DAY = [(("2027-01-01",), 375), (("2027-01-03",), 700), (("2027-01-04",), 50)]
for rows in [TSV_DAY, TSV_SKU, TSV_CUST]:
    assert sum(c for _, c in rows) == 4720
TSV_WARN = lambda name: [f"{name}:9:", f"{name}:10:", f"{name}:11:"]

# Weeks: 2026-12-27 is a Sunday in 2026-W52; 2026-12-28 to 2027-01-03 is 2026-W53; 2027-01-04 to 01-10 is 2027-W01.
TSV_REPORTS = {
    "C1.txt": ("C1", [("2026-W52", 1000), ("2026-W53", 2375)]),
    "C2.txt": ("C2", [("2026-W53", 495), ("2027-W01", 50)]),
    "C%2F3.txt": ("C/3", [("2026-W53", 700)]),
    "C%2E1.txt": ("C.1", [("2027-W01", 100)]),
}
# orders.csv (stage 3): 2026-03-01 is a Sunday in 2026-W09; 03-02 to 03-05 is 2026-W10.
CSV_REPORTS = {
    "C1.txt": ("C1", [("2026-W09", 2000), ("2026-W10", 1475)]),
    "C2.txt": ("C2", [("2026-W09", 495), ("2026-W10", 650)]),
    "C%273.txt": ("C'3", [("2026-W10", 700)]),
}


def report_file(customer, weeks):
    lines = [f"customer\t{customer}", "week\trevenue", *[f"{w}\t{money(c)}" for w, c in weeks]]
    return "\n".join([*lines, f"TOTAL\t{money(sum(c for _, c in weeks))}"]) + "\n"


def files(directory, reports):
    return {"dir": directory, "contents": {name: report_file(*value) for name, value in reports.items()}}


cases = []


def cli(case_id, desc, args, stdout=None, warn=(), exit_code=0, tool=None, out=None, env=None):
    expect = {"exitCode": exit_code}
    if exit_code == 0:
        expect["stdout"] = stdout if stdout is not None else ""
        expect["stderrPrefixes"] = list(warn)
    else:
        expect["stdout"] = ""
        expect["stderrNonEmpty"] = True
    if out is not None:
        expect["files"] = out
    case = {"id": case_id, "description": desc, **({"tool": tool} if tool else {}), "args": args,
            **({"env": env} if env else {}), "expect": expect}
    cases.append(case)


text = RENDER["text"]
cli("s5-tsv-day", "TSV by day", ["--input", "orders.tsv", "--group-by", "day"], text(["day"], TSV_DAY), TSV_WARN("orders.tsv"))
cli("s5-tsv-sku", "TSV keeps quotes as ordinary characters", ["--input", "orders.tsv", "--group-by", "sku"], text(["sku"], TSV_SKU), TSV_WARN("orders.tsv"))
cli("s5-tsv-customer", "TSV trims spaces", ["--input", "orders.tsv", "--group-by", "customer"], text(["customer"], TSV_CUST), TSV_WARN("orders.tsv"))
cli("s5-tsv-format-flag", "--format tsv for another extension", ["--input", "orders.data", "--format", "tsv", "--group-by", "day"],
    text(["day"], TSV_DAY), TSV_WARN("orders.data"))
cli("s5-tsv-extension-case", "The .tsv extension ignoring case", ["--input", "upper.TSV", "--group-by", "sku"], text(["sku"], TSV_SKU), TSV_WARN("upper.TSV"))
cli("s5-tsv-json-output", "TSV keys in JSON output", ["--input", "orders.tsv", "--group-by", "sku", "--output", "json"],
    RENDER["json"](["sku"], TSV_SKU), TSV_WARN("orders.tsv"))
cli("s5-tsv-markdown-two-keys", "TSV with two keys in Markdown", ["--input", "orders.tsv", "--group-by", "customer,day", "--output", "markdown"],
    RENDER["markdown"](["customer", "day"], [(("C.1", "2027-01-10"), 100), (("C/3", "2027-01-03"), 700), (("C1", "2026-12-27"), 1000),
                                             (("C1", "2026-12-28"), 2000), (("C1", "2027-01-01"), 375), (("C2", "2026-12-31"), 495),
                                             (("C2", "2027-01-04"), 50)]), TSV_WARN("orders.tsv"))
cli("s5-tsv-filter", "Filters on TSV", ["--input", "orders.tsv", "--group-by", "day", "--from", "2027-01-01", "--to", "2027-01-04"],
    text(["day"], TSV_RANGE_DAY), TSV_WARN("orders.tsv"))
cli("s5-tsv-config-format", "Config file chooses tsv", ["--config", "cfg-tsv.json", "--input", "orders.data"], text(["customer"], TSV_CUST), TSV_WARN("orders.data"))
cli("s5-tsv-bom", "TSV with a byte-order mark", ["--input", "bom.tsv", "--group-by", "customer"], text(["customer"], [(("B1",), 200)]))
cli("s5-tsv-short-line", "A short line is invalid even when only optional fields are missing", ["--input", "short.tsv", "--group-by", "customer"],
    text(["customer"], [(("S1",), 200)]), ["short.tsv:2:"])
cli("s5-tsv-header-only", "TSV with no records", ["--input", "header.tsv", "--group-by", "day"], text(["day"], []))
cli("s5-tsv-fatal-missing-column", "TSV header missing a column", ["--input", "missing-column.tsv", "--group-by", "day"], exit_code=2)
cli("s5-tsv-fatal-empty", "TSV with no header line", ["--input", "empty.tsv", "--group-by", "day"], exit_code=2)
cli("s5-tsv-fatal-latin1", "TSV that is not UTF-8", ["--input", "latin1.tsv", "--group-by", "day"], exit_code=2)
cli("s5-fatal-unknown-format", "A format nobody registered", ["--input", "orders.pipe", "--format", "pipe", "--group-by", "day"], exit_code=2)

REPORT = "report"
cli("s5-report-tsv", "One file per customer, ISO weeks across the new year", ["--input", "orders.tsv", "--out-dir", "out"],
    warn=TSV_WARN("orders.tsv"), tool=REPORT, out=files("out", TSV_REPORTS))
cli("s5-report-csv", "Report from CSV, with an apostrophe in a customer id", ["--input", "orders.csv", "--out-dir", "out"],
    warn=["orders.csv:8:", "orders.csv:9:"], tool=REPORT, out=files("out", CSV_REPORTS))
cli("s5-report-json", "Report from JSON", ["--input", "orders.json", "--out-dir", "out"],
    warn=["orders.json:#7:", "orders.json:#8:"], tool=REPORT, out=files("out", CSV_REPORTS))
cli("s5-report-option-order", "Options in any order; --format", ["--out-dir", "out", "--format", "tsv", "--input", "orders.data"],
    warn=TSV_WARN("orders.data"), tool=REPORT, out=files("out", TSV_REPORTS))
cli("s5-report-nested-dir", "Creates the directory and its parents", ["--input", "orders.csv", "--out-dir", "nested/a/b"],
    warn=["orders.csv:8:", "orders.csv:9:"], tool=REPORT, out=files("nested", {f"a/b/{k}": v for k, v in CSV_REPORTS.items()}))
cli("s5-report-input-as-given", "Warnings name the input as given", ["--input", "./orders.tsv", "--out-dir", "out"],
    warn=TSV_WARN("./orders.tsv"), tool=REPORT, out=files("out", TSV_REPORTS))
cli("s5-report-no-records", "No valid records: no files", ["--input", "header.tsv", "--out-dir", "out"], tool=REPORT, out=files("out", {}))
cli("s5-report-bom", "Report from TSV with a byte-order mark", ["--input", "bom.tsv", "--out-dir", "out"], tool=REPORT,
    out=files("out", {"B1.txt": ("B1", [("2026-W10", 200)])}))
cli("s5-report-utc", "Weeks do not depend on the machine's time zone", ["--input", "orders.tsv", "--out-dir", "out"],
    warn=TSV_WARN("orders.tsv"), tool=REPORT, out=files("out", TSV_REPORTS), env={"TZ": "Pacific/Kiritimati"})
for case_id, desc, args in [
    ("s5-report-fatal-no-out-dir", "--out-dir is required", ["--input", "orders.tsv"]),
    ("s5-report-fatal-no-input", "--input is required", ["--out-dir", "out"]),
    ("s5-report-fatal-unknown-option", "Unknown option", ["--input", "orders.tsv", "--out-dir", "out", "--group-by", "day"]),
    ("s5-report-fatal-missing-value", "Option without a value", ["--out-dir", "out", "--input"]),
    ("s5-report-fatal-missing-file", "Input that cannot be read", ["--input", "missing.tsv", "--out-dir", "out"]),
    ("s5-report-fatal-missing-column", "TSV header missing a column", ["--input", "missing-column.tsv", "--out-dir", "out"]),
    ("s5-report-fatal-unknown-format", "Unknown format", ["--input", "orders.tsv", "--format", "pipe", "--out-dir", "out"]),
    ("s5-report-fatal-extension", "Extension that names no format", ["--input", "orders.pipe", "--out-dir", "out"]),
]:
    cli(case_id, desc, args, exit_code=2, tool=REPORT, out=files("out", {}))
cli("s5-report-fatal-dir", "A directory that cannot be created", ["--input", "orders.tsv", "--out-dir", "blocker.txt/reports"],
    exit_code=2, tool=REPORT)

api_cases = []


def api(case_id, desc, call, args, expect, setup=None, **extra):
    api_cases.append({"id": case_id, "description": desc, **({"setup": setup} if setup else {}), "call": call, "args": args,
                      **extra, "expect": expect})


def plugin(name="pipe", extensions=(".pipe",), parser="pipe", **extra):
    return {"name": name, "extensions": list(extensions), "parse": {"$plugin": parser}, **extra}


register = lambda *args, **kwargs: {"call": "registerFormat", "args": [plugin(*args, **kwargs)]}


def rec(order_id, customer, date, sku, quantity, cents, discount=0, notes=""):
    return {"orderId": order_id, "customerId": customer, "orderDate": date, "sku": sku, "quantity": quantity,
            "unitPriceCents": cents, "discountPercent": discount, "notes": notes}


# A plugin's problem is the reason; every other reason is free text.
PLUGIN_REASONS = {("orders.pipe", "5"): "too few fields", ("any.typed", "d"): "rejected by the plugin"}
warnings = lambda file, locations: [{"file": file, "location": loc, "reason": PLUGIN_REASONS.get((file, loc), ANY)} for loc in locations]
PIPE_RECORDS = [rec("1", "P1", "2026-03-01", "A", 2, 100), rec("2", "P1", "2026-03-02", "B", 1, 250, 20, "x")]
pipe_read = lambda file: {"records": PIPE_RECORDS, "warnings": warnings(file, ["4", "5", "6"])}
TSV_RECORDS = [rec("1", "C1", "2026-12-28", "A", 2, 1000), rec("2", "C2", "2026-12-31", '"B"', 1, 550, 10),
               rec("3", "C1", "2027-01-01", "A", 3, 125), rec("4", "C/3", "2027-01-03", "A", 1, 700),
               rec("5", "C2", "2027-01-04", "B", 1, 99, 50), rec("6", "C1", "2026-12-27", "A", 4, 250, 0, "note"),
               rec("9", "C.1", "2027-01-10", "X", 1, 100)]

api("s5-api-register-returns", "registerFormat returns undefined", "registerFormat", [plugin()], returns(UNDEFINED))
api("s5-api-plugin-read", "Records from a plugin follow every rule", "read", [{"path": "orders.pipe"}], returns(pipe_read("orders.pipe")), [register()])
api("s5-api-plugin-format", "A plugin chosen by name", "read", [{"path": "orders.txt", "format": "pipe"}], returns(pipe_read("orders.txt")), [register()])
api("s5-api-plugin-extension-case", "A plugin extension matches ignoring case", "read", [{"path": "upper.PIPE"}], returns(pipe_read("upper.PIPE")), [register()])
api("s5-api-plugin-bom", "parse gets the text without its byte-order mark", "read", [{"path": "bom.pipe"}], returns(pipe_read("bom.pipe")), [register()])
api("s5-api-plugin-no-extensions", "A plugin with no extensions, chosen by name", "read", [{"path": "orders.pipe", "format": "noext"}],
    returns(pipe_read("orders.pipe")), [register("noext", [])])
api("s5-api-plugin-typed", "Plugin values follow the typed-format rules", "read", [{"path": "any.typed"}],
    returns({"records": [rec("1", "T1", "2026-03-01", "T", 2, 150, 0, "5"), rec("4", "T3", "2026-03-03", "U", 3, 50)],
             "warnings": warnings("any.typed", ["b", "c", "d", "e", "f"])}), [register("typed", [".typed"], "typed")])
api("s5-api-plugin-pipeline", "A plugin format through aggregate and render", "pipeline", [{"path": "orders.pipe"}, {"groupBy": ["customer"]}, "text"],
    returns(text(["customer"], [(("P1",), 400)])), [register()])
api("s5-api-plugin-throws", "parse throws", "read", [{"path": "any.typed"}], READ_ERROR, [register("typed", [".typed"], "throws")])
api("s5-api-plugin-bad-return", "parse returns something other than an array", "read", [{"path": "any.typed"}], READ_ERROR,
    [register("typed", [".typed"], "bad-return")])
api("s5-api-plugin-bad-entry", "parse returns an entry of the wrong shape", "read", [{"path": "any.typed"}], READ_ERROR,
    [register("typed", [".typed"], "bad-entry")])
api("s5-api-plugin-latin1", "A plugin file that is not UTF-8", "read", [{"path": "latin1.pipe"}], READ_ERROR, [register()])
api("s5-api-plugin-missing-file", "A plugin file that cannot be read", "read", [{"path": "missing.pipe"}], READ_ERROR, [register()])
api("s5-api-unregistered-extension", "An extension nobody registered", "read", [{"path": "orders.pipe"}], TYPE_ERROR)
api("s5-api-unregistered-format", "A format nobody registered", "read", [{"path": "orders.pipe", "format": "pipe"}], TYPE_ERROR)
api("s5-api-tsv-read", "TSV through read", "read", [{"path": "orders.tsv"}], returns({"records": TSV_RECORDS, "warnings": warnings("orders.tsv", ["9", "10", "11"])}))
api("s5-api-tsv-missing-column", "TSV with a missing column", "read", [{"path": "missing-column.tsv"}], READ_ERROR)
for case_id, desc, arg in [
    ("s5-api-register-type-string", "plugin is not an object", "pipe"),
    ("s5-api-register-type-no-parse", "parse is missing", {"name": "pipe", "extensions": [".pipe"]}),
    ("s5-api-register-type-parse", "parse is not a function", {"name": "pipe", "extensions": [".pipe"], "parse": "split"}),
    ("s5-api-register-type-builtin-name", "The name of a built-in format", plugin("csv")),
    ("s5-api-register-type-tsv-name", "TSV is already registered", plugin("tsv")),
    ("s5-api-register-type-uppercase-name", "A name with uppercase letters", plugin("Pipe")),
    ("s5-api-register-type-digit-name", "A name starting with a digit", plugin("1pipe")),
    ("s5-api-register-type-empty-name", "An empty name", plugin("")),
    ("s5-api-register-type-extensions", "extensions is not an array", {**plugin(), "extensions": ".pipe"}),
    ("s5-api-register-type-no-dot", "An extension without a dot", plugin(extensions=["pipe"])),
    ("s5-api-register-type-uppercase-extension", "An extension with uppercase letters", plugin(extensions=[".PIPE"])),
    ("s5-api-register-type-taken-extension", "An extension of a built-in format", plugin(extensions=[".yml"])),
    ("s5-api-register-type-tsv-extension", "The TSV extension", plugin(extensions=[".tsv"])),
    ("s5-api-register-type-repeated-extension", "The same extension twice", plugin(extensions=[".pipe", ".pipe"])),
    ("s5-api-register-type-extra", "A property not in the contract", plugin(description="pipes")),
]:
    api(case_id, desc, "registerFormat", [arg], TYPE_ERROR)
api("s5-api-register-type-twice", "The same name twice", "registerFormat", [plugin(extensions=[])], TYPE_ERROR, [register()])
api("s5-api-register-type-extension-twice", "An extension another plugin has", "registerFormat", [plugin("pipe2")], TYPE_ERROR, [register()])
FAILED = {"call": "registerFormat", "args": [plugin(extensions=[".pipe", "bad"])], "throws": True}
api("s5-api-register-failed-registers-nothing", "A rejected plugin is not registered", "read", [{"path": "orders.pipe"}], TYPE_ERROR, [FAILED])
api("s5-api-register-after-failure", "A rejected plugin leaves its name free", "registerFormat", [plugin()], returns(UNDEFINED), [FAILED])


def main():
    ids = [c["id"] for c in cases + api_cases]
    assert len(ids) == len(set(ids))
    root = sys.argv[1]
    write = lambda rel, value: open(os.path.join(root, rel), "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    write("hidden-tests/cases.json", {"cases": cases})
    write("hidden-tests/api-cases.json", {"cases": api_cases})
    visible = lambda items, keep: [dict(c, id=c["id"].replace("s5-", "s5-visible-")) for c in items if c["id"] in keep]
    write("visible-tests/cases.json", {"cases": visible(cases, ["s5-tsv-day", "s5-report-tsv"])})
    write("visible-tests/api-cases.json", {"cases": visible(api_cases, ["s5-api-plugin-read", "s5-api-register-type-builtin-name"])})
    print(len(cases), "CLI cases,", len(api_cases), "API cases")


if __name__ == "__main__":
    main()
