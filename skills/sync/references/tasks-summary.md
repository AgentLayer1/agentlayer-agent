# The tasks summary

A short read of what the open tasks add up to, kept in `<HOME>/projects/TASKS.md` between `<!-- SUMMARY:START -->` and `<!-- SUMMARY:END -->`, right under the goals. The cmux sidebar opens its Projects page on it. Sync writes it on every run; the heartbeat's wake rewrites it once it's six hours old.

Replace only what sits between the markers, with Edit; a rebuild of TASKS.md keeps the block, as it keeps the goals. The block holds three things:

```markdown
## Tasks at a Glance

_Written 2026-11-20 09:30 +0800 by sync_

Two or three sentences.
```

- **The written line:** the time from `date '+%Y-%m-%d %H:%M %z'`, and who wrote it (`by sync` or `by the heartbeat`).
- **The sentences:** what the open and active tasks add up to across projects: what the work is about, where the weight sits, what is stuck or waiting. No task ids, no lists, and no counts the sidebar already shows.
