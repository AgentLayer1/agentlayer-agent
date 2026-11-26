# How a review agent reads

Pasted verbatim into the prompt of every agent a PR playbook launches (each lane, the case against, the outcome agent, each verifier), and followed by the orchestrator itself. It changes how the code is read, never how much of it: every file on the coverage checklist is still read and judged.

Every turn re-reads everything already in your context, so the number of turns is what a review costs. Read wide, then judge.

- **Batch independent reads into one turn.** Issue several reads, greps or commands in the same message, or one shell command that prints several files or line ranges, each under a header line naming it. One file per turn is the expensive way to read the same code.
- **Start from the hunks.** One command gets every changed hunk you own with its surrounding function: `git -C "<worktree>" diff -U25 <base>...HEAD -- <paths>`. One grep gets every caller of the changed symbols across the repo: `grep -rn -C3 -e <symbol> -e <symbol> <dirs>`.
- **Read ranges, not whole files,** once a file passes about 400 lines: the function, its type, and what the hunk touches. Read the whole file when the finding depends on it.
- **Plan the next batch from the last one.** Gather what the first batch pointed at (callees, tests, the schema, the config) in the second, then judge. Most lanes need three or four batches. Past about twenty turns you are reading one thing at a time: batch everything still left.
- **Never re-read what is already in your context;** quote it from there. A command whose output you already have is not run again.
- **Return only the shape you were asked for.** No narration of what you read, no restating the prompt.
