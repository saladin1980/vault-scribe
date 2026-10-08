# How it works

vault-scribe is a Claude Code mod: a TypeScript module of function hooks that runs inside every session. It hooks the session's start and end, every prompt, every tool call, every turn's end, the band above the prompt, and one slash command.

## The loop

```
your prompt ──► capture ──► tool calls ──► capture ──► turn ends
                                                          │
                       ┌──────────────────────────────────┤
                       ▼                                  ▼
              daily note written now           every N prompts / idle / session end
              (no model call: files touched,          │
               turns captured)                        ▼
                                              summary (one model call)
                                                      │
                          ┌───────────────┬───────────┴────────────┐
                          ▼               ▼                        ▼
                 daily note sections   signals file         notes for Claude
                 (done + why,          (cross-project        (heads-up, "grep the
                  decisions, ...)       changes)              whole vault", nudges)
```

### 1. Capture (every turn, no model call)

**Kept per turn:**
- **Your prompt**: only prompts you typed or sent from your phone. Slash commands and one-word go-aheads are not kept as content.
- **What Claude did**, one line per tool call:
  - **Edits:** the file plus a short before → after; **writes:** the file and its size.
  - **Shell commands:** marked `read` when Claude Code's own check says the command is read-only.
  - **Reads:** Read, Grep and Glob calls with their paths.
  - **Lookups:** web searches (the query), pages fetched or opened (the URL).
  - **Research agents:** what each was asked, and its final report.
- **Claude's answer** at the end of the turn.

Secrets that look like API keys, tokens, JWTs, private keys, webhook URLs or `password: ...` are redacted before anything is stored.

### 2. The daily note, after every turn

The session's block is rewritten inside the turn-end hook itself (no timer, no model). It shows the files touched and how many turns are waiting for a summary. The file is re-read immediately before each write, and only this session's block (between its `<!-- vault-scribe:session:<id> -->` markers) and its Index bullet (tagged `<!-- vs:<id8> -->`) are replaced. Hand-written sections and other sessions' blocks are never touched. Line endings are preserved.

### 3. The summary (every few prompts)

Runs every `summarize_every` prompts, after 8 idle minutes, and at session end. One model call (`scribe_model`) turns the turn digest into:

| Field | Becomes |
|---|---|
| `done` | What Got Done, each with *why* |
| `decisions` | Decisions Made, but only those quoting your typed words (verified in code, not trusted to the model). The rest become "proposed, not confirmed" discussions. |
| `discussions` | Discussions & Open Questions |
| `research` | Research & Lookups, with sources |
| `in_progress` | What's Still In Progress |
| `signals` | cross-project signals (below) |

Em-dashes in the model's output become colons, and backslash paths become forward slashes.

### 4. Signals

**What gets queued:**
- **A signal** is queued when something matters to a project *other than* the session's own, plus every decision or correction (rulings need a vault-wide look).
- **Projects are attributed** by the summary and confirmed by evidence:
  - **Evidence:** only changes (edits, writes, non-read-only commands), matched by a real **path** or **host** from your project table.
  - **Not evidence:** reads, lookups, research and keywords.
  - **A safety net:** a change touching another project that no summary item explained still produces a plain "this session touched X" signal, so nothing slips through silently.

**Format:** one block per signal in `signals_dir/<date>.md`. A reviewer flips the heading's status on the same line, which keeps the file's line numbers stable. See [the review loop](review-workflow.md).

### 5. Heads-up

At session start (and at most every 10 minutes after), the mod looks for pending signals from *other* sessions in the last 14 days that touch this session's project.
- **On screen:** they show in a band above the prompt.
- **For Claude:** they are also attached to your next prompt as context, which is how the heads-up reaches you over Remote Control.

### 6. Guards (optional)

On each tool call, before it runs:
- **Edits and writes** are checked against `guard_auto_memory` and `guard_paths`.
- **Shell commands** are checked too, but only when they actually write: a write verb, or a redirect whose *target* is guarded. `ls x 2>&1` is not a write.
- **n8n deletes** are checked when `guard_n8n_delete` is on.

A refused call comes back to Claude with the reason, so it changes course with no button to press (this also works from the phone).

**Known limit:** the shell check reads the command text, so a command that merely *contains* a guarded string (say, inside a heredoc of test data) is also refused. That's conservative on purpose; write such data with a file-writing tool instead.

### 7. Push guard

When a shell command contains a `git push`, the mod works out the repo's folder (from `git -C`, a preceding `cd` / `Set-Location`, or the session's folder), its remote and its branch (by running `git remote get-url` and `git rev-parse`), and looks the pair up in the config note's push policy:
- **hold:** refused with what the push would deploy and what to test first, unless your own prompt this turn approves it
- **announce:** goes through, and Claude is reminded to tell you it is deploying and what to test
- **go**, or no matching rule: goes through
- **force pushes:** held whenever `guard_force_push` is on

### 8. Citations

In the background at session start, every vault note is scanned for `name.md:NNN` citations. After an edit to a vault note changes its line count, Claude is told which citations elsewhere now point below the change, and by how much.

## Crash safety

- **Every turn is saved** in the mod's store the moment it ends.
- **The note write doesn't depend on timers:** it happens inside the turn-end hook.
- **A reloaded or resumed session** writes up any unwritten turns at start.
- **A dead session** is written up by any later session: when a session starts, it looks for sessions idle for 30+ minutes that still hold unwritten turns, and summarizes them into their own blocks.

## Privacy

- **Reads:** your vault (config note, daily notes, signal files, and a scan for citations) and the tool calls of your own session.
- **Writes:** only today's daily note and the signals folder, inside your vault.
- **Model calls:** summaries are sent to `scribe_model` through your own Claude Code session. No other network calls.
- **Redaction:** things that look like secrets are redacted before storage, summarization and writing. Redaction is pattern-based: treat it as a safety net, not a guarantee.
- **Session state:** kept in the mod's store under Claude Code's config directory and pruned after 3 days.
