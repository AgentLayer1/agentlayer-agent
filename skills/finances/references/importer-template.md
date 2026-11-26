---
institution: acme-bank
format: pdf
---

# Acme Bank statement (PDF)

How `pdf.ts` reads this institution's PDF statements. Copy this file to `importers/<institution>.md` in the finances project and change the values to match the statement. `bun pdf.ts <pdf> --draft` prints a starting point. A layout holds labels and patterns only, never figures.

## Layout

```yaml
date: DD/MM/YYYY              # the date at the start of each transaction line: YYYY YY MMM MM M DD D
columns:
  debit: Withdrawal           # header label over money out (a pattern; escape brackets: "Balance \\(USD\\)")
  credit: Deposit             # header label over money in
  balance: Balance            # leave out when the statement prints no running balance
  charges: [Fee]              # columns holding a fee or tax on the line, counted as money out; leave out when none
opening: OPENING BALANCE      # the line holding the opening balance (its last figure is read)
closing: CLOSING BALANCE      # the line holding the closing balance
end: CONTINUED ON NEXT PAGE   # lines that end a transaction's description: page footers, "continued"
```

Each page's header row sets where its columns sit, so a column that moves or appears on one page only still reads. A figure belongs to the column whose label it ends nearest. A date line with no figures takes them from the line under it, and up to three indented lines below a transaction join its description.
