# Dashboard

**You own that the finances page tells the truth about the statements behind it, and that every line has a home.** "Refresh my finances", "open the finances dashboard", "categorise the new transactions", "why was October's spending high?", or the end of an [import](import.md).

1. **Render:** `bun "${CLAUDE_SKILL_DIR}/scripts/calendar.ts" render` rebuilds `dashboard.html` from `data/` and `rules.md` (it is *render* in the tax playbooks too: one page, the tax view on its Tax tab). Never edit the page or the data block by hand; change the input and render again.
2. **Read the checks first.** The page's data block (`finance-data`) carries `checks` and `insights`; read them from the rendered file rather than recomputing. A FALSE check is said before any figure: a statement that doesn't add up, days missing between statements, an opening that doesn't follow the closing before it, an account behind. Name the fix (the statement to download, the month to re-import).
3. **Categorise what no rule covers.** List the uncategorised lines (the `lines` with no `category`, grouped by payee) and propose one rule per payee, never one per line, in `rules.md`:
   - a rename under `## Payees` when the bank's description is noisy: `- { match: "^STREAMCO", payee: Streamco }`
   - a category under `## Categories`, by payee or pattern: `- { payee: Streamco, category: subscriptions }`
   - `account:` limits a rule to one account, for a payee that means different things in different books.
   Show the proposed rules as a table (payee, category, lines it covers) and write them on the operator's yes. Two categories change what the page counts: `transfer` (between the operator's own accounts, left out) and `director` (between a company and the operator, counted on the Director page). Charity, zakat, sadaqah and donation are counted on the Charity page. Ask rather than guess whether a payment to a person is a transfer, a director movement, or spending.
4. **Answer from the data.** A question about the money ("why was October high?", "what do we spend on food?") is answered from the data block's `lines` and `recurring`, with the month, the payees and the amounts that explain it, and a pointer to the page that shows it. A figure is the statements' figure, never a guess; a month without statements is said to be missing.
5. **Render again** after writing rules, so the page and its insights reflect them.

**Reply:** the checks that fail and their fix, what changed since the last render (new lines, new insights), the rules written, and the page's path (`projects/finances/dashboard.html`) for the operator to open.
