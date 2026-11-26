"""Writes stage-7 cases.json and api-cases.json from hand-computed values. Case ids start with s7-<bug id>-,
which is how the harness tells which cases belong to which seeded bug (stage-7/bugs.json).

usage: python3 cases_stage_7.py ../stage-7
"""
import json, os, sys

from cases_stage_6 import (DAY_NEW_YORK, DAY_UTC, REPORT_TSV6, TSV6_CUST, TSV6_DAY_NEW_YORK, WARN_6, files, rec,
                           text)

cases = []
api_cases = []


def cli(case_id, desc, args, stdout="", warn=(), tool=None, out=None):
    expect = {"exitCode": 0, "stdout": stdout, "stderrPrefixes": list(warn)}
    if out is not None:
        expect["files"] = out
    cases.append({"id": case_id, "description": desc, **({"tool": tool} if tool else {}), "args": args, "expect": expect})


# Bug a: CRLF line ends in TSV, with the currency in the last column. crlf6.tsv has orders6.tsv's records.
cli("s7-a-cli-customer", "CRLF TSV keeps the currency of the last column", ["--input", "crlf6.tsv", "--group-by", "customer"],
    text(["customer"], TSV6_CUST))
cli("s7-a-cli-day-new-york", "CRLF TSV by day in New York", ["--input", "crlf6.tsv", "--group-by", "day", "--time-zone", "America/New_York"],
    text(["day"], TSV6_DAY_NEW_YORK))
cli("s7-a-report", "Report from CRLF TSV", ["--input", "crlf6.tsv", "--out-dir", "out"], tool="report", out=files("out", REPORT_TSV6))
api_cases.append({"id": "s7-a-api-read", "description": "read of CRLF TSV", "call": "read", "args": [{"path": "crlf6.tsv"}],
                  "expect": {"returns": {"records": [rec("1", "T1", "2026-03-01T22:00:00-03:00", "A", 1, 100, "EUR"),
                                                     rec("2", "T1", "2026-03-02", "A", 1, 200),
                                                     rec("3", "T2", "2026-03-02", "B", 2, 150, "JPY")], "warnings": []}}})

# Bug b: report file names percent-encode UTF-8 bytes. All five orders fall in 2026-W10 (2 to 8 March).
NAMES = {"M%C3%BCller": ("Müller", 100), "%E7%94%B0%E4%B8%AD": ("田中", 200), "Zo%C3%AB-1": ("Zoë-1", 300),
         "%F0%9F%99%82x": ("🙂x", 400), "A_b": ("A_b", 500)}


def name_files(directory):
    content = lambda customer, cents: f"customer\t{customer}\nweek\trevenue\n2026-W10\t{cents // 100}.{cents % 100:02d}\nTOTAL\t{cents // 100}.{cents % 100:02d}\n"
    return {"dir": directory, "contents": {f"{name}.txt": content(*value) for name, value in NAMES.items()}}


cli("s7-b-report-csv", "Non-ASCII customer ids, byte by byte", ["--input", "names.csv", "--out-dir", "out"], tool="report", out=name_files("out"))
cli("s7-b-report-json", "Non-ASCII customer ids from JSON", ["--input", "names.json", "--out-dir", "reports"], tool="report",
    out=name_files("reports"))

# Bug c: --time-zone overrides timeZone from the config file.
IN6 = ["--input", "orders6.csv", "--config", "cfg-tokyo.json"]
cli("s7-c-flag-utc", "--time-zone UTC over a Tokyo config", [*IN6, "--time-zone", "UTC"], text(["day"], DAY_UTC), WARN_6)
cli("s7-c-flag-new-york", "--time-zone New York over a Tokyo config", [*IN6, "--time-zone", "America/New_York"], text(["day"], DAY_NEW_YORK), WARN_6)
# orders-c.csv: K1 03-01T22:00Z 3.00 and K2 03-02T02:00Z 2 × 1.50; both are on 1 March in New York, 2 March in Tokyo.
cli("s7-c-flag-with-filter", "--time-zone decides which records a date filter keeps",
    ["--input", "orders-c.csv", "--config", "cfg-tokyo.json", "--group-by", "customer", "--from", "2026-03-01", "--to", "2026-03-01",
     "--time-zone", "America/New_York"], text(["customer"], [(("K1",), "USD", 300), (("K2",), "USD", 300)]))


def main():
    ids = [c["id"] for c in cases + api_cases]
    assert len(ids) == len(set(ids))
    root = sys.argv[1]
    write = lambda rel, value: open(os.path.join(root, rel), "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    write("hidden-tests/cases.json", {"cases": cases})
    write("hidden-tests/api-cases.json", {"cases": api_cases})
    print(len(cases), "CLI cases,", len(api_cases), "API cases")


if __name__ == "__main__":
    main()
