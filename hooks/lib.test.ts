import { expect, test } from 'claude-code/testing'

import {
  checkQuotes, commandDenyReason, countSessions, dailyNotePath, extractCitations, firstDiffLine, hasVerifiedQuote,
  isTrivial, newDailyNote, noteLink, ownProject, parseProjectMap, parseSignals, parseSummary, pathDenyReason,
  projectDirName, redact, renderBlock, renderSignal, shouldQueue, staleCitations, stampOf, tagText, upsertSession,
} from './lib'
import type { Agg, GuardOptions } from './lib'

const ROOT = 'C:/Vault'
const CONFIG = `---
scribe_model: haiku
summarize_every: 2
owner: Alex
timezone: America/New_York
daily_note_path: "Daily/{YYYY}/{MM} - {Month}/{YYYY}-{MM}-{DD}.md"
memory_folder_name: memory
reviewer_command: /review-vault
skip_dirs: .obsidian, Archive
daily_note_frontmatter: type: log; tags: daily
guard_auto_memory: true
guard_paths: /old-notes/, /NOTES_MIRROR.md
guard_n8n_delete: true
---
# config

| Project | Memory | Paths | Hosts | Keywords |
|---|---|---|---|---|
| Website | Projects/Website/memory | C:/code/website | example.com | astro |
| Blog | Projects/Blog/memory | C:/code/website/blog | blog.example.com | posts |
| Homelab | Projects/Homelab/memory | C:/code/homelab | 10.0.0.5 | proxmox |

## New project checklist
- Home.md: add the project to the index
- this config note: a project-table row
`

const agg = (over: Partial<Agg> = {}): Agg => ({
  sessionId: 'abcdef12-3456', cwd: 'C:/code/website', own: 'Website', sessionNo: 2, date: '2026-10-08', startedAt: '14:05',
  updatedAtMs: 0, ctx: [], isNudged: false, isHeadsUpSent: false, topic: 'contact form', indexLine: '**Contact form**: added spam check',
  done: ['added a spam check to the contact form (why: bot submissions)'], decisions: [], inProgress: [],
  discussions: [], research: [], notes: [`${ROOT}/Projects/Website/memory/forms.md`],
  signalIds: [], digest: [], humanTurns: 1, isReps: false, ...over,
})

const guards = (over: Partial<GuardOptions> = {}): GuardOptions =>
  ({ vaultRoot: ROOT, autoMemory: true, paths: ['/old-notes/', '/notes_mirror.md'], n8n: true, ...over })

test('config note: settings, projects and the new project checklist', () => {
  const m = parseProjectMap(CONFIG)
  expect(m.owner).toBe('Alex')
  expect(m.summarizeEvery).toBe(2)
  expect(m.projects.map(p => p.name)).toEqual(['Website', 'Blog', 'Homelab'])
  expect(m.reviewerCommand).toBe('review-vault')
  expect(m.memoryFolderName).toBe('memory')
  expect(m.skipDirs).toEqual(['.obsidian', 'Archive'])
  expect(m.dailyFrontmatter).toEqual(['type: log', 'tags: daily'])
  expect(m.guardPaths).toEqual(['/old-notes/', '/NOTES_MIRROR.md'])
  expect(m.checklist).toEqual(['Home.md: add the project to the index', 'this config note: a project-table row'])
})

test('defaults are safe for a new user: every guard off, no reviewer', () => {
  const d = parseProjectMap('')
  expect(d.owner).toBe('the user')
  expect(d.guardAutoMemory).toBe(false)
  expect(d.guardN8nDelete).toBe(false)
  expect(d.guardPaths).toEqual([])
  expect(d.reviewerCommand).toBe('')
  expect(d.memoryFolderName).toBe('')
  expect(d.dailyNotePattern).toBe('{YYYY}-{MM}-{DD}.md')
})

test('own project: longest path wins, a vault folder is the vault', () => {
  const { projects } = parseProjectMap(CONFIG)
  expect(ownProject('C:\\code\\website\\blog\\posts', projects, ROOT)).toBe('Blog')
  expect(ownProject('C:\\code\\website', projects, ROOT)).toBe('Website')
  expect(ownProject('C:\\Vault', projects, ROOT)).toBe('vault')
  expect(ownProject('C:\\Vault\\Daily', projects, ROOT)).toBe('vault')
  expect(ownProject('D:\\elsewhere', projects, ROOT)).toBe('unmapped')
})

test('tagging finds indirect projects with evidence', () => {
  const { projects } = parseProjectMap(CONFIG)
  const t = tagText('PowerShell: ssh alex@10.0.0.5 "systemctl restart proxmox-backup"', projects)
  expect(t.get('Homelab')).toContain('host 10.0.0.5')
  // the blog's longer path shadows the website's shorter one
  const s = tagText('edit C:\\code\\website\\blog\\post.md', projects)
  expect(s.has('Blog')).toBe(true)
  expect(s.has('Website')).toBe(false)
  // a host does not fire inside a longer host
  const h = tagText('curl https://blog.example.com/feed', projects)
  expect(h.has('Blog')).toBe(true)
  expect(h.has('Website')).toBe(false)
})

test('auto-memory guard: other projects refused, the vault\'s own folder allowed', () => {
  expect(projectDirName('D:\\My Vault')).toBe('d--my-vault')
  expect(pathDenyReason('C:\\Users\\alex\\.claude\\projects\\C--code-website\\memory\\x.md', guards())).not.toBeNull()
  expect(pathDenyReason('C:\\Users\\alex\\.claude\\projects\\C--Vault\\memory\\MEMORY.md', guards())).toBeNull()
  expect(pathDenyReason('C:\\Users\\alex\\.claude\\projects\\C--code-website\\memory\\x.md', guards({ autoMemory: false, paths: [] }))).toBeNull()
})

test('guard_paths refuse writes under a fragment, and shell writes too', () => {
  expect(pathDenyReason('C:\\code\\website\\old-notes\\a.md', guards())).not.toBeNull()
  expect(pathDenyReason('C:\\code\\website\\NOTES_MIRROR.md', guards())).not.toBeNull()
  expect(pathDenyReason('C:\\Vault\\Projects\\Website\\memory\\forms.md', guards())).toBeNull()
  expect(commandDenyReason('echo hi > "C:/code/website/old-notes/x.md"', guards())).not.toBeNull()
  expect(commandDenyReason('cat "C:/code/website/old-notes/x.md" > /tmp/out.txt', guards())).toBeNull()
  // a read with 2>&1 is not a write (a false positive found live)
  expect(commandDenyReason('ls "C:/Users/alex/.claude/projects/C--code-website/memory/x.md" 2>&1', guards())).toBeNull()
  expect(commandDenyReason('Set-Content C:\\Users\\alex\\.claude\\projects\\C--code-website\\memory\\x.md "y"', guards())).not.toBeNull()
})

test('n8n delete guard: delete refused, archive allowed, off when disabled', () => {
  const del = 'curl -X DELETE https://n8n.example.com/api/v1/workflows/42'
  expect(commandDenyReason(del, guards())).not.toBeNull()
  expect(commandDenyReason("Invoke-RestMethod -Method Delete -Uri 'https://n8n.example.com/api/v1/workflows/42'", guards())).not.toBeNull()
  expect(commandDenyReason('curl -X POST https://n8n.example.com/api/v1/workflows/42/archive', guards())).toBeNull()
  expect(commandDenyReason(del, guards({ n8n: false }))).toBeNull()
})

test('trivial prompts and redaction', () => {
  expect(isTrivial('go ahead')).toBe(true)
  expect(isTrivial('ok')).toBe(true)
  expect(isTrivial('move the form to its own page')).toBe(false)
  expect(redact('password: hunter2isweak and ghp_abcdefghijklmnop1234')).toBe('password: [redacted] and [redacted]')
  expect(redact('https://discord.com/api/webhooks/123/abcDEF_-x')).toBe('https://[redacted]')
})

test('stamp is local time in the configured zone', () => {
  const s = stampOf(Date.parse('2026-10-09T02:30:00Z'), 'America/New_York')
  expect(s.date).toBe('2026-10-08')
  expect(s.time).toBe('22:30')
  expect(s.dayTitle).toBe('Thursday, October 8, 2026')
  expect(stampOf(Date.parse('2026-10-09T02:30:00Z'), 'Europe/London').date).toBe('2026-10-09')
})

test('daily note path follows the pattern', () => {
  const { dailyNotePattern } = parseProjectMap(CONFIG)
  const st = stampOf(Date.parse('2026-10-08T16:00:00Z'))
  expect(dailyNotePath(ROOT, st, dailyNotePattern)).toBe('C:/Vault/Daily/2026/10 - October/2026-10-08.md')
  expect(dailyNotePath(ROOT, st)).toBe('C:/Vault/2026-10-08.md')
})

test('daily note: new file, then the block is replaced in place and others are untouched', () => {
  const s = stampOf(Date.parse('2026-10-08T16:00:00Z'))
  let note = newDailyNote(s, ['type: log'])
  expect(note.startsWith('---\ntype: log\ncreated: 2026-10-08\n---')).toBe(true)
  const a = agg()
  note = upsertSession(note, a.sessionId, renderBlock(a, ROOT, null, '14:10'), a.indexLine)
  expect(note).toContain('## Index\n\n- **Contact form**: added spam check <!-- vs:abcdef12 -->')
  expect(note).toContain('## Session 2 (14:05): contact form')
  expect(note).toContain('cwd `C:/code/website`')
  expect(note).toContain('[[Projects/Website/memory/forms|forms]]')
  note = note + '\n## Session 3 (15:00): by hand\n\n### What Got Done\n- manual\n\n---\n'
  const b = agg({ done: [...agg().done, 'documented it (why: next session needs it)'], indexLine: '**Contact form**: spam check + docs' })
  const again = upsertSession(note, b.sessionId, renderBlock(b, ROOT, null, '14:30'), b.indexLine)
  expect(again).toContain('- documented it (why: next session needs it)')
  expect(again).toContain('## Session 3 (15:00): by hand')
  expect(again.match(/<!-- vault-scribe:session:abcdef12-3456 -->/g)?.length).toBe(1)
  expect(again.match(/<!-- \/vault-scribe:session:abcdef12-3456 -->/g)?.length).toBe(1)
  expect(again.match(/<!-- vs:abcdef12 -->/g)?.length).toBe(1)
  expect(countSessions(again)).toBe(2)
})

test('daily note: a template placeholder bullet is replaced, existing bullets kept', () => {
  const note = '# Day\n\n## Index\n<!-- hint -->\n\n- **Session topic** \u2014 one-line summary\n\n## Session 1 (09:00): x\n'
  const out = upsertSession(note, 'zzzzzzzz-1', '<!-- vault-scribe:session:zzzzzzzz-1 -->\nB\n<!-- /vault-scribe:session:zzzzzzzz-1 -->', '**Y**: y')
  expect(out).not.toContain('Session topic')
  expect(out).toContain('- **Y**: y <!-- vs:zzzzzzzz -->\n\n## Session 1')
  const kept = upsertSession('# D\n\n## Index\n\n- **Mods**: done\n\n## Session 1 (09:00): x\n', 'yyyyyyyy-1', 'B', '**Z**: z')
  expect(kept).toContain('- **Mods**: done\n- **Z**: z <!-- vs:yyyyyyyy -->')
})

test('the block carries every section, in order', () => {
  const b = renderBlock(agg({ discussions: ['weighed a captcha, rejected (why: accessibility)'], research: ['searched honeypot fields (source: https://example.com/honeypot)'] }), ROOT, null, '15:00')
  const order = ['### What Got Done', '### Decisions Made', '### Discussions & Open Questions', '### Research & Lookups', "### What's Still In Progress", '### Notes Touched', '### Signals for Review']
  const at = order.map(h => b.indexOf(h))
  expect(at.every(i => i >= 0)).toBe(true)
  expect([...at].sort((x, y) => x - y)).toEqual(at)
  expect(b).toContain('### Research & Lookups\n- searched honeypot fields (source: https://example.com/honeypot)')
})

test('signals round-trip and the pending flag', () => {
  const text = renderSignal({
    id: 'SIG-2026-10-08-abcdef12-1', status: '\u23f3 pending', kind: 'change', what: 'form API now returns 422', why: 'the blog embeds the form',
    from: 'session abcdef12 · cwd `C:/code/website` · own project: Website · 2026-10-08 14:10', touches: ['Blog (path C:/code/website/blog)', 'Website (own project) (cwd)'],
    sessionId: 'abcdef12',
  }) + renderSignal({
    id: 'SIG-2026-10-08-abcdef12-2', status: '\u2705 processed 2026-10-10: noted in the blog memory', kind: 'decision', what: 'w', why: 'y',
    from: 'f', touches: ['Website'], sessionId: 'abcdef12',
  })
  const sigs = parseSignals(text)
  expect(sigs.length).toBe(2)
  expect(sigs[0]?.touches[0]).toBe('Blog (path C:/code/website/blog)')
  expect(sigs[0]?.status.startsWith('\u23f3')).toBe(true)
  expect(sigs[1]?.status.startsWith('\u23f3')).toBe(false)
})

test('summary parsing keeps only known projects, and every section', () => {
  const s = parseSummary('noise {"topic":"t","index_line":"**T** \u2014 x","done":["a (why: b)"],"decisions":[],"in_progress":[],"discussions":["d"],"research":["r"],"signals":[{"kind":"change","what":"w","why":"y","projects":["Blog","Nope"],"quote":""}]} tail', ['Website', 'Blog'])
  expect(s?.signals[0]?.projects).toEqual(['Blog'])
  expect(s?.indexLine).toBe('**T**: x')
  expect(s?.discussions).toEqual(['d'])
  expect(s?.research).toEqual(['r'])
  expect(parseSummary('not json', ['Website'])).toBeNull()
  expect(shouldQueue('change', ['Website'], 'Website')).toBe(false)
  expect(shouldQueue('discussion', ['Website', 'Blog'], 'Website')).toBe(true)
  expect(shouldQueue('decision', ['Website'], 'Website')).toBe(true)
})

test('decisions must quote the owner; unverifiable ones become discussions', () => {
  const said = ['no, keep the form on the contact page', 'yes go ahead and add the honeypot field']
  expect(hasVerifiedQuote('add a honeypot (Alex: "go ahead and add the honeypot")', said)).toBe(true)
  expect(hasVerifiedQuote('add a captcha (Alex: "add a captcha")', said)).toBe(false)
  const s = checkQuotes({
    topic: 't', indexLine: 'i', done: [], inProgress: [], discussions: [], research: [],
    decisions: ['add a honeypot (Alex: "go ahead and add the honeypot")', 'move the form to its own page'],
    signals: [
      { kind: 'decision', what: 'move the form', why: '', projects: [], quote: '' },
      { kind: 'correction', what: 'keep the form on the contact page', why: '', projects: [], quote: 'keep the form on the contact page' },
    ],
  }, said)
  expect(s.decisions).toEqual(['add a honeypot (Alex: "go ahead and add the honeypot")'])
  expect(s.discussions).toEqual(['proposed, not confirmed: move the form to its own page'])
  expect(s.signals.map(x => x.kind)).toEqual(['discussion', 'correction'])
})

test('citations: an insert above a cited line is caught', () => {
  const idx = extractCitations(`${ROOT}/Inbox/todo.md`, 'see `Projects\\map.md:128` and home.md:3')
  expect(idx.map(c => [c.target, c.cited])).toEqual([['map.md', 128], ['home.md', 3]])
  expect(firstDiffLine('a\nb\nc', 'a\nX\nb\nc')).toBe(2)
  expect(staleCitations(idx, `${ROOT}/Projects/map.md`, 92, 1).length).toBe(1)
  expect(staleCitations(idx, `${ROOT}/Projects/map.md`, 200, 1).length).toBe(0)
  expect(staleCitations(idx, `${ROOT}/Projects/map.md`, 92, 0).length).toBe(0)
  expect(noteLink(`${ROOT}/x/MEMORY.md`, ROOT)).toBe('[[x/MEMORY|MEMORY]]')
})
