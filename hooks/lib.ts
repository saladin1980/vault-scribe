// vault-scribe: pure logic, no `$`. Everything here is testable on its own.
// See README.md and docs/ for what each piece is for.

export type Project = { name: string; memory: string; paths: string[]; hosts: string[]; keywords: string[] }
/** Everything a vault owner can tune, read from the config note's frontmatter at runtime. */
export type ProjectMap = {
  projects: Project[]
  model: string
  summarizeEvery: number
  /** Who the sessions belong to, as the summaries should name them. */
  owner: string
  timeZone: string
  /** Vault-relative; tokens {YYYY} {MM} {DD} {Month}. */
  dailyNotePattern: string
  signalsDir: string
  /** Edits under this vault folder mark a session as the reviewer's own run (no signals queued). */
  reviewDir: string
  /** A slash command that runs your reviewer (e.g. `review-vault`); its sessions queue no signals. */
  reviewerCommand: string
  /** Folder name that marks a project's memory (e.g. `claude-memory`); creating a new one shows the checklist. */
  memoryFolderName: string
  /** Folder names the citation index never walks into. */
  skipDirs: string[]
  /** Extra frontmatter lines for a daily note the scribe creates. */
  dailyFrontmatter: string[]
  /** Refuse writes into Claude Code's per-project auto-memory (~/.claude/projects/<x>/memory), except the vault's own. */
  guardAutoMemory: boolean
  /** Refuse writes whose path contains any of these fragments (case-insensitive, forward slashes). */
  guardPaths: string[]
  guardN8nDelete: boolean
  /** What to update when a new project memory folder appears ("## New project checklist" in the config note). */
  checklist: string[]
  /** Per repo and branch: what a push does and whether it is held ("## Push policy" in the config note). */
  pushPolicy: PushRule[]
  /** Hold every force push, whatever the policy says. */
  guardForcePush: boolean
}

export type PushPolicyKind = 'hold' | 'announce' | 'go'
export type PushRule = { repo: string; branch: string; policy: PushPolicyKind; deploysTo: string; test: string }

export const DEFAULT_DAILY_NOTE = '{YYYY}-{MM}-{DD}.md'
export const DEFAULT_SIGNALS_DIR = 'vault-scribe/signals'
export const DEFAULT_CHECKLIST = ['the vault-scribe config note: a project-table row so the new project gets tagged']

export type SignalKind = 'change' | 'decision' | 'correction' | 'fact' | 'discussion'
export type Signal = {
  id: string
  status: string
  kind: SignalKind
  what: string
  why: string
  from: string
  touches: string[]
  sessionId: string
}

export type TurnRec = { prompt?: string; actions: string[]; answer?: string }

export type Agg = {
  sessionId: string
  cwd: string
  own: string
  sessionNo: number
  /** The note's date (the session's start day), and its HH:MM start. */
  date: string
  startedAt: string
  updatedAtMs: number
  /** Notes for the model, flushed into the next prompt's context. */
  ctx: string[]
  isNudged: boolean
  isHeadsUpSent: boolean
  topic: string
  indexLine: string
  done: string[]
  decisions: string[]
  inProgress: string[]
  /** Options weighed, proposals waiting on the owner, ideas rejected and why. */
  discussions: string[]
  /** What was read or looked up, the finding, and what it informed (with sources). */
  research: string[]
  notes: string[]
  signalIds: string[]
  digest: TurnRec[]
  humanTurns: number
  isReps: boolean
}

export type Summary = {
  topic: string
  indexLine: string
  done: string[]
  decisions: string[]
  inProgress: string[]
  discussions: string[]
  research: string[]
  signals: { kind: SignalKind; what: string; why: string; projects: string[]; quote: string }[]
}

// ---------- paths ----------

/** Display form of a path: forward slashes. */
export const fwd = (p: string) => p.replace(/\\/g, '/')

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export const isUnder = (path: string, root: string) => {
  const p = norm(path)
  const r = norm(root)
  return p === r || p.startsWith(r + '/')
}

/** `C:\Vault\Projects\x.md` → `Projects/x` (null outside the vault). */
export function vaultRel(path: string, vaultRoot: string): string | null {
  if (!isUnder(path, vaultRoot)) return null
  const p = path.replace(/\\/g, '/')
  const rel = p.slice(vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '').length + 1)
  return rel.replace(/\.md$/i, '')
}

export function noteLink(path: string, vaultRoot: string): string | null {
  const rel = vaultRel(path, vaultRoot)
  if (rel === null || !/\.md$/i.test(path)) return null
  const base = rel.split('/').pop() ?? rel
  return `[[${rel}|${base}]]`
}

// ---------- project map ----------

export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kv && kv[1]) out[kv[1]] = (kv[2] ?? '').trim()
  }
  return out
}

const cells = (s: string) =>
  s.split(',').map(x => x.trim()).filter(x => x !== '')

export function parseProjectMap(text: string): ProjectMap {
  const fm = parseFrontmatter(text)
  const projects: Project[] = []
  let inTable = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^\|\s*Project\s*\|/i.test(line)) { inTable = true; continue }
    if (!inTable) continue
    if (!line.startsWith('|')) { if (projects.length > 0) break; continue }
    if (/^\|[\s|:-]+\|$/.test(line)) continue
    const c = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(x => x.trim())
    const [name = '', memory = '', paths = '', hosts = '', keywords = ''] = c
    if (c.length < 5 || name === '') continue
    projects.push({ name, memory, paths: cells(paths), hosts: cells(hosts), keywords: cells(keywords) })
  }
  const every = Number.parseInt(fm.summarize_every ?? '', 10)
  const flag = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : !/^(false|no|off|0)$/i.test(v))
  const text_ = (v: string | undefined, d: string) => (v ?? '').trim().replace(/^["']|["']$/g, '') || d
  const list = (v: string | undefined, d: string[]) => {
    const l = (v ?? '').split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(x => x !== '')
    return l.length > 0 ? l : d
  }
  const checklist: string[] = []
  const pushPolicy: PushRule[] = []
  let inPush = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^#{1,6}\s+push policy\s*$/i.test(line)) { inPush = true; continue }
    if (inPush && /^#{1,6}\s/.test(line)) break
    if (!inPush || !line.startsWith('|') || /^\|[\s|:-]+\|$/.test(line) || /^\|\s*repo\s*\|/i.test(line)) continue
    const [repo = '', branch = '', policy = '', deploysTo = '', test = ''] = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(x => x.trim())
    const kind = policy.toLowerCase()
    if (repo !== '' && (kind === 'hold' || kind === 'announce' || kind === 'go')) {
      pushPolicy.push({ repo, branch: branch || '*', policy: kind, deploysTo, test })
    }
  }
  let inChecklist = false
  for (const raw of text.split(/\r?\n/)) {
    if (/^#{1,6}\s+new project checklist\s*$/i.test(raw.trim())) { inChecklist = true; continue }
    if (inChecklist && /^#{1,6}\s/.test(raw.trim())) break
    const b = inChecklist ? /^\s*[-*]\s+(.+)$/.exec(raw) : null
    if (b?.[1]) checklist.push(b[1].trim())
  }
  return {
    projects,
    model: text_(fm.scribe_model, 'haiku'),
    summarizeEvery: Number.isFinite(every) && every > 0 ? every : 3,
    owner: text_(fm.owner, 'the user'),
    timeZone: text_(fm.timezone, 'America/New_York'),
    dailyNotePattern: text_(fm.daily_note_path, DEFAULT_DAILY_NOTE),
    signalsDir: text_(fm.signals_dir, DEFAULT_SIGNALS_DIR),
    reviewDir: text_(fm.review_dir, ''),
    reviewerCommand: text_(fm.reviewer_command, '').replace(/^\//, ''),
    memoryFolderName: text_(fm.memory_folder_name, ''),
    skipDirs: list(fm.skip_dirs, ['.obsidian', '.git', '.trash', 'node_modules']),
    dailyFrontmatter: list((fm.daily_note_frontmatter ?? '').replace(/;/g, ','), []),
    // Every guard is off unless the vault owner turns it on: what is off limits is specific to one setup.
    guardAutoMemory: flag(fm.guard_auto_memory ?? fm.guard_retired_memory, false),
    guardPaths: list(fm.guard_paths, []),
    guardN8nDelete: flag(fm.guard_n8n_delete, false),
    checklist: checklist.length > 0 ? checklist : DEFAULT_CHECKLIST,
    pushPolicy,
    guardForcePush: flag(fm.guard_force_push, false),
  }
}

/** The project whose paths hold the cwd (longest match). Vault root is `vault`; nothing matched is `unmapped`. */
export function ownProject(cwd: string, projects: Project[], vaultRoot: string): string {
  if (norm(cwd) === norm(vaultRoot)) return 'vault'
  let best = ''
  let bestLen = -1
  for (const pr of projects) for (const p of pr.paths) {
    if (isUnder(cwd, p) && norm(p).length > bestLen) { best = pr.name; bestLen = norm(p).length }
  }
  if (best) return best
  return isUnder(cwd, vaultRoot) ? 'vault' : 'unmapped'
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9_.-])${escapeRe(w.toLowerCase())}($|[^a-z0-9_-])`, 'i')

/** Every project a piece of text points at, with the evidence for each tag. */
export function tagText(text: string, projects: Project[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const t = text.replace(/\\/g, '/').toLowerCase()
  const add = (name: string, ev: string) => {
    const list = out.get(name) ?? []
    if (!list.includes(ev)) list.push(ev)
    out.set(name, list)
  }
  // Paths: a path that is a prefix of a longer matched path loses (`C:/code/site/blog` beats `C:/code/site`).
  const hits: { name: string; path: string }[] = []
  for (const pr of projects) for (const p of pr.paths) {
    const np = norm(p)
    if (t.includes(np + '/') || t.endsWith(np) || t.includes(np + ' ') || t.includes(np + '"') || t.includes(np + "'")) {
      hits.push({ name: pr.name, path: p })
    }
  }
  const occ = (s: string) => t.split(s).length - 1
  for (const h of hits) {
    // Shadowed only when every occurrence of the short path is inside a longer, other project's path.
    const longer = hits.filter(o => o.name !== h.name && norm(o.path).startsWith(norm(h.path) + '/'))
    const inLonger = longer.reduce((n, o) => n + occ(norm(o.path)), 0)
    if (longer.length === 0 || occ(norm(h.path)) > inLonger) add(h.name, `path ${h.path}`)
  }
  for (const pr of projects) {
    for (const h of pr.hosts) if (wordRe(h).test(t)) add(pr.name, `host ${h}`)
    for (const k of pr.keywords) if (wordRe(k).test(t)) add(pr.name, `keyword "${k}"`)
  }
  return out
}

// ---------- guardrails (each one off unless the config note turns it on) ----------

/** How Claude Code names a folder under ~/.claude/projects/: `D:\My Vault` → `d--my-vault`. */
export const projectDirName = (dir: string) => dir.replace(/[\\/:\s]/g, '-').replace(/-+$/, '').toLowerCase()

export type GuardOptions = { vaultRoot: string; autoMemory: boolean; paths: string[]; n8n: boolean }

/** A write into Claude Code's per-project auto-memory, other than the vault's own folder. */
export function isAutoMemoryPath(path: string, vaultRoot: string): boolean {
  const m = /\/\.claude\/projects\/([^/]+)\/memory(\/|$)/.exec(norm(path))
  return m !== null && m[1] !== projectDirName(vaultRoot)
}

const guardedFragment = (text: string, paths: string[]) =>
  paths.find(f => f.trim() !== '' && text.includes(f.replace(/\\/g, '/').toLowerCase()))

const WRITE_VERB =
  /(\b(set-content|add-content|out-file|new-item|copy-item|move-item|remove-item|rename-item|rm|mv|cp|tee|del|erase|mkdir|touch|rmdir)\b|\bsed\s+-i)/i
/** Redirect targets (`> file`, `>> "file"`); `2>&1` and fd duplications are not targets. */
const REDIRECT = /(?:^|[^0-9&>])>{1,2}\s*(?!&)(["']?)([^"'\s|;&]+(?:\s[^"'\s|;&>]+)*?)\1(?=\s|$|[|;&])/g

const AUTO_MEMORY = /\/\.claude\/projects\/([^/\s'"]+)\/memory(\/|\b)/g

const AUTO_MEMORY_WHY = 'that writes into Claude Code\'s per-project auto-memory (~/.claude/projects/<x>/memory/). This vault keeps project memory in the vault itself; write it there.'
const guardPathWhy = (f: string) => `that writes under "${f}", which this vault's config marks off limits (guard_paths).`
export const N8N_WHY = 'n8n workflows are archive only here, never deleted. Archive the workflow instead (POST /api/v1/workflows/{id}/archive).'

/** Why a shell command must be refused, or null. */
export function commandDenyReason(cmd: string, g: GuardOptions): string | null {
  const c = cmd.replace(/\\/g, '/')
  if (g.n8n && /\/workflows?\b/i.test(c) &&
    /(-X\s*['"]?DELETE|--request\s+['"]?DELETE|-Method\s+['"]?Delete|method\s*[:=]\s*['"]DELETE)/i.test(c)) {
    return N8N_WHY
  }
  // A write verb anywhere puts the whole command in scope; a bare redirect only its target.
  const scope = WRITE_VERB.test(c) ? c.toLowerCase() : [...c.matchAll(REDIRECT)].map(m => m[2] ?? '').join(' ').toLowerCase()
  if (scope === '') return null
  if (g.autoMemory) {
    const own = projectDirName(g.vaultRoot)
    if ([...scope.matchAll(AUTO_MEMORY)].some(m => m[1] !== own)) return AUTO_MEMORY_WHY
  }
  const f = guardedFragment(scope, g.paths)
  return f ? guardPathWhy(f) : null
}

/** Why an Edit/Write to this path must be refused, or null. */
export function pathDenyReason(path: string, g: GuardOptions): string | null {
  if (g.autoMemory && isAutoMemoryPath(path, g.vaultRoot)) return AUTO_MEMORY_WHY
  const f = guardedFragment(norm(path), g.paths)
  return f ? guardPathWhy(f) : null
}

export const isN8nDeleteTool = (tool: string) => /n8n/i.test(tool) && /delete/i.test(tool)

// ---------- push guard ----------

export type GitPush = { dir: string | null; remote: string; branch: string | null; isForce: boolean }

const unquote = (t: string) => t.replace(/^["']|["']$/g, '')
const ARG = /"[^"]*"|'[^']*'|[^\s;&|]+/g

/**
 * The `git push` in a shell command, or null: its folder (`git -C x`, or a `cd x` / `Set-Location x` before it),
 * remote, branch (from a refspec) and whether it forces.
 */
export function parseGitPush(cmd: string): GitPush | null {
  const c = cmd.replace(/\r?\n/g, ' ')
  const m = /(?:^|[;&|]\s*|\bthen\s+)\s*git((?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+)|\s+-c\s+\S+)*)\s+push\b([^;&|]*)/i.exec(c)
  if (!m) return null
  const before = c.slice(0, m.index)
  const cds = [...before.matchAll(/\b(?:cd|set-location|push-location|sl|pushd)\s+(?:-path\s+|-literalpath\s+)?("[^"]*"|'[^']*'|[^\s;&|]+)/gi)]
  const gitC = /-C\s+("[^"]*"|'[^']*'|\S+)/.exec(m[1] ?? '')
  const dir = gitC?.[1] ? unquote(gitC[1]) : cds.length > 0 ? unquote(cds[cds.length - 1]?.[1] ?? '') : null
  const args = [...(m[2] ?? '').matchAll(ARG)].map(a => unquote(a[0]))
  const positional = args.filter(a => !a.startsWith('-'))
  const isForce = args.some(a => /^(-f|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d)$/.test(a)) ||
    positional.slice(1).some(r => r.startsWith('+') || r.startsWith(':'))
  const ref = positional[1] ? positional[1].replace(/^\+/, '') : null
  const branch = ref === null ? null : (ref.includes(':') ? ref.split(':').pop() ?? '' : ref).replace(/^refs\/heads\//, '') || null
  return { dir: dir || null, remote: positional[0] ?? 'origin', branch: branch === 'HEAD' ? null : branch, isForce }
}

/** `https://github.com/me/site.git` and `git@github.com:me/site.git` both become `github.com/me/site`. */
export const normRemote = (url: string) =>
  url.trim().toLowerCase().replace(/^git@([^:]+):/, '$1/').replace(/^[a-z+]+:\/\/([^@/]*@)?/, '').replace(/\.git$/, '').replace(/\/+$/, '')

/** The most specific rule for this repo and branch: an exact branch beats `*`. A repo is a remote suffix or a path prefix. */
export function matchPushRule(rules: PushRule[], remoteUrl: string, dir: string, branch: string): PushRule | null {
  const r = normRemote(remoteUrl)
  const isRepo = (rule: PushRule) => {
    const want = rule.repo.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')
    if (/^[a-z]:|^\//i.test(rule.repo)) return isUnder(dir, rule.repo)
    return r === want || r.endsWith('/' + want)
  }
  const hits = rules.filter(x => isRepo(x) && (x.branch === '*' || x.branch.toLowerCase() === branch.toLowerCase()))
  return hits.find(x => x.branch !== '*') ?? hits[0] ?? null
}

const APPROVE_PUSH =
  /\b(ship\s+it|push\s+it|push\s+(?:it\s+)?(?:now|away|live)|deploy\s+it|go\s+ahead\s+and\s+(?:push|deploy|ship)|(?:yes|ok|okay|yep)[,!.\s]+(?:push|deploy|ship)|approved?\s+(?:to\s+)?(?:push|deploy)|send\s+it)\b/i

/** Whether the owner's own prompt approves a held push. A force push also needs the word "force". */
export const approvesPush = (prompt: string, isForce: boolean) =>
  APPROVE_PUSH.test(prompt) && (!isForce || /\bforce\b/i.test(prompt))

// ---------- prompts ----------

const TRIVIAL =
  /^(y|yes|yep|yeah|no|nope|ok|okay|k|go|go on|go ahead|do it|continue|proceed|next|done|thanks|thank you|ty|great|nice|cool|lgtm|ship it|\d{1,3}|[a-e])[\s.!)]*$/i
export const isTrivial = (text: string) => TRIVIAL.test(text.trim())

const SECRET = [
  /\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs]|glpat)[-_][A-Za-z0-9_-]{8,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+)?/g,
  /discord(app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]
/** `password: hunter2` keeps its label: `password: [redacted]`. */
const LABELLED = /\b(password|passwd|passphrase|secret|token|api[ _-]?key)(\s*(?:\bis\b|:|=)\s*)\S{4,}/gi

export function redact(text: string): string {
  let t = text
  for (const re of SECRET) t = t.replace(re, '[redacted]')
  return t.replace(LABELLED, '$1$2[redacted]')
}

export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…')

// ---------- time ----------

export type Stamp = { date: string; time: string; monthFolder: string; dayTitle: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Local date/time in America/New_York (the vault's rule), whatever zone the host runs in. */
export function stampOf(epochMs: number, timeZone = 'America/New_York'): Stamp {
  let y: number, mo: number, d: number, hh: number, mm: number, wd: number
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(new Date(epochMs))
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
    y = Number(get('year')); mo = Number(get('month')); d = Number(get('day'))
    hh = Number(get('hour')) % 24; mm = Number(get('minute'))
    wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
    if (!y || !mo || !d || wd < 0) throw new Error('parts')
  } catch {
    const dt = new Date(epochMs)
    y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate(); hh = dt.getHours(); mm = dt.getMinutes(); wd = dt.getDay()
  }
  const p2 = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${y}-${p2(mo)}-${p2(d)}`,
    time: `${p2(hh)}:${p2(mm)}`,
    monthFolder: `${p2(mo)} - ${MONTHS[mo - 1]} ${y}`,
    dayTitle: `${DAYS[wd]}, ${MONTHS[mo - 1]} ${d}, ${y}`,
  }
}

// ---------- daily note ----------

export function dailyNotePath(vaultRoot: string, s: Stamp, pattern = DEFAULT_DAILY_NOTE): string {
  const [y = '', mo = '', d = ''] = s.date.split('-')
  const rel = pattern
    .replace(/\{YYYY\}/g, y).replace(/\{MM\}/g, mo).replace(/\{DD\}/g, d)
    .replace(/\{Month\}/g, MONTHS[Number(mo) - 1] ?? mo)
  return `${vaultRoot.replace(/[\\/]+$/, '')}/${rel.replace(/^[\\/]+/, '')}`
}

export function newDailyNote(s: Stamp, frontmatter: string[] = []): string {
  return [
    '---', ...frontmatter, `created: ${s.date}`, '---', '',
    `# ${s.dayTitle}`, '', '## Index', '', '---', '',
  ].join('\n')
}

export const blockStart = (id: string) => `<!-- vault-scribe:session:${id} -->`
export const blockEnd = (id: string) => `<!-- /vault-scribe:session:${id} -->`
export const indexTag = (id: string) => `<!-- vs:${id.slice(0, 8)} -->`

export const countSessions = (note: string) => (note.match(/^## Session \d+/gm) ?? []).length

const bullets = (items: string[]) => (items.length === 0 ? ['-'] : items.map(i => `- ${i}`))

export function renderBlock(a: Agg, vaultRoot: string, signalsLink: string | null, nowTime: string): string {
  const notes = a.notes.map(n => noteLink(n, vaultRoot)).filter((x): x is string => x !== null)
  const sig = a.signalIds.length === 0
    ? ['- none queued']
    : [`- ${a.signalIds.length} queued for review${signalsLink ? ` → ${signalsLink}` : ''}: ${a.signalIds.map(i => `\`${i}\``).join(', ')}`]
  return [
    blockStart(a.sessionId),
    `## Session ${a.sessionNo} (${a.startedAt}): ${a.topic || 'session'}`,
    `*auto-written by vault-scribe · session \`${a.sessionId.slice(0, 8)}\` · own project: ${a.own} · cwd \`${fwd(a.cwd)}\` · updated ${nowTime}*`,
    '',
    '### What Got Done', ...bullets([...a.done, ...(a.digest.length > 0 ? [`_${a.digest.length} recent turn(s) captured, summary on the next pass_`] : [])]), '',
    '### Decisions Made', ...bullets(a.decisions), '',
    '### Discussions & Open Questions', ...bullets(a.discussions ?? []), '',
    '### Research & Lookups', ...bullets(a.research ?? []), '',
    "### What's Still In Progress", ...bullets(a.inProgress), '',
    '### Notes Touched', ...bullets(notes), '',
    '### Signals for Review', ...sig,
    blockEnd(a.sessionId),
  ].join('\n')
}

/** Puts this session's block and Index bullet into the note, leaving every other byte alone. */
export function upsertSession(note: string, sessionId: string, block: string, indexLine: string): string {
  let text = note.replace(/\r\n/g, '\n')
  const tag = indexTag(sessionId)
  const bullet = `- ${indexLine} ${tag}`

  // Index bullet
  const lines = text.split('\n')
  const at = lines.findIndex(l => l.includes(tag))
  if (at >= 0) {
    lines[at] = bullet
  } else {
    let idx = lines.findIndex(l => /^## Index\s*$/.test(l))
    if (idx < 0) {
      const h1 = lines.findIndex(l => /^# /.test(l))
      lines.splice(h1 + 1, 0, '', '## Index', '')
      idx = h1 + 2
    }
    // Drop the template's placeholder bullet (and the double blank it leaves).
    const ph = lines.findIndex((l, i) => i > idx && /^- \*\*Session topic\*\* (—|:|-)/.test(l))
    if (ph >= 0) {
      lines.splice(ph, 1)
      if ((lines[ph - 1] ?? '').trim() === '' && (lines[ph] ?? '').trim() === '') lines.splice(ph, 1)
    }
    let end = idx + 1
    while (end < lines.length && !/^#{1,2} /.test(lines[end] ?? '') && (lines[end] ?? '').trim() !== '---') end++
    let lastBullet = -1
    for (let i = idx + 1; i < end; i++) if (/^\s*- /.test(lines[i] ?? '')) lastBullet = i
    if (lastBullet >= 0) {
      lines.splice(lastBullet + 1, 0, bullet)
    } else {
      let ins = end
      while (ins > idx + 1 && (lines[ins - 1] ?? '').trim() === '') ins--
      const add = [(lines[ins - 1] ?? '').trim() === '' ? null : '', bullet].filter((x): x is string => x !== null)
      if ((lines[ins] ?? '').trim() !== '') add.push('')
      lines.splice(ins, 0, ...add)
    }
  }
  text = lines.join('\n')

  // Session block
  const s = text.indexOf(blockStart(sessionId))
  const e = text.indexOf(blockEnd(sessionId))
  if (s >= 0 && e > s) {
    text = text.slice(0, s) + block + text.slice(e + blockEnd(sessionId).length)
  } else {
    text = text.replace(/\s*$/, '') + '\n\n' + block + '\n\n---\n'
  }
  return text
}

// ---------- signals ----------

export const signalsPath = (vaultRoot: string, date: string, dir = DEFAULT_SIGNALS_DIR) =>
  `${vaultRoot.replace(/[\\/]+$/, '')}/${dir.replace(/^[\\/]+|[\\/]+$/g, '')}/${date}.md`

export function newSignalsFile(date: string): string {
  return [
    '---', 'status: active', 'project: meta', 'type: log', `created: ${date}`, '---', '',
    `# vault-scribe signals: ${date}`, '',
    'Cross-project changes, decisions, corrections and discussions captured live by the vault-scribe mod, queued for review.',
    'The reviewer flips each heading from `⏳ pending` to `✅ processed <date>: ...`, `🔁 routed <date>: ...` or `✖ dropped <date>: ...` on the same line, so the edit is line-neutral.', '',
  ].join('\n')
}

export function renderSignal(s: Signal): string {
  return [
    `### ${s.id} · ${s.status}`,
    `- kind: ${s.kind}`,
    `- what: ${s.what}`,
    `- why: ${s.why || '-'}`,
    `- from: ${s.from}`,
    `- touches: ${s.touches.join('; ')}`,
    '',
  ].join('\n')
}

export function parseSignals(text: string): Signal[] {
  const out: Signal[] = []
  const blocks = text.replace(/\r\n/g, '\n').split(/^### /m).slice(1)
  for (const b of blocks) {
    const [head = '', ...rest] = b.split('\n')
    const hm = /^(SIG-\d{4}-\d{2}-\d{2}-([0-9a-z]{8})-\d+)\s*·\s*(.*)$/i.exec(head.trim())
    if (!hm || !hm[1] || !hm[2]) continue
    const field = (k: string) => rest.find(l => l.startsWith(`- ${k}:`))?.slice(k.length + 3).trim() ?? ''
    const touches = field('touches').split(';').map(x => x.trim()).filter(Boolean)
    out.push({
      id: hm[1], sessionId: hm[2], status: (hm[3] ?? '').trim(),
      kind: (field('kind') || 'change') as SignalKind,
      what: field('what'), why: field('why'), from: field('from'), touches,
    })
  }
  return out
}

/** The project name of a `touches` entry: `Website (path C:/code/site)` → `Website`. */
export const touchName = (t: string) => t.replace(/\s*\(.*$/, '').trim()

export const isPending = (s: Signal) => s.status.startsWith('⏳')

// ---------- summary ----------

export function digestText(turns: TurnRec[], maxChars = 14000): string {
  const parts: string[] = []
  turns.forEach((t, i) => {
    parts.push(`## Turn ${i + 1}`)
    if (t.prompt) parts.push(`USER: ${clip(t.prompt, 1500)}`)
    for (const a of t.actions.slice(0, 40)) parts.push(`ACTION: ${clip(a, a.startsWith('research report') ? 1200 : 300)}`)
    if (t.actions.length > 40) parts.push(`ACTION: …and ${t.actions.length - 40} more`)
    if (t.answer) parts.push(`ASSISTANT: ${clip(t.answer, 1500)}`)
  })
  const all = parts.join('\n')
  return all.length <= maxChars ? all : all.slice(all.length - maxChars)
}

export function summaryPrompt(digest: string, projects: Project[], own: string, owner = 'the user'): { system: string; prompt: string } {
  const list = projects.map(p => `- ${p.name}: memory ${p.memory}; paths ${p.paths.join(', ')}; hosts ${p.hosts.join(', ') || 'none'}; keywords ${p.keywords.join(', ')}`).join('\n')
  const system = [
    `You keep the work log for ${owner}'s Claude Code sessions, part of their second brain. You read a digest of recent turns and answer with ONE JSON object and nothing else.`,
    `In the digest, USER lines are ${owner}'s own words. ACTION lines are what the assistant did: edits with before/after, writes, shell commands, reads (lines starting "read"), web searches/fetches/pages opened, and research-agent reports. ASSISTANT lines are its answers.`,
    'Write past tense, terse, factual. Never invent: only what the digest shows. Never include secrets, passwords or tokens.',
    'Style: never use em-dashes (use a colon, comma or period instead) and write every file path with forward slashes.',
    'Fields:',
    '- topic: 2-6 words naming what this session is about',
    '- index_line: one line, "**Topic**: what happened/was decided" (past tense, under 160 chars)',
    '- done: up to 8 bullets of concrete changes completed in THESE turns. Each bullet names WHAT changed (file or system) and WHY, as "what (why: reason)". The why comes from the USER\'s words or the reason the assistant gave.',
    `- decisions: up to 4 bullets, ONLY decisions or rulings ${owner} made. Each MUST end with the exact words from a USER line that state or accept it, as (${owner}: "exact words"). A plan the assistant proposed that the USER has not clearly accepted is NOT a decision: put it under discussions.`,
    '- discussions: up to 5 bullets that could affect LATER choices, so they are not lost: options weighed, proposals still waiting on the USER, ideas rejected and why, trade-offs, contradictions found.',
    '- research: up to 6 bullets for reads and lookups that informed a choice: what was read or looked up (files, a whole project\'s notes, web searches, pages, agent reports), the key finding, and what it informed. Keep URLs as sources, e.g. "searched X: finding (source: https://...)". Skip trivial reads that informed nothing.',
    '- in_progress: up to 4 bullets still open at the end of these turns',
    '- signals: things another project\'s notes would need to know. Each {"kind":"change|decision|correction|fact|discussion","what":"...","why":"...","projects":["<exact project names from the list>"],"quote":"<for decision/correction: the exact USER words, else empty>"}. Use change/fact/discussion when it affects a project OTHER than the session\'s own, even indirectly (shared API, host, database, webhook, rule, convention, or research one project did that another project needs). Use decision/correction only with a USER quote. Empty list when nothing qualifies.',
    `The session's own project is: ${own}.`,
    'Projects:',
    list,
  ].join('\n')
  const prompt = `<digest>\n${digest}\n</digest>\nAnswer with the JSON object only.`
  return { system, prompt }
}

/** House style: no em-dashes, forward-slash paths. */
const tidy = (s: string) => s.replace(/\s*\u2014\s*/g, ': ').replace(/\\/g, '/')
const str = (v: unknown, n: number) => (typeof v === 'string' ? clip(tidy(redact(v.trim())), n) : '')
const strs = (v: unknown, max: number, n: number) =>
  Array.isArray(v) ? v.map(x => str(x, n)).filter(x => x !== '').slice(0, max) : []

export function parseSummary(text: string, projectNames: string[]): Summary | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null
  let o: Record<string, unknown>
  try { o = JSON.parse(json) as Record<string, unknown> } catch { return null }
  const names = new Map(projectNames.map(n => [n.toLowerCase(), n]))
  const kinds: SignalKind[] = ['change', 'decision', 'correction', 'fact', 'discussion']
  const signals = Array.isArray(o.signals) ? o.signals.flatMap(s => {
    if (typeof s !== 'object' || s === null) return []
    const r = s as Record<string, unknown>
    const kind = kinds.includes(r.kind as SignalKind) ? (r.kind as SignalKind) : 'change'
    const what = str(r.what, 300)
    if (what === '') return []
    const projects = Array.isArray(r.projects)
      ? [...new Set(r.projects.map(p => names.get(String(p).toLowerCase())).filter((x): x is string => x !== undefined))]
      : []
    return [{ kind, what, why: str(r.why, 300), projects, quote: str(r.quote, 300) }]
  }).slice(0, 8) : []
  return {
    topic: str(o.topic, 60),
    indexLine: str(o.index_line, 200),
    done: strs(o.done, 8, 300),
    decisions: strs(o.decisions, 4, 300),
    inProgress: strs(o.in_progress, 4, 240),
    discussions: strs(o.discussions, 5, 300),
    research: strs(o.research, 6, 360),
    signals,
  }
}

const dedupe = (xs: string[], max: number) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x) } }
  return out.slice(-max)
}

const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** True when one of the quoted strings in `text` really appears in what the owner typed. */
export function hasVerifiedQuote(text: string, ownerWords: string[]): boolean {
  const said = squash(ownerWords.join(' \n '))
  const quotes = [...text.matchAll(/["\u201c]([^"\u201d]{4,})["\u201d]/g)].map(m => squash(m[1] ?? ''))
  return quotes.some(q => q.length >= 4 && said.includes(q))
}

/**
 * A decision only counts when it quotes the owner. Unverifiable decisions become discussions, and an
 * unverifiable decision/correction signal becomes a discussion signal (2026-10-08: proposals were logged as rulings).
 */
export function checkQuotes(s: Summary, ownerWords: string[]): Summary {
  const kept: string[] = []
  const moved: string[] = []
  for (const d of s.decisions) (hasVerifiedQuote(d, ownerWords) ? kept : moved).push(d)
  return {
    ...s,
    decisions: kept,
    discussions: [...s.discussions, ...moved.map(m => `proposed, not confirmed: ${m}`)],
    signals: s.signals.map(x =>
      (x.kind === 'decision' || x.kind === 'correction') && !hasVerifiedQuote(`"${x.quote}"`, ownerWords)
        ? { ...x, kind: 'discussion' as const }
        : x),
  }
}

export function mergeSummary(a: Agg, s: Summary): Agg {
  return {
    ...a,
    topic: a.topic || s.topic,
    indexLine: s.indexLine || a.indexLine,
    done: dedupe([...a.done, ...s.done], 20),
    decisions: dedupe([...a.decisions, ...s.decisions], 12),
    discussions: dedupe([...(a.discussions ?? []), ...s.discussions], 15),
    research: dedupe([...(a.research ?? []), ...s.research], 20),
    inProgress: s.inProgress.length > 0 ? s.inProgress : a.inProgress,
  }
}

/** Signals worth queueing for review: anything touching another project, plus every decision/correction. */
export function shouldQueue(kind: SignalKind, projects: string[], own: string): boolean {
  if (kind === 'decision' || kind === 'correction') return true
  return projects.some(p => p !== own)
}

// ---------- citations ----------

export type Citation = { file: string; line: number; target: string; cited: number }

const CITE = /([^\s`'"()[\]|<>*]+\.md):(\d+)(?:-(\d+))?/g

/** Every `name.md:NNN` citation in a note. `target` is the cited path as written (lowercase, forward slashes, leading ./ and ../ dropped). */
export function extractCitations(file: string, text: string): Citation[] {
  const out: Citation[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(CITE)) {
      const target = norm(m[1] ?? '').replace(/^(\.\.?\/)+/, '')
      out.push({ file, line: i + 1, target, cited: Number(m[2]) })
    }
  })
  return out
}

const baseName = (p: string) => norm(p).split('/').pop() ?? ''
const dirName = (p: string) => norm(p).split('/').slice(0, -1).join('/')

/**
 * Does citation `c` point at `editedFile`? A cited path with a folder in it must match the
 * edited path's tail, folder by folder. A bare name means the citing note's own folder,
 * else the vault-wide file of that name, but only when `nameCounts` says it is unique.
 */
export function citesFile(c: Citation, editedFile: string, nameCounts?: Map<string, number>): boolean {
  const edited = norm(editedFile)
  if (c.target.includes('/')) return edited === c.target || edited.endsWith(`/${c.target}`)
  if (baseName(edited) !== c.target) return false
  return dirName(edited) === dirName(c.file) || nameCounts?.get(c.target) === 1
}

export function firstDiffLine(before: string, after: string): number {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i + 1
  return n + 1
}

export const lineCount = (t: string) => t.split(/\r?\n/).length

/** Lowercase basename → how many vault files carry it; feeds the bare-name fallback in `citesFile`. */
export function countNames(paths: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of paths) counts.set(baseName(p), (counts.get(baseName(p)) ?? 0) + 1)
  return counts
}

export function staleCitations(index: Citation[], editedFile: string, fromLine: number, delta: number, nameCounts?: Map<string, number>): Citation[] {
  if (delta === 0 || baseName(editedFile) === '') return []
  return index.filter(c => c.cited >= fromLine && norm(c.file) !== norm(editedFile) && citesFile(c, editedFile, nameCounts))
}
