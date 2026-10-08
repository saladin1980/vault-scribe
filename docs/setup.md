# Setup with Obsidian

About ten minutes. You need Claude Code 2.1.287 or newer (mods), running in a terminal or in the Code tab of the Claude desktop app, and an Obsidian vault.

## 1. Install the mod

Inside Claude Code:

```
/plugin install vault-scribe --marketplace saladin1980/vault-scribe
```

Answer `y` to add the marketplace, then pick the user scope so it runs in every session.

From a local copy instead (for example a clone you changed):

```
claude plugin marketplace add C:/path/to/vault-scribe
claude plugin install vault-scribe@vault-scribe
```

## 2. Tell it where your vault is

If you always start Claude Code inside your vault folder, skip this: the vault defaults to the folder the session started in.

Otherwise, set the `vault_root` option. Either open `/config` and find vault-scribe, or add this to `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "vault-scribe@vault-scribe": {
    "options": {
      "vault_root": "C:/Users/you/Documents/MyVault",
      "config_note": "vault-scribe/config.md"
    }
  }
}
```

The key is `<plugin>@<marketplace>`, as `claude plugin list` prints it. The environment variables `VAULT_SCRIBE_ROOT` and `VAULT_SCRIBE_CONFIG` work too.

## 3. Create the config note

Create `vault-scribe/config.md` in your vault (or wherever `config_note` points) and adapt this template:

```markdown
---
scribe_model: haiku
summarize_every: 2
owner: Alex
timezone: America/Chicago
daily_note_path: "Daily/{YYYY}-{MM}-{DD}.md"
signals_dir: vault-scribe/signals
memory_folder_name: memory
skip_dirs: .obsidian, .git, .trash, node_modules, Archive
daily_note_frontmatter: tags: daily
guard_auto_memory: false
guard_paths:
guard_n8n_delete: false
---

# vault-scribe config

| Project | Memory | Paths | Hosts | Keywords |
|---|---|---|---|---|
| Website | Projects/Website/memory | C:/code/website | example.com | astro, landing page |
| Homelab | Projects/Homelab/memory | C:/code/homelab | 192.168.1.10, nas | docker compose, proxmox |
| Writing | Projects/Writing | C:/Users/you/Documents/MyVault/Projects/Writing | | essay, draft |

## New project checklist

- Home.md: add the project to the project list
- this note: a project-table row so vault-scribe can tag the new project
```

**Things to get right:**
- `daily_note_path` must match your Obsidian **Daily notes** core plugin settings (Settings → Daily notes → New file location + Date format), so the scribe writes into the same note you open. Tokens: `{YYYY}` `{MM}` `{DD}` `{Month}` (full month name).
- **The project table is what makes cross-project signals work.** One row per project:
  - **Paths**: where the project's code or files live. A session started under one belongs to that project, and an edit under one touches it. Prefixes, comma-separated.
  - **Hosts**: servers, domains and IPs the project uses. A command that ssh's or curls one touches the project.
  - **Keywords**: only help the summary say which projects a change concerns. Keep them specific.
- `owner` is the name decisions get attributed to. A decision is only recorded if it quotes something this person typed.

Every setting is described in the [configuration reference](configuration.md).

## 4. Check it

Start a new session and run:

```
/scribe
```

You should see your owner name, the session's project, `config: vault-scribe/config.md` and a citation count. If the project shows `unmapped`, the session's starting folder isn't under any project's **Paths** (or isn't your vault).

Work normally for a couple of prompts, then open today's daily note in Obsidian: your session's block is there and updates as you go.

## 5. Optional: a heads-up you'll actually see

The heads-up band appears above the prompt in the terminal and the desktop app. Over Remote Control (phone) there's no band, but the same heads-up is handed to Claude with your next prompt, and Claude will mention it.

## Troubleshooting

- **`/scribe` says the config note is unreadable:** check `vault_root` and `config_note`, and that the path is relative to the vault.
- **Nothing in the daily note:** check `daily_note_path`, then run `/scribe flush` and look at the path in the confirmation.
- **Signals for things you only read:** they shouldn't happen (reads never count). If one does, it's a bug: please open an issue with the signal text.
- **Summaries missing:** the model in `scribe_model` must be one your account can use. The note still gets the deterministic part (files touched, turns captured) without it.
