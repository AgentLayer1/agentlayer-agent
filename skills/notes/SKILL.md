---
name: notes
description: The heartbeat's scouting run, after a brain refresh - look at the home and the public world through one lens, check what you find against a live source, and send at most the day's room of notes, each a short finding with one next step. Never sends anything outside the home's own surfaces, edits nothing, and writes no code.
disable-model-invocation: true
allowed-tools: mcp__plugin_agentlayer_agent__note_add, mcp__plugin_agentlayer_agent__task_query, mcp__plugin_agentlayer_agent__task_get, mcp__plugin_agentlayer_agent__github_sweep, mcp__plugin_agentlayer_agent__helpdesk_stats, mcp__plugin_agentlayer_agent__appstore_reviews, mcp__plugin_agentlayer_agent__gsc_query, mcp__plugin_agentlayer_agent__gsc_inspect, mcp__plugin_agentlayer_agent__web_search, WebSearch, WebFetch, Read, Bash(bun *src/cli.ts notes list*)
---

# Notes: tell the operator what you found

A note is what a sharp colleague sends unprompted: something changed or doesn't match, you checked it, here is the one thing to do. The heartbeat runs this after each brain refresh, so the brain was just compiled. Send at most the day's room, and nothing when nothing earns it: a quiet run is a good run.

## 1. See what's left today

```bash
bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" notes list --json
```

`room` is how many notes may still go out today; at 0, say "No room for notes today" and stop. `recent` lists the notes of the last two weeks (their `source` keys are taken until then), and `lenses` each lens's record: when it last produced a note, and how many of its notes were started or dismissed. If session start listed `extensions/skills/notes.md`, read it now: the operator's own lenses and rules, which win where they disagree with this file.

## 2. Pick one lens

Take the lens that produced a note least recently, skipping one whose notes were mostly dismissed; prefer one whose notes were started. One lens per run keeps the run short.

| Lens | Look for | Where |
|---|---|---|
| `public-drift` | The world saying something the brain knows is no longer true: a page, a store listing, a search result or a doc that names an old version, an old name, a feature as "in progress" that shipped | The home's public sites and listings named in project READMEs; Search Console (`gsc_query`, `gsc_inspect`) where the SEO pack is set up; a web search for the product's own name |
| `opportunities` | Something worth acting on soon: an event, a call for demos or talks, a grant or programme, a deadline, that fits an active project and where the operator is | Web search scoped by the projects in `knowledge/index.md`, the user profile's location, and the month |
| `signals` | News on a topic the operator follows that bears on an active project | The signal topics in `knowledge/user/interests.md`, then a web search |
| `brain` | The brain against itself: a fact gone stale, two facts that disagree, a task behind the code, a pending item past its date | `knowledge/memory/index.md` (Open Questions, Pending), `task_query`, recent decisions |
| `waiting` | Something waiting on the operator that a session couldn't see: a review asked of them, a reply owed, new App Store reviews, a support queue growing | `github_sweep`, `helpdesk_stats`, `appstore_reviews` where the packs are set up |

## 3. Search only with public facts

Outward searches leave the machine, so build every query from what is already public:

- **May go in a query:** company, product and app names with a public site, public URLs, the operator's public projects, places, event and programme names, technologies.
- **Never goes in a query:** a secret or credential; anything about a customer, client or user (names, emails, accounts, ticket text); amounts, prices not published, revenue; internal ids (task, ticket, PR numbers of private repos); a person's private details; plans and releases not yet public.

When a finding needs a private fact to make sense, keep that fact in the note's body, which stays on this machine, and keep it out of the search.

## 4. Check it, then write it

A finding becomes a note only when all of these hold:

- **It is checked against a live source.** Open the page, read the listing, run the query. A search snippet alone isn't a check; quote what the page says now.
- **It is new.** Its `source` key isn't in `recent`, and the brain doesn't already record it as known or handled.
- **The operator would act on it within a week.** Interesting is not enough.

Write each note like this:

- **title:** the finding as a headline, at most 80 characters ("The install snippet in search still names the old plugin").
- **body:** two or three sentences: what you found, what you checked to be sure ("I checked the old link too: it redirects"), and why it matters now.
- **sources:** what backs it: full URLs of pages anyone can open, or for a `brain` finding the home files it rests on (`knowledge/memory/index.md`, `projects/<slug>/tasks/<id>.md`). The tool checks only the shape; whether a URL is public is yours to check, so never cite a private repository's or a signed-in page.
- **next:** the one smallest concrete step, with where to do it.
- **workspace:** when this skill was run with `workspaces: ["A", "B", …]` (the cmux workspaces open now, across every agent), the one a session on the next step belongs in by the kind of work; empty when none fits or none were given. Never pick a workspace named for another agent (`Agent <Name>`); leave it empty rather than guess.
- **folder:** the repo's path when the next step is code work; empty otherwise.
- **source:** a key naming the thing, `<kind>:<slug>` (`site:install-snippet`, `event:demo-day-2026`, `task:ab-012`).
- **lens:** the lens's key from the table.

Send them in one `note_add` call, best first. It refuses past the day's cap, a source noted in the last two weeks, or a note with nothing to back it; a refusal is expected, not an error.

## 5. End

Exactly one short line, which the heartbeat's band shows: "Sent 1 note: The install snippet in search still names the old plugin." or "No note worth sending."
