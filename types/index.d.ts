export type HeadsUpItem = { id: string; what: string; from: string; kind: string }
export type HeadsUp = { project: string; items: HeadsUpItem[]; total: number }

declare module 'claude-code' {
  interface PluginState {
    'vault-scribe': { headsUp: HeadsUp | null; isDismissed: boolean }
  }
}
