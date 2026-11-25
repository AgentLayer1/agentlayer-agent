# Import

**You own that every statement lands once, proven against its own balances, and filed where the books will find it.** A bank, card, wallet or payment-platform statement or export handed over ("import ~/Downloads/october.csv"), files waiting in `data/inbox/`, or a sync nudge that the inbox has files.

1. **List what's waiting:** every file in `data/inbox/` (not `.staged/`), or the path the operator gave. A file outside the inbox is copied when filed; its original is never moved or deleted.
2. **Name the account.** Match each file to an account under an entity profile's `## Accounts` (the institution and the last digits on the statement usually decide it). Ask when it isn't clear whose account it is: a company's statement filed under the operator, or the reverse, puts money in the wrong books. A new account is added to its profile first as `- { id, name, institution, type, currency }` (`type` is `current`, `savings`, `card`, `wallet` or `platform`); ids are unique across entities, and a name carries at most the last four digits, never a full account number.
3. **Get the lines in the engine's shape**, by format:
   - **CSV or XLSX:** the account's institution needs a column map at `importers/<institution>.md` (or the account's `importer:`). When there isn't one, learn it once: look at the first rows of the export (the header, the date style, whether money out is a minus, a debit column, or a positive number on a card), then write the file with flat frontmatter (`institution`, `format`) and a yaml block under `## Columns`:
     ```yaml
     date: Posting Date
     date_format: DD/MM/YYYY      # tokens: YYYY YY MMM MM M DD D
     description: [Description, Reference]
     debit: Withdrawal            # or amount: Amount
     credit: Deposit
     balance: Balance             # leave out when the export has none
     invert: false                # true when charges are positive (most card exports)
     ```
     A column map holds column names only, never figures. Every later export from that institution imports without the model.
   - **PDF:** read it, then write every transaction line to `data/inbox/.staged/<name>.csv` with the header `date,description,amount,balance`: ISO dates, money out negative, the running balance where the statement prints one and blank where it doesn't, and nothing else (no address, no account number, no summary rows). Note the printed opening and closing balances and the period; for a card, the payment due date and the amount due. If a page is illegible, stop and say which, rather than guessing a line.
4. **Dry run:** `bun "${CLAUDE_SKILL_DIR}/scripts/import.ts" <file> --account <id> --dry-run`, adding `--original <pdf>` for a staged PDF, `--opening`/`--closing` when the statement prints them, `--from`/`--to` for its period, and `--due`/`--amount-due` for a card. A refusal names its reason. A balance that does not follow is a misread: re-read that page of a PDF, or fix the column map's sign or debit and credit. Never change a figure to make the check pass.
5. **Import:** the same command without `--dry-run`. The engine files the original under `data/originals/<entity>/<YYYY-MM>/`, appends the new lines to `data/transactions/`, records the statement in `data/statements.csv`, and adds the tax ledger's `statement` row once per account and month, so the books show that month's statement as in.
6. **Say what wasn't proven:** a statement with no balances printed anywhere imports as `unchecked`; tell the operator and ask for one with balances when the account matters for the books. One the engine reports as `alreadyImported` added nothing; delete its inbox copy only on the operator's yes.

**Reply:** one line per statement (account, period, lines added and already known, checked or unchecked), where each original was filed, and anything refused with its reason and the fix.
