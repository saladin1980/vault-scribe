# Configuration reference

vault-scribe has two layers of configuration:

1. **Plugin options** (`/config`, or `pluginConfigs` in `~/.claude/settings.json`): where your vault and config note are.
2. **The config note** in your vault: everything else. Its frontmatter holds settings; its body holds the project table and the new project checklist. It is re-read before each summary, so edits apply without restarting.

## Plugin options

| Option | Default | Meaning |
|---|---|---|
| `vault_root` | *(empty)* | Absolute path of your vault. Empty: `VAULT_SCRIBE_ROOT`, else the folder the session started in. |
| `config_note` | `vault-scribe/config.md` | Vault-relative path of the config note. `VAULT_SCRIBE_CONFIG` also works. |

## Config note frontmatter

| Key | Default | Meaning |
|---|---|---|
| `scribe_model` | `haiku` | Model for summaries: an alias (`haiku`, `sonnet`) or a full model id, resolved like `--model`. Change it here, never in code. |
| `summarize_every` | `3` | How many of your prompts between summaries. The daily note is still written after every turn. |
| `owner` | `the user` | Your name as summaries use it. Decisions must quote words this person typed. |
| `timezone` | `America/New_York` | IANA zone for the daily note's date and times. |
| `daily_note_path` | `{YYYY}-{MM}-{DD}.md` | Vault-relative path pattern. Tokens: `{YYYY}` `{MM}` `{DD}` `{Month}`. Match your Obsidian Daily notes settings. |
| `daily_note_frontmatter` | *(none)* | Extra frontmatter for a daily note the scribe has to create, separated by `;` (e.g. `type: log; tags: daily`). It never changes an existing note's frontmatter. |
| `signals_dir` | `vault-scribe/signals` | Vault folder where cross-project signals are queued, one file per day. |
| `review_dir` | *(none)* | Vault folder your reviewer writes into. A session that edits there is treated as a reviewer run and queues no signals. |
| `reviewer_command` | *(none)* | Slash command that runs your reviewer (e.g. `review-vault`). Sessions started with it queue no signals. |
| `memory_folder_name` | *(none)* | Folder name that marks a project's memory (e.g. `memory`). Creating a new one shows the new project checklist. Empty: off. |
| `skip_dirs` | `.obsidian, .git, .trash, node_modules` | Folder names the citation index never walks into. |
| `guard_auto_memory` | `false` | Refuse writes into Claude Code's per-project auto-memory (`~/.claude/projects/<x>/memory/`), except the vault's own folder. For vaults that are the single source of project memory. |
| `guard_paths` | *(none)* | Comma-separated path fragments; any write whose path contains one is refused (e.g. `/old-notes/, /MIRROR.md`). Case-insensitive, forward slashes. |
| `guard_force_push` | `false` | Hold every `git push --force` (and `+refspec`, `--delete`, `--mirror`) until your own message approves it with the word "force". |
| `guard_n8n_delete` | `false` | Refuse n8n workflow deletes (REST `DELETE .../workflows/...`, or an n8n tool named like delete). For setups where workflows are archive-only. |

All guards are **off by default**: what is off limits depends entirely on your setup.

## Project table

Anywhere in the note body, a Markdown table whose header starts with `| Project |`:

| Column | Meaning |
|---|---|
| Project | The name used in notes and signals. |
| Memory | Vault-relative folder of the project's memory notes. Used to nudge the session when it changed the project but never updated its notes. |
| Paths | Comma-separated path prefixes (code, files, the project's vault folder). The longest match wins, so `C:/code/site/blog` beats `C:/code/site`. |
| Hosts | Comma-separated hosts, domains and IPs. A command that mentions one touches the project. Whole-word match, so `example.com` does not fire inside `blog.example.com`. |
| Keywords | Comma-separated words that help the summary attribute a change. Never evidence on their own. |

## Push policy

A heading `## Push policy` followed by a table. Each row says what a `git push` to that repo and branch does, and whether it waits for you:

| Column | Meaning |
|---|---|
| Repo | A remote, matched by suffix (`alex/website` matches `https://github.com/alex/website.git` and `git@github.com:alex/website.git`), or an absolute path prefix for a repo without a remote. Matching by remote means every clone of the repo gets the same rule. |
| Branch | A branch name, or `*` for any. An exact branch beats `*`. |
| Policy | `hold`: the push is refused until **your own message** in that turn approves it ("ship it", "push it", "go ahead and push", "yes, deploy"). `announce`: it goes through, and Claude is told to tell you what is deploying and what to test. `go`: it just goes. |
| Deploys to | What the push triggers, in plain words. Shown in the hold message and the announcement. |
| Test | What to do first (hold) or what to check after (announce). |

A repo with no matching row is not guarded. Approval is read from what you typed, never from Claude's own words, so Claude cannot approve itself. "Go ahead" alone is not enough: the approval has to say push, ship or deploy.

Why per repo: for some repos the push *is* the only way to test (a bot that only runs on its server, a staging branch), and holding those just trains everyone to click through. Hold the ones where a push is irreversible or public; announce the ones where pushing is how you test.

```markdown
## Push policy

| Repo | Branch | Policy | Deploys to | Test |
|---|---|---|---|---|
| alex/website | main | hold | live site, no staging | run npm run dev and check the page first |
| alex/website | preview | announce | Vercel preview deploy | open the preview URL |
| alex/discord-bot | main | announce | the live bot via the server's auto-deploy | try the changed command in the test channel |
| alex/notes-tool | * | go | nothing, just a backup | |
```

## New project checklist

A heading `## New project checklist` followed by a bullet list. When a session creates a new folder named `memory_folder_name`, this list is handed to Claude as the set of things to update in the same session. Default: one item, a row in the config note's project table.

## Files it writes

| File | When |
|---|---|
| `daily_note_path` for the session's start date | After every turn, plus each summary. Only the session's own block and its Index bullet are changed. |
| `signals_dir/<date>.md` | When a summary finds a cross-project change, decision, correction, fact or discussion. Appended, never rewritten. |

Session state lives in the mod's own store under Claude Code's config directory, not in your vault.
