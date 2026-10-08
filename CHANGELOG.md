# Changelog

## 0.2.0

**Captures more of each session:**
- edits with a short before and after
- a why on every done item
- a Discussions & Open Questions section
- a Research & Lookups section (reads, web searches and fetches, pages opened, research-agent reports, with sources)

**Decision quote check:** decisions must quote words the owner typed, verified in code. Anything else is filed as "proposed, not confirmed".

**Signal fixes:** only real changes (edits, writes, non-read-only commands), matched by path or host, count as touching a project. Reads, lookups and keywords never do.

**Configuration:** everything moved into the config note (owner, timezone, daily-note path, folders, guards, reviewer, new project checklist), with plugin options for the vault and config note location. All guards are off by default.

**Docs:** why, setup, configuration, how it works, the review loop.

## 0.1.0

First version: an automatic daily note written after every turn, crash recovery, cross-project signals, the heads-up band, guards, and the citation check.
