"""Writes stage-4 api-cases.json (hidden and visible) and the visible cases.json from hand-computed values.

usage: python3 cases_stage_4.py ../stage-4
"""
import json, os, sys

from cases_stage_3 import CUST_DAY_SKU, DAY, DAY_SKU, PREFIX_A_DASH, RANGE_DAY, RENDER, SKU, SKU_DAY

ANY = {"$anyString": True}
Q = '<b>&"q"'


def rec(order_id, customer, date, sku, quantity, cents, discount=0, notes=""):
    return {"orderId": order_id, "customerId": customer, "orderDate": date, "sku": sku, "quantity": quantity,
            "unitPriceCents": cents, "discountPercent": discount, "notes": notes}


RECORDS = [
    rec("1", "C1", "2026-03-01", "A-1", 2, 1000),
    rec("2", "C2", "2026-03-01", "B|x", 1, 550, 10),
    rec("3", "C1", "2026-03-02", "A-1", 3, 125),
    rec("4", "C'3", "2026-03-02", Q, 1, 700),
    rec("5", "C2", "2026-03-03", "A-2", 1, 99, 50),
    rec("6", "C1", "2026-03-03", "ß", 4, 250, 0, "gift wrap"),
    rec("8", "C2", "2026-03-05", "B|x", 2, 300),
    rec("9", "C1", "2026-03-05", "A", 1, 100),
]


def warnings(file, locations):
    return [{"file": file, "location": location, "reason": ANY} for location in locations]


def result(keys, rows):
    return {"groupBy": keys, "rows": [{"key": list(k), "revenueCents": c} for k, c in rows], "totalCents": sum(c for _, c in rows)}


cases = []


def case(case_id, desc, call, args, expect, **extra):
    cases.append({"id": case_id, "description": desc, "call": call, "args": args, **extra, "expect": expect})


returns = lambda value: {"returns": value}
TYPE_ERROR = {"throws": "TypeError"}
READ_ERROR = {"throws": "ReadError"}
CSV = {"path": "orders.csv"}

case("s4-read-csv", "Valid records after the duplicate rule, and warnings", "read", [CSV],
     returns({"records": RECORDS, "warnings": warnings("orders.csv", ["8", "9"])}))
case("s4-read-json", "JSON locations are #n", "read", [{"path": "orders.json"}],
     returns({"records": RECORDS, "warnings": warnings("orders.json", ["#7", "#8"])}))
case("s4-read-format", "format overrides the extension", "read", [{"path": "orders.data", "format": "csv"}],
     returns({"records": RECORDS, "warnings": warnings("orders.data", ["8", "9"])}))
case("s4-read-missing", "File that cannot be read", "read", [{"path": "missing.csv"}], READ_ERROR)
case("s4-read-syntax", "Invalid JSON", "read", [{"path": "syntax.json"}], READ_ERROR)
case("s4-read-missing-column", "Header missing a column", "read", [{"path": "missing-column.csv"}], READ_ERROR)
case("s4-read-type-string", "source is a string, not an object", "read", ["orders.csv"], TYPE_ERROR)
case("s4-read-type-no-path", "source without path", "read", [{}], TYPE_ERROR)
case("s4-read-type-path-number", "path is not a string", "read", [{"path": 5}], TYPE_ERROR)
case("s4-read-type-format", "Unknown format", "read", [{"path": "orders.csv", "format": "pdf"}], TYPE_ERROR)
case("s4-read-type-extension", "No format and an extension that names none", "read", [{"path": "orders.data"}], TYPE_ERROR)
case("s4-read-type-extra", "Property not in the contract", "read", [{"path": "orders.csv", "groupBy": ["day"]}], TYPE_ERROR)
case("s4-read-type-missing-arg", "No argument", "read", [], TYPE_ERROR)

FROM_CSV = {"recordsFrom": CSV}
case("s4-agg-sku", "Group by one key", "aggregate", [{"groupBy": ["sku"]}], returns(result(["sku"], SKU)), **FROM_CSV)
case("s4-agg-day", "Group by day", "aggregate", [{"groupBy": ["day"]}], returns(result(["day"], DAY)), **FROM_CSV)
case("s4-agg-day-sku", "Two keys", "aggregate", [{"groupBy": ["day", "sku"]}], returns(result(["day", "sku"], DAY_SKU)), **FROM_CSV)
case("s4-agg-sku-day", "Component-wise sort", "aggregate", [{"groupBy": ["sku", "day"]}], returns(result(["sku", "day"], SKU_DAY)), **FROM_CSV)
case("s4-agg-range", "Date range", "aggregate", [{"groupBy": ["day"], "from": "2026-03-02", "to": "2026-03-03"}], returns(result(["day"], RANGE_DAY)), **FROM_CSV)
case("s4-agg-range-tokyo", "Date range independent of TZ", "aggregate", [{"groupBy": ["day"], "from": "2026-03-02", "to": "2026-03-03"}],
     returns(result(["day"], RANGE_DAY)), env={"TZ": "Asia/Tokyo"}, **FROM_CSV)
case("s4-agg-prefix", "SKU prefix", "aggregate", [{"groupBy": ["sku"], "skuPrefix": "A-"}], returns(result(["sku"], PREFIX_A_DASH)), **FROM_CSV)
case("s4-agg-empty", "No records", "aggregate", [[], {"groupBy": ["day"]}], returns({"groupBy": ["day"], "rows": [], "totalCents": 0}))
ROUNDING = [rec("r1", "C1", "2026-03-01", "R", 1, 99, 50), rec("r2", "C1", "2026-03-01", "R", 1, 99, 50)]
case("s4-agg-round-per-record", "Each record rounds on its own: 49.5 + 49.5 is 50 + 50", "aggregate",
     [ROUNDING, {"groupBy": ["sku"]}], returns(result(["sku"], [(("R",), 100)])))
SAME = [rec("d", "C1", "2026-03-01", "D", 1, 100), rec("d", "C1", "2026-03-01", "D", 1, 100)]
case("s4-agg-no-dedup", "aggregate sums every record it is given", "aggregate",
     [SAME, {"groupBy": ["customer"]}], returns(result(["customer"], [(("C1",), 200)])))
UNSORTED = [rec("u1", "C2", "2026-03-02", "B", 1, 100), rec("u2", "C1", "2026-03-01", "A", 1, 200)]
case("s4-agg-no-mutation", "Records stay as given (the runner checks every argument)", "aggregate",
     [UNSORTED, {"groupBy": ["day"]}], returns(result(["day"], [(("2026-03-01",), 200), (("2026-03-02",), 100)])))
for case_id, desc, spec in [
    ("s4-agg-type-no-groupby", "spec without groupBy", {}),
    ("s4-agg-type-groupby-empty", "Empty groupBy", {"groupBy": []}),
    ("s4-agg-type-groupby-string", "groupBy is a string", {"groupBy": "day"}),
    ("s4-agg-type-groupby-unknown", "Unknown key", {"groupBy": ["week"]}),
    ("s4-agg-type-groupby-dup", "Repeated key", {"groupBy": ["day", "day"]}),
    ("s4-agg-type-from-date", "from is not a calendar date", {"groupBy": ["day"], "from": "2026-02-30"}),
    ("s4-agg-type-from-number", "from is not a string", {"groupBy": ["day"], "from": 20260301}),
    ("s4-agg-type-range", "from later than to", {"groupBy": ["day"], "from": "2026-03-05", "to": "2026-03-01"}),
    ("s4-agg-type-prefix", "skuPrefix is not a string", {"groupBy": ["sku"], "skuPrefix": 5}),
    ("s4-agg-type-extra", "Property not in the contract", {"groupBy": ["day"], "fromDate": "2026-03-01"}),
]:
    case(case_id, desc, "aggregate", [spec], TYPE_ERROR, **FROM_CSV)
case("s4-agg-type-records", "records is not an array", "aggregate", ["orders.csv", {"groupBy": ["day"]}], TYPE_ERROR)
case("s4-agg-type-spec", "spec is missing", "aggregate", [RECORDS], TYPE_ERROR)

DAY_SKU_RESULT = result(["day", "sku"], DAY_SKU)
for output in ["text", "markdown", "html", "json"]:
    case(f"s4-render-{output}", f"render {output} matches the CLI", "render", [DAY_SKU_RESULT, output], returns(RENDER[output](["day", "sku"], DAY_SKU)))
case("s4-render-empty-json", "render with no rows", "render", [{"groupBy": ["day"], "rows": [], "totalCents": 0}, "json"], returns(RENDER["json"](["day"], [])))
case("s4-render-type-format", "Unknown format", "render", [DAY_SKU_RESULT, "csv"], TYPE_ERROR)
case("s4-render-type-missing", "No format", "render", [DAY_SKU_RESULT], TYPE_ERROR)

case("s4-pipeline-markdown", "read, aggregate, render", "pipeline", [CSV, {"groupBy": ["day", "sku"]}, "markdown"],
     returns(RENDER["markdown"](["day", "sku"], DAY_SKU)))
case("s4-pipeline-json-three", "JSON input, three keys", "pipeline", [{"path": "orders.json"}, {"groupBy": ["customer", "day", "sku"]}, "json"],
     returns(RENDER["json"](["customer", "day", "sku"], CUST_DAY_SKU)))

ids = [c["id"] for c in cases]
assert len(ids) == len(set(ids))
root = sys.argv[1]
write = lambda rel, value: open(os.path.join(root, rel), "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
write("hidden-tests/api-cases.json", {"cases": cases})
VISIBLE = ["s4-read-csv", "s4-agg-day-sku", "s4-render-markdown", "s4-read-type-format"]
write("visible-tests/api-cases.json", {"cases": [dict(c, id=c["id"].replace("s4-", "s4-visible-")) for c in cases if c["id"] in VISIBLE]})
write("visible-tests/cases.json", {"cases": [{
    "id": "s4-visible-cli", "description": "The CLI keeps working", "args": ["--input", "orders.csv", "--group-by", "day,sku", "--output", "markdown"],
    "expect": {"exitCode": 0, "stdout": RENDER["markdown"](["day", "sku"], DAY_SKU), "stderrPrefixes": ["orders.csv:8:", "orders.csv:9:"]}}]})
print(len(cases), "API cases")
