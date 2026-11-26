# Task: three bug reports

You maintain this repository: an order aggregation library, a CLI and a report tool built on it. The tools are run as `{{RUN}}` and `{{REPORT}}`; the library's entry point is {{LIB}}. Three users have sent the bug reports below. Fix the bugs. Everything else must keep working exactly as it does now.

{{ARM_NOTES}}

The files the users attached are in `attachments/`.

---

## 1. Euro and pound orders show up as dollars

Since we switched to the new warehouse system, the weekly TSV export it gives us comes out wrong: orders in euros and pounds are counted as dollars. The file opens fine in Excel and the currency column is there. Our old exports were fine.

```
{{RUN}} --input attachments/windows-export.tsv --group-by customer
```

prints

```
customer	revenue
W1	12.00
W2	5.00
TOTAL	17.00
```

but W1 bought for 10 euros and 2 dollars, and W2 for 5 pounds. I expected

```
customer	revenue
W1	10.00 EUR
W1	2.00
W2	5.00 GBP
TOTAL	10.00 EUR
TOTAL	5.00 GBP
TOTAL	2.00
```

---

## 2. Report files for some customers get the wrong name

Our upload script picks up each customer's report by its file name, which should be the customer id with every UTF-8 byte that is not a letter, digit, `-` or `_` written as `%XX`. That works for most customers, but not for Müller or 田中:

```
{{REPORT}} --input attachments/customers.csv --out-dir out
```

writes `out/M%FCller.txt` and `out/%7530%4E2D.txt`. They should be `out/M%C3%BCller.txt` and `out/%E7%94%B0%E4%B8%AD.txt`. What is inside the files is right, and `out/Schmidt.txt` is fine.

---

## 3. `--time-zone` is ignored when I use our config file

Our team config, `attachments/team.json`, sets the time zone to Tokyo. For an export to a partner I need UTC days, so I ran

```
{{RUN}} --input attachments/orders.csv --config attachments/team.json --time-zone UTC
```

and got Tokyo days anyway:

```
day	revenue
2026-03-02	10.00
TOTAL	10.00
```

I expected

```
day	revenue
2026-03-01	4.00
2026-03-02	6.00
TOTAL	10.00
```

Without `--config`, `--time-zone UTC` works. Other options, like `--group-by`, do override the config file.
