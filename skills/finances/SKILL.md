---
name: finances
description: >
  The operator's money across their companies and their own name: statements imported, tax owed
  now, deadlines as tasks, receipts, monthly close, estimates, the accountant's books. Triggers on
  "finances", "import this statement", "tax", "how much tax do I owe", "receipt", "bookkeeping",
  "close the month", "review the books", "my accountant asked".
allowed-tools:
  - AskUserQuestion
  - Bash
  - Glob
  - Read
  - Write
  - Edit
  - mcp__plugin_agentlayer_agent__capture
  - mcp__plugin_agentlayer_agent__task_create
  - mcp__plugin_agentlayer_agent__task_query
  - mcp__plugin_agentlayer_agent__task_get
  - mcp__plugin_agentlayer_agent__task_update
  - mcp__plugin_agentlayer_agent__task_close
  - mcp__plugin_agentlayer_agent__task_thread
---

# Finances

Keep the operator's money legible: every entity they file for (companies and their own return) ahead of its deadlines, with books a tax agent can work from. The agent prepares, tracks, and drafts. The operator and their tax agent file, pay, and sign.

## Help

`/finances help` (or "what can finances do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. Resolve the project: `PROJECTS=$(bun -e 'import { FOLDERS } from "'"${CLAUDE_SKILL_DIR}"'/../../src/config"; console.log(FOLDERS.PROJECTS)')`; the data lives in `$PROJECTS/finances/`. No `entities/` there yet means the [tax](references/playbooks/tax.md) playbook's setup runs first, whatever was asked.
2. Match the task to a playbook and copy its steps into your todo list.

## Playbooks

| Task | Playbook |
|---|---|
| A bank, card or platform statement or export to add, or files waiting in `data/inbox/` (`/finances import`) | [import](references/playbooks/import.md) |
| Refresh or open the finances page, categorise transactions, a pasted ```` ```finances-edits ```` block, a stated categorising preference, or a question about spending, bills or cash (`/finances dashboard`) | [dashboard](references/playbooks/dashboard.md) |
| Tax, bookkeeping, the monthly close, estimates, the accountant's books or requests (`/finances tax …`) | [tax](references/playbooks/tax.md) |

## Every time

- **Private by default.** Account numbers, tax ids, amounts, and documents stay in the home. Nothing from an entity profile or `data/` goes into a plugin file, a report shared outside the home, or a commit message. A residential address is never transcribed anywhere (profile, ledger, filename, task, draft); a company's registered or office address is fine. Ask before opening a personal document likely to carry one (payslips, employment statements, tenancy papers, utility bills, identity documents, personal bank statements), since whatever is read goes to the model provider. A file the operator drops into `data/inbox/` is the exception: dropping it there is their permission to read it.
- **`data/` stays out of history.** Originals, normalized figures, books reviews and the director balance live under `data/`, which the home's `.gitignore` excludes, as does the generated `dashboard.html`. Never move them elsewhere in the project, and never force-add them.
- **Nothing leaves without the operator.** The agent never files, pays, or sends. Drafts are paste-ready, in the operator's voice.

## Where things live

```
$PROJECTS/finances/
├── README.md
├── entities/<slug>.md                 flat facts (frontmatter) + `## Obligations` and `## Accounts` yaml blocks
├── importers/<institution>.md         an institution's export columns (names only, no figures)
├── RULES.md                           how you categorise, in plain language, and the patterns learned from it
├── closes/<slug>/<YYYY-MM>.md         monthly close records
├── estimates/<slug>/<YA>.md           estimate worksheets
├── reviews/<YYYY-MM-DD>-<topic>.md    optimize and year-end reviews
├── dashboard.html                     the finances page, rendered from data/ (gitignored)
├── tasks/                             deadlines and one-off work
└── data/                              gitignored
    ├── inbox/                         documents the operator drops in (dropping one is consent to read it)
    ├── originals/<slug>/<YYYY-MM>/    filed statements and documents
    ├── receipts/<slug>/<YYYY-MM>/     filed receipts; receipts.csv links each to the line it paid for
    ├── reviews/<YYYY-MM-DD>-<topic>.md books reviews, with the accountant's figures
    ├── director.csv                   each company's director balance as its books stated it
    ├── statements.csv                 one row per imported statement: period, balances, check
    ├── transactions/<slug>/<YYYY>.csv every statement line, as the bank wrote it
    └── ledger/<slug>/<YYYY>.csv       the tax ledger: one row per document or stated figure
```

## Reply

Lead with what the operator has to do and by when, then what the agent recorded (tasks, ledger rows, files) with paths. Money figures show currency and source. End with the drafted message when the playbook produces one.
