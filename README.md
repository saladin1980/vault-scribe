# vault-scribe

**A Claude Code mod that keeps your Obsidian second brain up to date by itself.** You work with Claude; it takes the notes.

Every session writes itself into today's daily note: what changed and why, what you decided (in your own words), what was discussed but not settled, and what was researched or looked up, with sources. When work in one project affects another, it leaves a signal so nothing slips between projects. It survives crashes, works from your phone, and never needs you to remember anything.

> Why this exists, in one line: a second brain is only as good as what gets written into it, and the moment you most need a note (mid-task, deep in a session) is the moment you are least likely to stop and write one.

## What you get

A block like this lands in today's daily note, updated after every turn:

```markdown
## Session 2 (14:05): contact form spam
*auto-written by vault-scribe · session `abcdef12` · own project: Website · cwd `C:/code/website` · updated 14:40*

### What Got Done
- added a honeypot field to the contact form (why: bots were submitting it daily)
- returned 422 for spam submissions (why: the blog embed needs a clear failure)

### Decisions Made
- use a honeypot, not a captcha (Alex: "no captcha, people hate them")

### Discussions & Open Questions
- weighed rate limiting per IP, deferred until spam volume is measured
- proposed, not confirmed: move the form to its own page

### Research & Lookups
- searched honeypot field effectiveness: catches most simple bots (source: https://example.com/honeypot)
- read the blog's embed code: it posts to the same endpoint, so it needed the 422 handling

### What's Still In Progress
- measure spam volume for a week

### Notes Touched
- [[Projects/Website/memory/forms|forms]]

### Signals for Review
- 1 queued for review → [[vault-scribe/signals/2026-10-08|signals 2026-10-08]]: `SIG-2026-10-08-abcdef12-1`
```

**What each section is for:**
- **What Got Done:** every change, and **why** it was made.
- **Decisions Made:** only decisions that **quote words you actually typed**. The mod checks the quote against your messages, so an assistant's proposal is never recorded as your ruling. Unverifiable "decisions" land under Discussions as "proposed, not confirmed".
- **Discussions & Open Questions:** options weighed, proposals waiting on you, ideas rejected and why. The things that quietly decide your next month and usually get lost.
- **Research & Lookups:** files and whole projects' notes read to make a choice, web searches, pages fetched, research-agent reports, each with what it informed and its source.

## Features

- **Writes your daily note itself.** It writes after every turn without a model call, and a short summary runs every few prompts. A crashed or closed session is written up by the next one that starts.
- **Cross-project signals.** Your config note lists your projects with their paths and hosts. When a session in one project changes something another depends on (a shared API, host, database, convention, or research one project did that another needs), it writes a signal file. Only real changes count: edits, writes and commands that change something, matched by path or host. Reads, lookups and keywords never count.
- **Heads-up band.** When another session changed something your current project depends on, a band appears above the prompt. The same note also goes to Claude, so it works from your phone over Remote Control.
- **Citation check.** If you cite notes by line (`map.md:128`), an edit that shifts lines tells Claude exactly which citations elsewhere now point at the wrong line.
- **New project checklist.** Creating a new project memory folder shows your own "what to update together" list.
- **Project-aware push guard.** A per-repo push policy: *hold* the pushes that deploy to production or publish (until your own message says "ship it"), *announce* the ones where pushing is how you test, let the rest go. Force pushes can always be held.
- **Optional guards** (all off by default): refuse writes into folders you have retired, into Claude's per-project auto-memory (if your vault is the single source of truth), and n8n workflow deletes.
- **Configured by one note in your vault.** The model, your name, timezone, daily-note path, projects, guards, checklist: all in a note you edit in Obsidian. Nothing is hardcoded.

## Install

Requires Claude Code 2.1.287 or newer (mods), in the terminal or the desktop app's Code tab.

```
/plugin install vault-scribe --marketplace saladin1980/vault-scribe
```

Then:
1. Create your config note (template in [docs/setup.md](docs/setup.md)). The default location is `vault-scribe/config.md` inside your vault.
2. If you don't start Claude Code inside your vault folder, set the `vault_root` option (`/config`, or `pluginConfigs` in `~/.claude/settings.json`).
3. Start a session and type `/scribe` to check it found everything.

Full walkthrough: **[docs/setup.md](docs/setup.md)**.

## Documentation

- [Why a scribe for a second brain](docs/why.md): the problem it solves, and the design choices behind it
- [Setup with Obsidian](docs/setup.md): step-by-step, with a config template
- [Using it well](docs/using-it-well.md): habits that make the notes far more useful
- [Configuration reference](docs/configuration.md): every setting
- [How it works](docs/how-it-works.md): capture, summaries, crash safety, what it reads and writes, privacy
- [The review loop](docs/review-workflow.md): what to do with signals, from manual review to an automated reviewer

## Commands

- `/scribe`: status (owner, project, what's captured, signals, heads-up)
- `/scribe flush`: summarize and write now. Optional: it happens on its own.

## Privacy, in short

It reads your vault and the tools Claude runs in your session. Summaries go through your own Claude session's model (the one in `scribe_model`). Secrets that look like tokens, keys and passwords are redacted before anything is stored, summarized or written. Everything it writes stays in your vault. Details: [docs/how-it-works.md](docs/how-it-works.md#privacy).

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT. Built by [saladin1980](https://github.com/saladin1980) to run a personal second brain, and shared in case it helps yours.
