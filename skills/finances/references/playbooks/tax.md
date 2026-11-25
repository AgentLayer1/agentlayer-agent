# Tax

**You own that every entity the operator files for stays ahead of its deadlines, with books a tax agent can work from.** Anything about tax, bookkeeping, the monthly close, estimates, or the accountant: `/finances tax <what's due | position | receipt | close | estimate | review | help>`, or the same asked in words.

1. Read the profile of each entity the task touches (`entities/<slug>.md`) and the country reference it names (`references/countries/<country>.md`). Rules, rates, and dates come from that file, never from memory.
2. Match the task to a playbook below and copy its steps into your todo list.

| Task | Playbook |
|---|---|
| First run, a new entity, or a changed fact (FYE, payroll, SST) | [setup](tax/setup.md) |
| "What's due?", refresh deadlines, `/finances tax calendar` | [calendar](tax/calendar.md) |
| "How much tax do I owe?", "how much should I set aside?", "will I get a refund?" | [position](tax/position.md) |
| A receipt, invoice, or statement to record, `/finances tax capture` | [capture](tax/capture.md) |
| Close last month for the accountant, `/finances tax close`, "what do I need to collect?", "what's missing for the books?" | [close](tax/close.md) |
| How much tax to estimate or revise, and the cash to set aside | [estimate](tax/estimate.md) |
| The accountant's management accounts or general ledger to review before approving them, `/finances tax review` | [books-review](tax/books-review.md) |
| An email or request from the accountant or tax authority | [accountant](tax/accountant.md) |
| Ways to pay less, legally; what to ask the tax agent | [optimize](tax/optimize.md) |
| After the financial year ends: annual returns and filings | [year-end](tax/year-end.md) |

## Every time

- **Deadlines are tasks.** Every dated obligation lives as a task in the `finances` project with a `due` date, the `tax` label and its `obl:<entity>:<obligation>:<period>` label, so it surfaces beside every other deadline. Every other tax task carries `tax` too: the engine reads only tasks labelled `tax`. Never keep a deadline only in prose, and never edit an `obl:` label: it is the key that stops a deadline being created twice.
- **The engine does the math.** `bun "${CLAUDE_SKILL_DIR}/scripts/calendar.ts" plan` lists what is due and missing; `liability` prices what each entity owes right now from the ledger and the country's `## Rates` block; `books` gives each company's month-by-month bookkeeping state and what is left to collect; `render` regenerates `dashboard.html`. Playbooks call these *the engine's plan*, *liability*, *books*, and *render*. Never compute a statutory date or a tax figure by hand, and never edit the dashboard.
- **Every figure carries its source.** A number comes from a document (file path), the ledger, or the operator's words, and says which. An estimate is labelled an estimate.
- **Questions, not rulings.** The agent drafts the question and the numbers; the tax agent decides the treatment. Never tell the operator a position is safe to file. On religious matters (zakat and the like), describe the tax effect only.
- **One company, one role, per message.** A message to the accountant covers one entity. At a firm, the bookkeeper gets recording and classification questions and the tax agent gets treatments; the books are final before the tax questions go out.
