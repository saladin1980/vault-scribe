# The review loop

vault-scribe writes signals; something has to act on them. It is deliberately split this way: the session that made a change knows its own project and updates that project's notes live, but it does not know your whole vault. A reviewer that reads everything is the right place to carry a change into every other project it affects.

## A signal

```markdown
### SIG-2026-10-08-abcdef12-1 · ⏳ pending
- kind: change
- what: the form endpoint now returns 422 on spam
- why: the blog embeds this form
- from: session abcdef12 · cwd `C:/code/website` · own project: Website · 2026-10-08 14:10
- touches: Blog (named by summary, path C:/code/blog); Website (own project) (cwd)
```

**Kinds:**
- `change`, `fact`, `discussion`: things another project's notes need to know.
- `decision`, `correction`: your rulings. Each one quotes you; apply it vault-wide, not just in the obvious file.

## Reviewing

Open the day's signals file and, for each `⏳ pending` signal:

1. **Treat it as a lead, not a fact.** Check the claim against the notes, and against the code if needed.
2. **Update every project in `touches`** whose notes are now stale. For a decision or correction, search the whole vault for its subject: a ruling applied to one note tends to leave contradicting lines elsewhere.
3. **Flip the status on the same heading line**, so line-number citations into the file stay valid:
   - `✅ processed <date>: <what you did>`
   - `🔁 routed <date>: <where it went, e.g. an issue or a task>`
   - `✖ dropped <date>: <why: wrong, already true, noise>`

Never delete signal blocks; the history is the point.

Sessions working in a project see pending signals that touch it as a heads-up, until they're flipped.

## Automating it

Any routine that can read and edit your vault can be the reviewer. For example: a Claude Code skill you run by hand, or a scheduled task twice a week, with instructions along the lines of the steps above.

Two settings keep the reviewer from talking to itself:
- `reviewer_command`: sessions started with that slash command queue no signals.
- `review_dir`: a session that writes into that folder is treated as the reviewer.

A reviewer can also keep the config note's project table current: one row per project memory folder, so new projects get tagged from day one.

### A worked example: REPS

vault-scribe was built for a vault run by a reviewer routine called REPS (Record, Evaluate, Propose, Sign-off). It runs twice a week and reads every memory note. It processes the signal queue first, then refreshes the project table. It applies safe fixes directly, and only asks its owner about the calls that genuinely need them. The scribe is the "Record" half that a vault-wide reviewer can't do on its own: it sees what happened inside sessions as it happened.

You don't need anything that elaborate. A ten-minute weekly read of the signals file gets most of the value.
