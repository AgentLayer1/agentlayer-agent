# Welcome — the first session after init

Init can't ask what to do first: the operator has to exit and relaunch before the plugin, the identity files and the hooks take effect. So init leaves `"welcome": "pending"` in `<HOME>/.state/cadence.json`, and the SessionStart hook points here until the question has been answered. Ask it once, run the pick, and clear the flag.

`<PLUGIN_ROOT>` below is the plugin root the session context names.

## A moved home

When `<HOME>/.state/version.json` has `migratedFrom`, this home came from the previous plugin's move, and the session context says so. Usually the move copied it here from another folder; when `migratedFrom.home` is this folder, it moved in place: same folder, a new plugin. Follow this section instead of sections 2 and 4 (step 5 can fall back to section 2's options, which need section 1's reads); section 3 still clears the flag. A session that comes back after a restart (the `Moved` line from step 2 is already in `knowledge/memory/index.md`) goes straight to step 4.

1. **Greet as the agent.** One or two lines in IDENTITY's voice: the name, `Formerly:` when IDENTITY has it, that the home moved here from `migratedFrom.home` on `migratedFrom.at` (in place: that it moved from the `migratedFrom.plugin` plugin), and that you'll finish the move first.
2. **Remember where it came from.** Add one line under `## Key Context` in `knowledge/memory/index.md`, unless one is already there:
   `- **Moved** — this home was copied from \`<migratedFrom.home>\` on <migratedFrom.at>, where the agent was <migratedFrom.name> on the <migratedFrom.plugin> plugin; session logs, reports and archives from before then use those names.`
   In place, the line reads: `- **Moved** — this home moved in place from the <migratedFrom.plugin> plugin on <migratedFrom.at>, where the agent was <migratedFrom.name>; session logs, reports and archives from before then use that plugin's names.`
   The dated records keep the old names for good, so this line stays as long as they do.
3. **Check the move, before the upgrade and the sync rewrite its lines.** The move saved its full change list in the copy, and `--restore` only puts back a line that still reads as the move left it, so read the list first, with the operator:
   ```bash
   bun "<PLUGIN_ROOT>/skills/init/scripts/move-check.ts" --home "<HOME>"
   ```
   - `log: null`: the home was moved by a release that kept no list. Say so in one line and go on.
   - Read every line under `renames` for meaning, as the move's keep review did. A rename is wrong where the old name meant someone or something else: another person or another team's agent, an account or a role, a document as sent or signed, a dated record, or a fact only true of the old plugin. Add those to the script's `flagged` list.
   - Show one table: each flagged line, what it says now, what it said before the move, and why. Below it, any `stale` file still naming the old home. With nothing to show, say the move checked out in one line.
   - Ask once which lines to put back (`AskUserQuestion` with multiSelect under Claude Code; a numbered list under Codex): all, a pick, or none. Run the script again with one `--restore <path:line>` per pick, and report each result. A `stale` file is fixed by hand with the operator.
4. **Finish the move: upgrade, then sync.** Run this plugin's `upgrade` skill and follow it to the end: it writes the status line, the Codex wiring and the new template lines the copy doesn't have yet. Then make sure a sync has run, since it compiles the sessions the move captured, rebuilds the task dashboard and `dashboard.html` with this folder's paths, and commits the restored lines and the line from step 2 to this home's history:
   - The upgrade ended with its own sync: done.
   - The upgrade asked for a restart first (it installed dependencies or picked up new server code): **stop here and leave the flag pending**. Tell the operator to exit and reopen; the next session comes back to this step, the upgrade reports it's current, and you run the `sync` skill.
   - Otherwise: run the `sync` skill now.
5. **Ask where to start.** Read the move note at `migratedFrom.note` when there is one. When it has an `## After the command` checklist, first show the items this session hasn't done (auto mode, repointing the vault and workspaces, retiring the old home, each with its command from the note) as one short list the operator can work through later, and leave the note as written. Then offer up to three of its sessions to continue as `Pick up: <what it was doing>`, then **Morning brief**. Without a note, or without sessions in it, offer the options in section 2 instead.
6. **Clear the flag** (section 3).
7. **Run the pick.** A session to continue runs the `find-session` skill with its id: it loads that session's notes from the brain. Then start on the next step the note gives. Close with one line naming the other sessions in the note, and saying that any past session, noted or not, can be picked up by asking for it by id or by what it worked on. A section 2 option runs as section 4 says.

## 1. Read the home (no writes)

- **Inbox:** how many files sit in `knowledge/raw/inbox/` (documents from init's Step 5d that no compile has absorbed yet).
- **Roadmap draft:** whether `knowledge/concepts/roadmap-draft.md` exists (the goals from Step 5d).
- **Roadmap:** whether `roadmap.html` exists at the home root (a seed bundle can bring one).
- **Packs:** `packs_status`. Every available row `new` means no pack was set up at init.

## 2. Greet and ask

One or two lines as the agent: setup is done, here is where we could start. Then one question, "Where should we start?", with `AskUserQuestion` under Claude Code or a numbered list under Codex. Offer up to four options, in this order, and skip any whose condition fails:

| Option | When | Runs |
|---|---|---|
| **Build your roadmap (Recommended)**: "from the goals you gave at setup" with a draft, "a plan-on-a-page for the year" without one | no `roadmap.html` | the `roadmap` skill |
| **Review your roadmap (Recommended)**: check the one you brought still holds | `roadmap.html` exists | the `roadmap` skill, as an update |
| **Absorb your documents**: read the N files you dropped in so I know them in full | inbox has files | the `knowledge-compile` skill |
| **Set up packs**: browser, GitHub, finances, support and more | every pack `new` | the `configure-skills` skill |
| **Morning brief**: see what I already know and what's on today | always | the `briefing` skill, morning |

The roadmap row always comes first and always carries "(Recommended)". A typed answer ("Other") is a request of its own: do that instead.

## 3. Clear the flag

As soon as there is an answer, whatever it is:

```bash
bun "<PLUGIN_ROOT>/skills/sync/scripts/watermark.ts" welcome "<YYYY-MM-DD>"
```

Today's date in the home timezone. This turns `pending` into a date, and the next session opens normally. Never edit or delete `cadence.json` by hand; it also holds the goals cadences.

## 4. Run the pick

Invoke the chosen skill now (the Skill tool under Claude Code, `$name` under Codex) and follow it to the end. When it's done, close with one line naming the options not taken, as the commands that run them, so the operator knows they're still there.
