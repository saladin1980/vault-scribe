# Changelog

## 0.3.1

- **Fix: citation check no longer matches by file name alone.** Before, editing any `MEMORY.md` flagged every `MEMORY.md:NN` citation in the vault, even ones pointing at another project's file.
  - A cited path with a folder must match the edited file's path.
  - A bare name means the citing note's own folder, or the one file in the vault with that name.
  - Anything else is skipped as ambiguous.
  - Why: a second brain with one memory index per project made the warnings mostly noise.

## 0.3.0

- **Push guard:** a per-repo push policy in the config note (`## Push policy`: repo, branch, hold / announce / go, what it deploys to, what to test).
  - A held push is refused until the owner's own message approves it.
  - An announced push goes through with a reminder to say what is deploying.
  - Repos are matched by remote, so every clone gets the same rule.
- **Docs:** a new "Using it well" guide (habits that make the notes more useful) and the push policy reference.
- **`guard_force_push`:** holds force pushes until the owner's message says "force".

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
