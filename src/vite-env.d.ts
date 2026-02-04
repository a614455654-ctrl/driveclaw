/// <reference types="vite/client" />

interface MemoryStats {
  exists: boolean
  totalSize: number
  dbPath: string
  lastModified: string | null
}

interface ElectronAPI {
  moltBOT: {
    health: () => Promise<string>
    status: () => Promise<string>
    cronList: () => Promise<string>
    cronAdd: (options: {
      name: string
      cron?: string
      every?: string
      message: string
      channel: string
    }) => Promise<string>
    cronRm: (name: string) => Promise<string>
    cronRun: (name: string) => Promise<string>
    cronToggle: (name: string, enabled: boolean) => Promise<string>
    skillsCheck: () => Promise<string>
    memorySearch: (query: string) => Promise<string>
    channelsList: () => Promise<string>
    configGet: (key: string) => Promise<string>
    configSet: (key: string, value: string) => Promise<string>
    chat: (message: string, channel: string) => Promise<string>
  }
  runCommand: (cmd: string, args?: string[]) => Promise<{ success: boolean; data?: string; error?: string }>
  gateway: {
    start: () => Promise<{ success: boolean; message: string }>
    stop: () => Promise<{ success: boolean; message: string }>
    status: () => Promise<{ running: boolean; output: string }>
    chat: (message: string) => Promise<{ success: boolean; data?: any; error?: string }>
  }
  notify: (title: string, body: string) => Promise<boolean>
  api: {
    providers: () => Promise<{ id: string; name: string }[]>
    listModels: (provider: string, apiKey: string) => Promise<{ success: boolean; models?: any[]; error?: string }>
    validateKey: (provider: string, apiKey: string) => Promise<{ valid: boolean; statusCode?: number; error?: string }>
  }
  window: {
    minimize: () => void
    maximize: () => void
    close: () => void
  }
  memory: {
    getStats: () => Promise<{ success: boolean; data?: MemoryStats; error?: string }>
    search: (query: string) => Promise<{ success: boolean; data?: string; error?: string }>
    clear: () => Promise<{ success: boolean; message?: string; backupPath?: string; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
