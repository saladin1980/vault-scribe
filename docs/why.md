# Why a scribe for a second brain

## The problem

An Obsidian vault used as a second brain works when it is true and complete. With Claude Code, a lot of real work happens in sessions: code changes, decisions, research, arguments about approach. Almost none of it makes it into the vault on its own. Three things go wrong:

1. **The note never gets written.** The rule "update the daily note" is easy to agree with and easy to drop. The best moment to write it (mid-task) is the worst moment to stop. One vault this was built for had a 31-day hole in its daily notes, with real work done on most of those days.
2. **The why gets lost.** A commit or a changed file says *what*. The reason, the options that were weighed and the thing you decided against live only in the chat, and the chat scrolls away.
3. **Projects drift apart.** A session in one project changes something another project depends on: an API shape, a server, a convention, a database role. Nobody tells the other project's notes. Weeks later, a different session works from stale notes.

## The idea

**Let the session just do the work, and let something else take the notes.** A Claude Code mod runs inside every session and sees every prompt, every tool call and every answer. That makes it the right place for the bookkeeping:

- it never forgets, because nothing depends on remembering
- it sees the why, because it sees the conversation that led to the change
- it sees across projects, because it knows which paths and hosts belong to which project

## Design choices, and why

**The daily note is the scribe's; project memory stays the session's.** The daily note is a chronological log, low stakes and easy to regenerate, so the scribe writes it on its own. Your project memory notes need judgment. A summary model writing into them unsupervised is how invented facts get into a knowledge base, so the scribe only *nudges* the session to update them, and *signals* other projects for review.

**Decisions must quote you.** The most damaging kind of wrong note is a decision you never made. A summarizer reading a conversation easily mistakes an assistant's proposal for the user's ruling. This happened repeatedly while vault-scribe was being built, which is why the rule exists. So a decision only counts when it quotes words you actually typed, and the mod verifies the quote against your messages. Anything else is filed as "proposed, not confirmed".

**Discussions and research get their own sections.** The choice you did not make, and the reading that informed the one you did, are what you need months later when you wonder "why on earth is it like this?". They are also exactly what a normal changelog leaves out.

**Only real changes are evidence.** A session that *reads* another project's notes to make a decision is research, not a change to that project. Signals are raised by edits, writes and commands that change things, matched by real paths and hosts. A project name that merely appears in some text proves nothing.

**Crash-proof by construction.** The note is written after every turn, inside the turn's own hook, with no model call. Summaries are a layer on top. If a session dies, the next session to start writes up what was left.

**One config note, no hardcoding.** Your vault, your words. The model, owner name, timezone, daily-note path, projects and guards all live in a note you edit in Obsidian, so changing the model or adding a project never means touching code.

**Your style, enforced.** Output uses forward-slash paths and no em-dashes, because the vault it was built for wanted exactly that, and a scribe should write the way you do.

## What it is not

- Not a replacement for your judgment about what belongs in project memory. It nudges; you (or your session) decide.
- Not a sync tool, and not a cloud service. Everything stays in your vault.
- Not a permission system. The optional guards are a safety net for a few known-dangerous writes; keep your normal Claude Code permissions on.
