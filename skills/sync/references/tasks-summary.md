# The tasks summary

The theme of the open tasks, in one line, the way the year's goals have a theme, kept in `<HOME>/projects/TASKS.md` between `<!-- SUMMARY:START -->` and `<!-- SUMMARY:END -->`, right under the goals. The cmux sidebar opens its Projects page on it. Sync writes it on every run; the heartbeat's wake rewrites it once it's six hours old.

Replace only what sits between the markers, with Edit; a rebuild of TASKS.md keeps the block, as it keeps the goals. The block holds three things:

```markdown
## Tasks at a Glance

_Written 2026-11-20 09:30 +0800 by sync_

Shipping the store relaunch while the paperwork waits on other people.
```

- **The written line:** the time from `date '+%Y-%m-%d %H:%M %z'`, and who wrote it (`by sync` or `by the heartbeat`).
- **The theme:** one sentence of at most about 15 words, which the sidebar shows on two lines: what this stretch of work is about across every project, not a status report. Name the big themes, never a task, an id, a date, a count, a person, or anything in parentheses; the task list right under it carries the detail.
