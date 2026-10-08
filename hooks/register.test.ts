import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const VOID = { value: undefined } as never
const ok = (value: unknown) => ({ value }) as never
const ROOT = 'C:/Vault'
/** The engine hands fs hooks Windows spellings; the mock keys on forward slashes. */
const key = (p: string) => p.replace(/\\/g, '/')
const CONFIG_PATH = `${ROOT}/vault-scribe/config.md`
const DAILY = `${ROOT}/Daily/2026-10-08.md`
const SIGNALS = `${ROOT}/vault-scribe/signals/2026-10-08.md`
const CONFIG = `---
scribe_model: haiku
summarize_every: 1
owner: Alex
daily_note_path: Daily/{YYYY}-{MM}-{DD}.md
guard_auto_memory: true
guard_n8n_delete: true
---
| Project | Memory | Paths | Hosts | Keywords |
|---|---|---|---|---|
| Website | Projects/Website/memory | C:/code/website | example.com | astro |
| Blog | Projects/Blog/memory | C:/code/blog | blog.example.com | posts |
`
const SUMMARY = {
  topic: 'contact form', index_line: '**Contact form** \u2014 added a spam check', done: ['added a spam check (why: bot submissions)'],
  decisions: ['use a honeypot field (Alex: "add the honeypot field")', 'move the form to its own page (Alex: "move it to its own page")'],
  in_progress: [], discussions: ['weighed a captcha, rejected for accessibility'],
  research: ['read the blog embed code: it posts to the same endpoint (source: C:/code/blog/embed.js)'],
  signals: [{ kind: 'change', what: 'the form endpoint now returns 422 on spam', why: 'the blog embeds this form', projects: ['Blog'], quote: '' }],
}

function world(on: On, store: Record<string, unknown> = {}, toolResult: object = { result: 'done', text: 'done' }) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-08T16:00:00Z') })
  mock.store(on, store)
  mock.env(on, { VAULT_SCRIBE_ROOT: ROOT })
  const files: Record<string, string> = { [CONFIG_PATH]: CONFIG }
  const asked: string[] = []
  on('model.complete', async ($, e) => {
    asked.push(e.prompt)
    return ok({ isAnswered: true, text: JSON.stringify(SUMMARY), usage: {} })
  })
  on('session.id', async () => ok('abcdef12-0000-0000-0000-000000000000'))
  on('session.cwd', async () => ok('C:/code/website'))
  on('session.root', async () => ok('C:/code/website'))
  on('fs.exists', async ($, e) => ok(key(e.path) in files))
  on('fs.read', async ($, e) => {
    const k = key(e.path)
    if (!(k in files)) throw new Error('ENOENT')
    return ok(files[k])
  })
  on('fs.write', async ($, e) => {
    files[key(e.path)] = e.text
    return VOID
  })
  on('fs.list', async () => ok([]))
  on('command.register', async ($, e) => ok({ command: e.name }))
  on('ui.status', async () => VOID)
  on('ui.log', async () => VOID)
  on('ui.toast', async () => VOID)
  on('session.start', async () => ({ cwd: 'C:/code/website' }) as never)
  on('session.end', async ($, e) => ({ sessionId: e.sessionId }) as never)
  on('prompt.submit', async ($, e) => ({ text: e.text, context: e.context }))
  on('tool.call', async () => toolResult as never)
  on('turn.complete', async ($, e) => ({ text: e.answer }) as never)
  return { clock, files, asked }
}

const start = ($: Engine) =>
  $.session.start({ cwd: 'C:/code/website', surface: 'terminal', isInteractive: true } as never)

const turn = async ($: Engine, w: { clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> } }, id: string) => {
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: id, reason: 'answer' } as never)
  await w.clock.advance(50)
  await w.clock.settle()
}

test('guards refuse what the config turns on, and let the rest through', async ($, on) => {
  world(on)
  await start($)
  const r = (await $.tool.call({ tool: 'Write', file_path: 'C:/Users/alex/.claude/projects/C--code-website/memory/x.md', content: 'x' } as never)) as { deny?: string }
  expect(r.deny ?? '').toContain('vault-scribe refused')
  const n = (await $.tool.call({ tool: 'Bash', command: 'curl -X DELETE https://n8n.example.com/api/v1/workflows/42' } as never)) as { deny?: string }
  expect(n.deny ?? '').toContain('archive only')
  const fine = (await $.tool.call({ tool: 'Bash', command: 'ls' } as never)) as { deny?: string }
  expect(fine.deny).toBeUndefined()
})

test('a turn becomes a daily-note block with every section, plus a cross-project signal', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit({ text: 'yes add the honeypot field to the contact form', origin: { kind: 'composer' }, wait: false } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/code/website/src/contact.ts', old_string: 'const a = 1', new_string: 'const a = 2' } as never)
  await turn($, w, 't1')

  expect(w.asked.length).toBe(1)
  expect(w.asked[0] ?? '').toContain('ACTION: edit C:/code/website/src/contact.ts: "const a = 1" -> "const a = 2"')
  const note = w.files[DAILY] ?? ''
  // the summary's em-dash comes out as a colon
  expect(note).toContain('- **Contact form**: added a spam check <!-- vs:abcdef12 -->')
  expect(note).toContain('## Session 1 (12:00): contact form')
  expect(note).not.toContain('\u2014')
  expect(note).toContain('- added a spam check (why: bot submissions)')
  // a quoted decision the owner really typed stays; one quoting words they never typed is demoted
  expect(note).toContain('- use a honeypot field (Alex: "add the honeypot field")')
  expect(note).toContain('proposed, not confirmed: move the form to its own page')
  expect(note).toContain('### Discussions & Open Questions\n- weighed a captcha, rejected for accessibility')
  expect(note).toContain('### Research & Lookups\n- read the blog embed code')
  const sig = w.files[SIGNALS] ?? ''
  expect(sig).toContain('### SIG-2026-10-08-abcdef12-1 \u00b7 \u23f3 pending')
  expect(sig).toContain('Blog')
  expect(note).toContain('SIG-2026-10-08-abcdef12-1')
})

test('a session that died with unwritten turns is written up by the next one', async ($, on) => {
  const orphan = {
    sessionId: 'deadbeef-0000', cwd: 'C:/code/website', own: 'Website', sessionNo: 0, date: '2026-10-08', startedAt: '09:00',
    updatedAtMs: Date.parse('2026-10-08T13:00:00Z'), ctx: [], isNudged: false, isHeadsUpSent: false, topic: '', indexLine: '',
    done: [], decisions: [], inProgress: [], notes: [], signalIds: [], humanTurns: 1, isReps: false,
    digest: [{ prompt: 'add the honeypot field', actions: ['edit C:/code/website/src/contact.ts (1 edits)'], answer: 'done' }],
  }
  const w = world(on, { 'sess:deadbeef-0000': orphan })
  await start($)
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(w.asked.length).toBe(1)
  const note = w.files[DAILY] ?? ''
  expect(note).toContain('<!-- vault-scribe:session:deadbeef-0000 -->')
  expect(note).toContain('## Session 1 (09:00): contact form')
})

test('every turn writes the note, even before a summary is due', async ($, on) => {
  const w = world(on)
  w.files[CONFIG_PATH] = CONFIG.replace('summarize_every: 1', 'summarize_every: 5')
  await start($)
  await $.prompt.submit({ text: 'look at the contact form', origin: { kind: 'composer' }, wait: false } as never)
  await turn($, w, 't1')
  expect(w.asked.length).toBe(0)
  expect(w.files[DAILY] ?? '').toContain('1 recent turn(s) captured, summary on the next pass')
})

test('read-only commands never become "touched" signals', async ($, on) => {
  const w = world(on, {}, { result: 'x', text: 'x', isReadOnly: true })
  await start($)
  await $.prompt.submit({ text: 'research the blog notes', origin: { kind: 'composer' }, wait: false } as never)
  await $.tool.call({ tool: 'Bash', command: 'grep -rn form "C:/code/blog/src"' } as never)
  await turn($, w, 't1')
  expect(w.files[SIGNALS] ?? '').not.toContain('This session touched Blog')
})

test('lookups and research reach the summary as context, not as changes', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit({ text: 'look up how honeypot fields work', origin: { kind: 'composer' }, wait: false } as never)
  await $.tool.call({ tool: 'WebSearch', query: 'honeypot form field spam' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/code/blog/embed.js' } as never)
  await turn($, w, 't1')
  expect(w.asked[0] ?? '').toContain('ACTION: web search: honeypot form field spam')
  expect(w.asked[0] ?? '').toContain('ACTION: read Read: C:/code/blog/embed.js')
  expect(w.files[SIGNALS] ?? '').not.toContain('This session touched Blog')
})


const PUSH_CONFIG = CONFIG.replace('guard_n8n_delete: true', 'guard_n8n_delete: true\nguard_force_push: true') + `
## Push policy

| Repo | Branch | Policy | Deploys to | Test |
|---|---|---|---|---|
| alex/website | main | hold | live site, no staging | run npm run dev first |
| alex/website | preview | announce | preview deploy on Vercel | check the preview URL |
`

function pushWorld(on: On, branch: string) {
  const w = world(on)
  w.files[CONFIG_PATH] = PUSH_CONFIG
  on('process.run', async ($, e) => {
    const a = e.argv.join(' ')
    const out = a.includes('remote get-url') ? 'https://github.com/alex/website.git\n' : a.includes('rev-parse') ? `${branch}\n` : ''
    return ok({ exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  })
  return w
}

test('push guard: a held push is refused until the owner says ship it', async ($, on) => {
  pushWorld(on, 'main')
  await start($)
  await $.prompt.submit({ text: 'commit the form fix', origin: { kind: 'composer' }, wait: false } as never)
  const held = (await $.tool.call({ tool: 'Bash', command: 'git push' } as never)) as { deny?: string }
  expect(held.deny ?? '').toContain('held this push')
  expect(held.deny ?? '').toContain('run npm run dev first')
  await $.prompt.submit({ text: 'tested it locally, ship it', origin: { kind: 'composer' }, wait: false } as never)
  const ok2 = (await $.tool.call({ tool: 'Bash', command: 'git push' } as never)) as { deny?: string }
  expect(ok2.deny).toBeUndefined()
})

test('push guard: announce lets it through with a note; force push is held', async ($, on) => {
  pushWorld(on, 'preview')
  await start($)
  await $.prompt.submit({ text: 'push the preview', origin: { kind: 'composer' }, wait: false } as never)
  const r = (await $.tool.call({ tool: 'PowerShell', command: 'git push origin preview' } as never)) as { deny?: string; context?: string[] }
  expect(r.deny).toBeUndefined()
  expect((r.context ?? []).join(' ')).toContain('preview deploy on Vercel')
  const f = (await $.tool.call({ tool: 'Bash', command: 'git push --force origin preview' } as never)) as { deny?: string }
  expect(f.deny ?? '').toContain('FORCE push')
})
