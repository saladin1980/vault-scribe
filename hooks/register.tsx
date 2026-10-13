// vault-scribe: an all-in-one notes manager for an Obsidian "second brain".
// Writes the daily note itself (changes and why, decisions, discussions, research and lookups), queues
// cross-project signals for a reviewer, shows a heads-up band, and guards a few dangerous writes.
// Configured by one note in the vault: see README.md and docs/configuration.md.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HeadsUp, HeadsUpItem } from '../types'
import {
  N8N_WHY, approvesPush, checkQuotes, clip, fwd, commandDenyReason, matchPushRule, parseGitPush, countSessions, dailyNotePath, digestText, extractCitations, firstDiffLine,
  isN8nDeleteTool, isPending, isTrivial, isUnder, lineCount, mergeSummary, newDailyNote, newSignalsFile, norm,
  ownProject, parseProjectMap, parseSignals, parseSummary, pathDenyReason, redact, renderBlock, renderSignal,
  countNames, shouldQueue, signalsPath, staleCitations, stampOf, summaryPrompt, tagText, touchName, upsertSession, vaultRel,
} from './lib'
import type { Agg, Citation, GuardOptions, ProjectMap, Signal, Summary, TurnRec } from './lib'

type $T = EngineInterface

const headsUp = atom({ plugin: 'vault-scribe', key: 'headsUp' } as const, null)
const isDismissed = atom({ plugin: 'vault-scribe', key: 'isDismissed' } as const, false)

const HUMAN = new Set(['composer', 'bridge'])
const IDLE_MS = 8 * 60 * 1000
const HEADS_UP_EVERY_MS = 10 * 60 * 1000
const HEADS_UP_DAYS = 14
const KEEP_SESSIONS_MS = 3 * 24 * 3600 * 1000
const RECOVER_AFTER_MS = 30 * 60 * 1000


// Module state: a hot reload drops it; the session's aggregate lives in $.store too.
let root = ''
let configNote = 'vault-scribe/config.md'
let map: ProjectMap = parseProjectMap('')
let agg: Agg | null = null
let current: TurnRec = { actions: [] }
let citations: Citation[] | null = null
let mdPaths = new Set<string>()
let nameCounts = new Map<string, number>()
let headsUpAt = 0
let idle: { cancel: () => void } | null = null
let chain: Promise<unknown> = Promise.resolve()

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}
function log($: $T, text: string) {
  try { $.ui.log(`vault-scribe: ${text}`) } catch { /* nothing draws */ }
}

async function loadMap($: $T) {
  try {
    map = parseProjectMap(await $.fs.read(`${root}/${configNote}`))
  } catch {
    log($, `config note ${configNote} unreadable; using defaults, project tagging is off until it is back`)
  }
  return map
}

async function freshAgg($: $T, id: string, cwd: string): Promise<Agg> {
  const now = await $.clock.now()
  const s = stampOf(now, map.timeZone)
  return {
    sessionId: id, cwd: fwd(cwd), own: ownProject(cwd, map.projects, root), sessionNo: 0, date: s.date, startedAt: s.time,
    updatedAtMs: now, ctx: [], isNudged: false, isHeadsUpSent: false, topic: '', indexLine: '', done: [],
    decisions: [], inProgress: [], discussions: [], research: [], notes: [], signalIds: [], digest: [], humanTurns: 0,
    isReps: false,
  }
}

async function ensureAgg($: $T): Promise<Agg> {
  const id = await $.session.id()
  if (agg && agg.sessionId === id) return agg
  const stored = (await $.store.get(`sess:${id}`)) as Agg | undefined
  agg = stored && stored.sessionId === id ? stored : await freshAgg($, id, await $.session.root())
  // Records made by an older build lack the newer fields.
  agg.discussions ??= []
  agg.research ??= []
  return agg
}

async function saveAgg($: $T, a: Agg) {
  a.updatedAtMs = await $.clock.now()
  await $.store.set(`sess:${a.sessionId}`, a)
}

async function save($: $T) {
  if (agg) await saveAgg($, agg)
}

// ---------- heads-up ----------

async function refreshHeadsUp($: $T) {
  headsUpAt = await $.clock.now()
  const a = await ensureAgg($)
  const dir = `${root}/${map.signalsDir}`
  if (!(await $.fs.exists(dir))) return
  const cutoff = stampOf(headsUpAt - HEADS_UP_DAYS * 24 * 3600 * 1000, map.timeZone).date
  const files = (await $.fs.list(dir)).filter(f => f.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(f.name) && f.name.slice(0, 10) >= cutoff)
  const id8 = a.sessionId.slice(0, 8)
  const items: HeadsUpItem[] = []
  for (const f of files) {
    const sigs = parseSignals(await $.fs.read(`${dir}/${f.name}`).catch(() => ''))
    for (const s of sigs) {
      if (!isPending(s) || s.sessionId === id8) continue
      const touchesOwn = a.own === 'vault' || s.touches.some(t => touchName(t) === a.own)
      if (touchesOwn) items.push({ id: s.id, what: s.what, kind: s.kind, from: s.from.replace(/ · cwd.*$/, '') })
    }
  }
  const next: HeadsUp | null = items.length === 0 ? null : { project: a.own, items: items.slice(-5), total: items.length }
  await update($, headsUp, () => next)
  $.ui.status(`📓 scribe · ${a.own}${next ? ` · ⚠ ${next.total}` : ''}`)
}

// ---------- citation index (vault .md files citing file.md:NNN) ----------

async function buildCitations($: $T) {
  const out: Citation[] = []
  const paths = new Set<string>()
  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return
    const entries = await $.fs.list(dir).catch(() => [])
    for (const en of entries) {
      if (en.kind === 'dir' && !map.skipDirs.includes(en.name) && !en.name.startsWith('.')) await walk(`${dir}/${en.name}`, depth + 1)
      else if (en.kind === 'file' && en.name.toLowerCase().endsWith('.md')) {
        const path = `${dir}/${en.name}`
        paths.add(norm(path))
        if (en.size >= 2_000_000) continue
        const text = await $.fs.read(path).catch(() => '')
        if (/\.md:\d/.test(text)) out.push(...extractCitations(path, text))
      }
    }
  }
  await walk(root, 0)
  mdPaths = paths
  nameCounts = countNames([...paths])
  citations = out
}

function reindex(path: string, text: string) {
  if (!citations) return
  citations = citations.filter(c => norm(c.file) !== norm(path)).concat(extractCitations(path, text))
  if (!mdPaths.has(norm(path))) {
    mdPaths.add(norm(path))
    nameCounts = countNames([...mdPaths])
  }
}

// ---------- flush: summary → signals → daily note ----------

/** The live session's flush. `summarize` false = the cheap per-turn write: no model call, digest kept. */
async function flush($: $T, why: string, summarize = true) {
  return serial(async () => flushAgg($, await ensureAgg($), why, summarize))
}

async function flushAgg($: $T, a: Agg, why: string, summarize: boolean) {
  {
    if (a.digest.length === 0 && a.notes.length === 0 && a.done.length === 0) return
    if (summarize && a.digest.length === 0 && a.sessionNo > 0) return
    await loadMap($)
    const names = map.projects.map(p => p.name)
    const now = await $.clock.now()
    const stamp = stampOf(now, map.timeZone)
    a.discussions ??= []
    a.research ??= []

    let summary: Summary | null = null
    if (summarize && a.digest.length > 0) {
      const { system, prompt } = summaryPrompt(digestText(a.digest), map.projects, a.own, map.owner)
      const r = await $.model.complete({ model: map.model, system, prompt, maxTokens: 2500, effort: 'low' }).catch(() => null)
      if (r && r.isAnswered) summary = parseSummary(r.text, names)
      // A decision only counts when it quotes words the owner actually typed.
      const ownerWords = a.digest.map(t => t.prompt ?? '').filter(x => x !== '')
      if (summary) summary = checkQuotes(summary, ownerWords)
      if (!summary) log($, `summary unavailable (${r ? (r.isAnswered ? 'unparseable reply' : r.reason) : 'request refused'}); wrote the deterministic part only`)
    }

    // Deterministic tags from what the session actually touched.
    const det = new Map<string, string[]>()
    for (const t of a.digest) for (const act of t.actions) {
      // Only changes count: edits, writes and non-read-only shell commands. Reads, lookups and reports don't.
      if (!/^(edit|write) |^(Bash|PowerShell): /.test(act)) continue
      // An edit is evidence by its path alone, never by the text it changed.
      const subject = /^(edit|write) /.test(act) ? actionPath(act) : act
      // Only a real path or host is evidence of touching a project; a keyword inside command text is not
      // (a heredoc full of project names tagged seven projects on 2026-10-08).
      for (const [p, ev] of tagText(subject, map.projects)) {
        const hard = ev.filter(x => !x.startsWith('keyword '))
        if (hard.length > 0) det.set(p, [...new Set([...(det.get(p) ?? []), ...hard])])
      }
    }

    const found: { kind: Signal['kind']; what: string; why: string; touches: Map<string, string[]> }[] = []
    for (const s of summary?.signals ?? []) {
      const touches = new Map<string, string[]>()
      for (const p of s.projects) touches.set(p, ['named by summary'])
      for (const [p, ev] of tagText(`${s.what} ${s.why}`, map.projects)) touches.set(p, [...(touches.get(p) ?? []), ...ev])
      found.push({ kind: s.kind, what: s.what, why: s.why, touches })
    }
    for (const [p, ev] of det) {
      if (p === a.own || found.some(f => f.touches.has(p))) continue
      found.push({
        kind: 'change',
        what: `This session touched ${p} while working in ${a.own}: ${ev.slice(0, 3).join(', ')}`,
        why: 'Detected from the tools the session ran; no summarized signal covered it. Check what changed and whether its notes need it.',
        touches: new Map([[p, ev]]),
      })
    }

    const queued: Signal[] = []
    const id8 = a.sessionId.slice(0, 8)
    if (summarize && !a.isReps) {
      for (const f of found) {
        const projects = [...f.touches.keys()]
        if (!shouldQueue(f.kind, projects, a.own)) continue
        const touches = projects.map(p => `${p}${p === a.own ? ' (own project)' : ''} (${clip(f.touches.get(p)!.join(', '), 160)})`)
        queued.push({
          id: `SIG-${stamp.date}-${id8}-${a.signalIds.length + queued.length + 1}`, status: '⏳ pending', kind: f.kind,
          what: redact(f.what), why: redact(f.why), sessionId: id8,
          from: `session ${id8} · cwd \`${a.cwd}\` · own project: ${a.own} · ${stamp.date} ${stamp.time}`,
          touches: touches.length > 0 ? touches : [`${a.own} (own project)`],
        })
      }
      if (queued.length > 0) {
        const path = signalsPath(root, stamp.date, map.signalsDir)
        const text = await $.fs.read(path).catch(() => newSignalsFile(stamp.date))
        await $.fs.write(path, text.replace(/\s*$/, '\n\n') + queued.map(renderSignal).join('\n'))
        a.signalIds.push(...queued.map(q => q.id))
      }
    }

    // Notes for the model, delivered with the owner's next prompt.
    for (const q of queued) {
      if (q.kind === 'decision' || q.kind === 'correction') {
        a.ctx.push(`vault-scribe: captured a ${q.kind}: "${clip(q.what, 200)}" (${q.id}, queued for review). Before calling it applied, search the WHOLE vault for its subject, not just the file at hand: a ruling applied to one file tends to leave contradicting lines elsewhere.`)
      }
    }
    const ownRow = map.projects.find(p => p.name === a.own)
    const touchedOwnMemory = ownRow ? a.notes.some(n => isUnder(n, `${root}/${ownRow.memory}`)) : true
    const editedSomething = a.digest.some(t => t.actions.some(x => /^(edit|write) /.test(x)))
    if (summarize && ownRow && !touchedOwnMemory && !a.isNudged && editedSomething && a.humanTurns >= 3) {
      a.isNudged = true
      a.ctx.push(`vault-scribe: this session has been changing ${a.own}, and nothing in its memory folder (${ownRow.memory}) has been updated yet. If a fact a future session needs changed, update that project's memory notes now while the context is here; the daily note is already handled.`)
    }

    if (summary) Object.assign(a, mergeSummary(a, summary))
    if (summarize && !summary && a.digest.length > 0) {
      const acts = a.digest.flatMap(t => t.actions).filter(x => /^(edit|write) /.test(x)).map(actionPath)
      if (acts.length > 0) a.done.push(`edited ${acts.length} file(s): ${clip([...new Set(acts)].slice(0, 4).join(', '), 220)}`)
    }
    if (summarize) a.digest = []

    // Daily note: this session's block + Index bullet only, the file re-read just before the write.
    const notePath = dailyNotePath(root, stampOfDate(a.date), map.dailyNotePattern)
    const raw = await $.fs.read(notePath).catch(() => newDailyNote(stampOfDate(a.date), map.dailyFrontmatter))
    const isCrlf = raw.includes('\r\n')
    if (a.sessionNo === 0) a.sessionNo = countSessions(raw) + 1
    const sigLink = a.signalIds.length > 0 ? `[[${map.signalsDir.replace(/^[\\/]+|[\\/]+$/g, '')}/${a.date}|signals ${a.date}]]` : null
    const indexLine = a.indexLine || `**${a.topic || 'Session'}**: in progress`
    const out = upsertSession(raw, a.sessionId, renderBlock(a, root, sigLink, stamp.time), indexLine)
    await $.fs.write(notePath, isCrlf ? out.replace(/\n/g, '\r\n') : out)
    await saveAgg($, a)
    if (why === 'command') log($, `daily note updated (${notePath})`)
    if (why === 'recover') log($, `recovered session ${id8} (it ended without writing up its last turns)`)
  }
}

/** Sessions that died (crash, closed window) with turns never written up: write them now. */
async function recoverOrphans($: $T) {
  const now = await $.clock.now()
  const live = agg?.sessionId
  for (const k of await $.store.keys()) {
    if (!k.startsWith('sess:') || k === `sess:${live}`) continue
    const v = (await $.store.get(k)) as Agg | undefined
    if (!v) continue
    const idleFor = now - (v.updatedAtMs ?? 0)
    // A live session writes up its digest within IDLE_MS; one still holding turns well past that is dead.
    if (v.digest && v.digest.length > 0 && idleFor > RECOVER_AFTER_MS) {
      await serial(() => flushAgg($, v, 'recover', true)).catch(() => undefined)
    } else if (idleFor > KEEP_SESSIONS_MS && (!v.digest || v.digest.length === 0)) {
      await $.store.delete(k)
    }
  }
}

/** `edit D:/x/y.md: "old" -> "new"` / `write D:/x/y.md (12 lines)` → `D:/x/y.md` */
function actionPath(act: string): string {
  return act.replace(/^(edit|write) /, '').split(/: "| \(/)[0] ?? ''
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim()

/** What a tool call contributes to the work log, or null for calls not worth noting. */
function describeCall(tool: string, args: Record<string, unknown>, isReadOnly: boolean): string | null {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const path = fwd(s('file_path') || s('notebook_path'))
  if (tool === 'Edit' && path) {
    return `edit ${path}: "${clip(redact(oneLine(s('old_string'))), 90)}" -> "${clip(redact(oneLine(s('new_string'))), 90)}"`
  }
  if (tool === 'MultiEdit' && path) return `edit ${path} (${Array.isArray(args.edits) ? args.edits.length : 1} edits)`
  if (tool === 'NotebookEdit' && path) return `edit ${path} (notebook cell)`
  if (tool === 'Write' && path) return `write ${path} (${s('content').split(/\r?\n/).length} lines)`
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = s('command')
    return cmd ? `${isReadOnly ? 'read ' : ''}${tool}: ${clip(redact(oneLine(cmd)), 300)}` : null
  }
  if (tool === 'Read' && path) return `read Read: ${path}`
  if (tool === 'Grep') return `read Grep: "${clip(s('pattern'), 80)}" in ${fwd(s('path')) || '.'}`
  if (tool === 'Glob') return `read Glob: ${clip(s('pattern'), 80)} in ${fwd(s('path')) || '.'}`
  if (tool === 'WebSearch' || (/web[_-]?search/i.test(tool) && s('query'))) return `web search: ${clip(s('query'), 200)}`
  if (tool === 'WebFetch' || (/fetch/i.test(tool) && s('url'))) return `web fetch: ${clip(s('url'), 300)}`
  if (/navigate$/i.test(tool) && s('url')) return `web open: ${clip(s('url'), 300)}`
  if (tool === 'Agent' || tool === 'Task') return `research agent: ${clip(oneLine(s('description') || s('prompt')), 160)}`
  return null
}

/**
 * The push guard: what the config note's push policy says about this `git push`, judged before it runs.
 * A held push goes through only when the owner's own prompt this turn approves it ("ship it", "push it").
 */
async function pushDecision($: $T, command: string): Promise<{ deny?: string; note?: string }> {
  const p = parseGitPush(command)
  if (!p || (map.pushPolicy.length === 0 && !map.guardForcePush)) return {}
  const cwd = fwd(await $.session.cwd())
  const dir = p.dir === null ? cwd : /^[a-z]:|^\//i.test(fwd(p.dir)) ? fwd(p.dir) : `${cwd}/${fwd(p.dir)}`
  const git = async (...args: string[]) => {
    const r = await $.process.run(['git', '-C', dir, ...args], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  }
  const url = await git('remote', 'get-url', p.remote)
  const branch = p.branch ?? (await git('rev-parse', '--abbrev-ref', 'HEAD'))
  const rule = matchPushRule(map.pushPolicy, url, dir, branch)
  const said = current.prompt ?? ''
  const where = `${url || dir} (${branch || 'current branch'})`
  if (p.isForce && map.guardForcePush && !approvesPush(said, true)) {
    return { deny: `vault-scribe held this push: it is a FORCE push to ${where}, which can wipe history. Ask ${map.owner} first; it goes through when their own message approves a force push (e.g. "force push it").` }
  }
  if (rule?.policy === 'hold' && !approvesPush(said, p.isForce)) {
    return {
      deny: [
        `vault-scribe held this push to ${where}: ${rule.deploysTo || 'the push policy holds it'}.`,
        rule.test ? `Before asking: ${rule.test}.` : '',
        `Get ${map.owner}'s explicit sign-off, then push again. It goes through when their own message approves it ("ship it", "push it", "go ahead and push").`,
      ].filter(x => x !== '').join(' '),
    }
  }
  if (rule?.policy === 'announce') {
    return { note: `vault-scribe: that push to ${where} deploys: ${rule.deploysTo}. Tell ${map.owner} it is on its way and what to test${rule.test ? ` (${rule.test})` : ''}.` }
  }
  return {}
}

function stampOfDate(date: string) {
  return stampOf(Date.parse(`${date}T12:00:00Z`))
}

function armIdle($: $T) {
  idle?.cancel()
  idle = $.clock.after(IDLE_MS, () => { void flush($, 'idle').catch(() => undefined) })
}

export const register: Register = (on, options) => {
  // ---------- hooks ----------

  on('session.start', async ($, e, next) => {
    // Vault: the vault_root option, else VAULT_SCRIBE_ROOT, else the folder the session started in.
    const opt = (k: string) => (typeof options[k] === 'string' ? (options[k] as string).trim() : '')
    root = (opt('vault_root') || (await $.env.get('VAULT_SCRIBE_ROOT')) || (await $.session.root()))
      .replace(/\\/g, '/').replace(/\/+$/, '')
    configNote = (opt('config_note') || (await $.env.get('VAULT_SCRIBE_CONFIG')) || 'vault-scribe/config.md').replace(/\\/g, '/')
    await loadMap($)
    agg = null
    const a = await ensureAgg($)
    // The map may have changed since this session's record was made (or an older build computed it).
    const startDir = await $.session.root()
    a.cwd = fwd(startDir)
    a.own = ownProject(startDir, map.projects, root)
    await save($)
    current = { actions: [] }
    // A resumed or reloaded session with turns never written up: write them now, summarize in the background.
    if (a.digest.length > 0) {
      await flush($, 'resume', false).catch(() => undefined)
      $.clock.after(1000, () => { void flush($, 'resume', true).catch(() => undefined) })
    }
    await $.command.register({ name: 'scribe', description: 'vault-scribe: status, or `/scribe flush` to write the daily note now', argumentHint: '[flush]' })
    await refreshHeadsUp($).catch(() => undefined)
    // Background: prune old session records, build the citation index.
    $.clock.after(1500, () => {
      void (async () => {
        await recoverOrphans($)
        await buildCitations($)
      })().catch(() => undefined)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await flush($, 'end').catch(() => undefined)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const a = await ensureAgg($).catch(() => null)
    if (!a) return next(e)
    const text = e.text.trim()
    const kind = e.origin.kind
    const rc = map.reviewerCommand
    if (rc !== '' && (text.startsWith(`/${rc}`) || (kind === 'scheduled-trigger' && text.includes(rc)))) a.isReps = true
    if (HUMAN.has(kind) && !text.startsWith('/') && !isTrivial(text)) {
      current.prompt = clip(redact(text), 1500)
    } else if (HUMAN.has(kind) && isTrivial(text)) {
      current.prompt = current.prompt ?? text
    }

    const extra: string[] = []
    const hu = await read($, headsUp)
    if (hu && !a.isHeadsUpSent && HUMAN.has(kind) && a.own !== 'vault') {
      a.isHeadsUpSent = true
      extra.push([
        `vault-scribe heads-up: ${hu.total} change(s) from other sessions touch ${hu.project} and have not been reviewed yet. Treat the notes they affect as possibly stale:`,
        ...hu.items.map(i => `- [${i.kind}] ${i.what} (${i.from}; ${i.id})`),
        `Mention this to ${map.owner} once if it bears on what they asked. Do not fix other projects' notes from here; the reviewer does that.`,
      ].join('\n'))
    }
    if (a.ctx.length > 0 && HUMAN.has(kind)) extra.push(...a.ctx.splice(0))
    if ((await $.clock.now()) - headsUpAt > HEADS_UP_EVERY_MS) $.clock.after(50, () => { void refreshHeadsUp($).catch(() => undefined) })
    await save($)
    return extra.length > 0 ? next({ ...e, context: [...(e.context ?? []), ...extra] }) : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>
    const path = typeof args.file_path === 'string' ? args.file_path : typeof args.notebook_path === 'string' ? args.notebook_path : null
    const command = (tool === 'Bash' || tool === 'PowerShell') && typeof args.command === 'string' ? args.command : null
    const isWrite = tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit'

    // Hard rules: refuse before anything runs.
    const g: GuardOptions = { vaultRoot: root, autoMemory: map.guardAutoMemory, paths: map.guardPaths, n8n: map.guardN8nDelete }
    const reason = (isWrite && path ? pathDenyReason(path, g) : null)
      ?? (command ? commandDenyReason(command, g) : null)
      ?? (map.guardN8nDelete && isN8nDeleteTool(tool) ? N8N_WHY : null)
    if (reason) return { deny: `vault-scribe refused this: ${reason}` }
    const push = command ? await pushDecision($, command).catch(() => ({} as { deny?: string; note?: string })) : {}
    if (push.deny) return { deny: push.deny }

    // Soft rules: look before, act after.
    const isVaultMd = isWrite && path !== null && isUnder(path, root) && /\.md$/i.test(path)
    const before = isVaultMd ? await $.fs.read(path!).catch(() => null) : null
    const mf = map.memoryFolderName.toLowerCase()
    const newMemoryDir = isWrite && path !== null && mf !== '' && norm(path).split('/').includes(mf)
      ? !(await $.fs.exists(path.replace(/[\\/][^\\/]*$/, '')).catch(() => true))
      : false

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    // Read-only commands (the engine's own check) are context for the summary, never evidence of a change.
    const described = describeCall(tool, args, ran.isReadOnly === true)
    if (described) current.actions.push(described)

    const notes: string[] = []
    if (push.note) notes.push(push.note)
    if (agg && isVaultMd && path) {
      if (!agg.notes.some(n => norm(n) === norm(path))) agg.notes.push(path)
      if (map.reviewDir !== '' && isUnder(path, `${root}/${map.reviewDir}`)) agg.isReps = true
    }
    if (isVaultMd && path) {
      const after = await $.fs.read(path).catch(() => null)
      if (after !== null) {
        if (before !== null && citations) {
          const delta = lineCount(after) - lineCount(before)
          const from = firstDiffLine(before, after)
          const stale = staleCitations(citations, path, from, delta, nameCounts)
          if (stale.length > 0) {
            notes.push([
              `vault-scribe: this edit changed ${vaultRel(path, root)}.md's line count by ${delta > 0 ? '+' : ''}${delta} from line ${from}. These citations into it now point ${Math.abs(delta)} line(s) off. Fix them now (or make the edit line-neutral):`,
              ...stale.slice(0, 15).map(c => `- ${vaultRel(c.file, root) ?? c.file}.md:${c.line} cites :${c.cited} → now :${c.cited + delta}`),
              ...(stale.length > 15 ? [`- …and ${stale.length - 15} more`] : []),
            ].join('\n'))
          }
        }
        reindex(path, after)
      }
    }
    if (newMemoryDir && path) {
      notes.push([
        `vault-scribe: this created a new ${map.memoryFolderName}/ folder (${fwd(path).replace(/\/[^/]*$/, '')}), so a new project. Update these together, in this session (the config note's new project checklist):`,
        ...map.checklist.map(m => `- ${m}`),
      ].join('\n'))
    }
    return notes.length > 0 ? { ...ran, context: [...(ran.context ?? []), ...notes] } : ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // A subagent's final report is research the main session acted on: keep it for the summary.
    if (e.agentId !== undefined && e.answer) current.actions.push(`research report: ${clip(redact(oneLine(e.answer)), 1200)}`)
    if (e.agentId === undefined) {
      const a = await ensureAgg($).catch(() => null)
      if (a) {
        if (e.answer) current.answer = clip(redact(e.answer), 1500)
        if (current.prompt || current.actions.length > 0) {
          a.digest.push(current)
          if (current.prompt) a.humanTurns++
        }
        current = { actions: [] }
        await save($)
        // The note is written here, inside the hook: no timer a reload or crash could drop.
        await flush($, 'turn', false).catch(() => undefined)
        const prompts = a.digest.filter(t => t.prompt).length
        if (prompts >= map.summarizeEvery) $.clock.after(10, () => { void flush($, 'turns', true).catch(() => undefined) })
        armIdle($)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'scribe' }, async ($, e) => {
    const a = await ensureAgg($)
    if (e.args.trim() === 'flush') {
      if (current.prompt || current.actions.length > 0) { a.digest.push(current); current = { actions: [] } }
      await flush($, 'command')
      return { text: `vault-scribe: daily note written for session ${a.sessionId.slice(0, 8)} (${a.signalIds.length} signal(s) queued so far).` }
    }
    await refreshHeadsUp($).catch(() => undefined)
    const hu = await read($, headsUp)
    return {
      text: [
        `vault-scribe · owner: ${map.owner} · own project: ${a.own} · cwd ${a.cwd} · config: ${configNote}`,
        `captured: ${a.humanTurns} prompt(s), ${a.digest.length} turn(s) waiting for the next summary, ${a.notes.length} vault note(s) touched, ${(a.discussions ?? []).length} discussion(s), ${(a.research ?? []).length} research item(s)`,
        `daily note: ${a.sessionNo > 0 ? `Session ${a.sessionNo} in ${a.date}.md` : 'not written yet'} · summary model: ${map.model} every ${map.summarizeEvery} prompt(s)`,
        `signals queued by this session: ${a.signalIds.length}${a.isReps ? ' (reviewer run: queueing is off)' : ''}`,
        `heads-up: ${hu ? `${hu.total} pending signal(s) touch ${hu.project}` : 'nothing pending for this project'}`,
        `citation index: ${citations ? `${citations.length} citations` : 'building'}`,
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hu = await read($, headsUp)
    if (!hu || e.props.hasSurvey || (await read($, isDismissed))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = Math.max(30, (e.props.bodyColumns ?? e.viewport?.columns ?? 80) - 4)
    return (
      <Box flexDirection="column">
        <Text color="warning" bold>
          ⚠ {hu.total} change{hu.total === 1 ? '' : 's'} from other sessions touch {hu.project}, pending review
        </Text>
        {hu.items.slice(-3).map(i => (
          <Text dimColor wrap="truncate-end">
            {clip(`· ${i.what} (${i.from})`, cols)}
          </Text>
        ))}
        <Box>
          <Button key="vs-dismiss" label="Dismiss" onPress={() => update($, isDismissed, () => true)} />
        </Box>
      </Box>
    )
  })
}
