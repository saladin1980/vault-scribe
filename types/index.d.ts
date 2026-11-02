export type HeadsUpItem = { id: string; what: string; from: string; kind: string; date: string; project: string }
export type HeadsUp = { project: string; items: HeadsUpItem[]; total: number; byProject: { name: string; n: number }[] }

declare module 'claude-code' {
  interface PluginState {
    'vault-scribe': { headsUp: HeadsUp | null; isDismissed: boolean }
  }
}
