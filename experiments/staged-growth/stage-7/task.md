# Task: bug reports

You maintain this repository: an order aggregation library, a CLI and a report tool built on it. The tools are run as `{{RUN}}` and `{{REPORT}}`; the library's entry point is {{LIB}}.

{{ARM_NOTES}}

The tool was built from the requests in `docs/requests/`, in order; where a later request changes an earlier one, the later one holds. Together they are the documentation of how the library and both tools behave.

Users have sent the reports below; the files they attached are in `attachments/`. Fix what is wrong, wherever in the code it is wrong. Behaviour that follows the documentation is not a bug, even when a user expects something else: leave it as it is. Everything else must keep working exactly as it does now.

---

## 1. Euros and pounds counted as dollars

Since we switched to the new warehouse system, the weekly TSV export it gives us comes out wrong: orders in euros and pounds are counted as dollars. The file opens fine in Excel and the currency column is there. Our old exports were fine.

```
{{RUN}} --input attachments/windows-export.tsv --group-by customer
```

```
customer	revenue
W1	12.00
W2	5.00
TOTAL	17.00
```

W1 bought for 10 euros and 2 dollars, and W2 for 5 pounds.

---

## 2. Our upload script cannot find some reports

Our upload script looks for each customer's report by its file name, built with the rule from your documentation. It finds every customer's report except Müller's and 田中's:

```
{{REPORT}} --input attachments/customers.csv --out-dir out
```

leaves `out/M%FCller.txt`, `out/%7530%4E2D.txt` and `out/Schmidt.txt`.

---

## 3. `--time-zone` ignored with our config file

Our team config, `attachments/team.json`, sets the time zone to Tokyo. For an export to a partner I need UTC days, so I ran

```
{{RUN}} --input attachments/orders.csv --config attachments/team.json --time-zone UTC
```

and got Tokyo days anyway. Without `--config`, `--time-zone UTC` works, and other options such as `--group-by` do override the config file.

---

## 4. Our accounting system rejects the HTML table

Our accounting system imports the HTML output and checks that the rows are in the order your documentation describes. Since we added the sushi set to the menu it rejects the table:

```
{{RUN}} --input attachments/menu.csv --group-by sku --output html
```

```
<table>
<thead>
<tr><th>sku</th><th>revenue</th></tr>
</thead>
<tbody>
<tr><td>B-02</td><td>3.00</td></tr>
<tr><td>🍣-01</td><td>16.00</td></tr>
<tr><td>ＳＥＴ-01</td><td>12.00</td></tr>
</tbody>
<tfoot>
<tr><td>TOTAL</td><td>31.00</td></tr>
</tfoot>
</table>
```

---

## 5. Orders land on the wrong day

An order placed at half past midnight on 2 March in Tokyo is counted on 1 March:

```
{{RUN}} --input attachments/tokyo-orders.csv --group-by day
```

```
day	revenue
2026-03-01	9.00
TOTAL	9.00
```

The file says `2026-03-02T00:30:00+09:00`, so it is clearly 2 March. Please use the date as it is written in the file.
