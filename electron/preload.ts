import { contextBridge, ipcRenderer } from 'electron'

// 定义事件类型
interface ChatEventPayload {
  runId: string
  sessionKey: string
  seq: number
  state: 'delta' | 'final' | 'aborted' | 'error'
  message?: {
    role: string
    content: Array<{ type: string; text?: string }>
    timestamp?: number
    stopReason?: string
    usage?: { input: number; output: number; totalTokens: number }
  }
  errorMessage?: string
}

interface AgentEventPayload {
  runId: string
  seq: number
  stream: 'lifecycle' | 'tool' | 'assistant' | 'error'
  ts: number
  sessionKey?: string
  data: Record<string, unknown>
}

contextBridge.exposeInMainWorld('electronAPI', {
  // moltBOT 命令
  moltBOT: {
    health: () => ipcRenderer.invoke('moltBOT:health'),
    status: () => ipcRenderer.invoke('moltBOT:status'),
    cronList: () => ipcRenderer.invoke('moltBOT:cron-list'),
    cronAdd: (options: any) => ipcRenderer.invoke('moltBOT:cron-add', options),
    cronRm: (name: string) => ipcRenderer.invoke('moltBOT:cron-rm', name),
    cronRun: (name: string) => ipcRenderer.invoke('moltBOT:cron-run', name),
    cronToggle: (name: string, enabled: boolean) => ipcRenderer.invoke('moltBOT:cron-toggle', name, enabled),
    skillsCheck: () => ipcRenderer.invoke('moltBOT:skills-check'),
    memorySearch: (query: string) => ipcRenderer.invoke('moltBOT:memory-search', query),
    // ClawHub 技能市场
    clawhubExplore: (cursor?: string) => ipcRenderer.invoke('clawhub:explore', cursor),
    clawhubSearch: (query: string) => ipcRenderer.invoke('clawhub:search', query),
    clawhubInstall: (slug: string) => ipcRenderer.invoke('clawhub:install', slug),
    clawhubInstallStream: (slug: string) => ipcRenderer.invoke('clawhub:install-stream', slug),
    clawhubUpdate: (slug?: string) => ipcRenderer.invoke('clawhub:update', slug),
    clawhubList: () => ipcRenderer.invoke('clawhub:list'),
    // 依赖管理
    getDependencyInfo: (depName: string) => ipcRenderer.invoke('skills:get-dependency-info', depName),
    installDependency: (command: string) => ipcRenderer.invoke('skills:install-dependency', command),
    checkDependency: (depName: string) => ipcRenderer.invoke('skills:check-dependency', depName),
    // Smithery MCP 市场
    smitheryBrowse: (page?: number, pageSize?: number) => ipcRenderer.invoke('smithery:browse', page, pageSize),
    smitherySearch: (query: string, page?: number, pageSize?: number) => ipcRenderer.invoke('smithery:search', query, page, pageSize),
    smitheryDetail: (qualifiedName: string) => ipcRenderer.invoke('smithery:detail', qualifiedName),
    smitheryInstall: (qualifiedName: string) => ipcRenderer.invoke('smithery:install', qualifiedName),
    smitheryInstallStream: (qualifiedName: string) => ipcRenderer.invoke('smithery:install-stream', qualifiedName),
    channelsList: () => ipcRenderer.invoke('moltBOT:channels-list'),
    configGet: (key: string) => ipcRenderer.invoke('moltBOT:config-get', key),
    configSet: (key: string, value: string) => ipcRenderer.invoke('moltBOT:config-set', key, value),
    getConfig: () => ipcRenderer.invoke('moltBOT:get-config'),
    updateConfig: (updates: Record<string, unknown>) => ipcRenderer.invoke('moltBOT:update-config', updates),
    chat: (message: string, sessionId: string) => ipcRenderer.invoke('moltBOT:chat', message, sessionId),
    deploy: (targetPath: string) => ipcRenderer.invoke('moltBOT:deploy', targetPath),
    getVersion: () => ipcRenderer.invoke('moltBOT:get-version'),
    checkUpdate: () => ipcRenderer.invoke('moltBOT:check-update'),
    update: () => ipcRenderer.invoke('moltBOT:update'),
    // 工作目录管理
    getPath: () => ipcRenderer.invoke('moltBOT:get-path'),
    setPath: (newPath: string) => ipcRenderer.invoke('moltBOT:set-path', newPath),
    searchPaths: () => ipcRenderer.invoke('moltBOT:search-paths'),
    selectFolder: () => ipcRenderer.invoke('moltBOT:select-folder'),
    // CLI 路径管理
    getCliPath: () => ipcRenderer.invoke('moltBOT:get-cli-path'),
    setCliPath: (newPath: string) => ipcRenderer.invoke('moltBOT:set-cli-path', newPath),
    searchCliPaths: () => ipcRenderer.invoke('moltBOT:search-cli-paths'),
    selectCliFolder: () => ipcRenderer.invoke('moltBOT:select-cli-folder'),
  },
  
  // 通用命令执行
  runCommand: (cmd: string, args: string[] = []) => ipcRenderer.invoke('moltBOT:run-command', cmd, args),
  
  // Gateway 控制
  gateway: {
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    status: () => ipcRenderer.invoke('gateway:status'),
    details: () => ipcRenderer.invoke('gateway:details'),
    chat: (message: string) => ipcRenderer.invoke('gateway:chat', message),
    
    // WebSocket 实时通信 API
    wsConnect: () => ipcRenderer.invoke('gateway:ws-connect'),
    wsDisconnect: () => ipcRenderer.invoke('gateway:ws-disconnect'),
    wsStatus: () => ipcRenderer.invoke('gateway:ws-status'),
    wsChatSend: (params: { sessionKey: string; message: string; thinking?: string }) => 
      ipcRenderer.invoke('gateway:ws-chat-send', params),
    wsChatHistory: (sessionKey: string, limit?: number) => 
      ipcRenderer.invoke('gateway:ws-chat-history', sessionKey, limit),
    wsChatAbort: (sessionKey: string, runId?: string) => 
      ipcRenderer.invoke('gateway:ws-chat-abort', sessionKey, runId),
    // 获取所有会话列表 (Telegram/Discord 等渠道)
    wsSessions: () => ipcRenderer.invoke('gateway:ws-sessions'),
    
    // 事件监听 - 核心流式输出
    onChatEvent: (callback: (event: any, payload: ChatEventPayload) => void) => {
      ipcRenderer.on('gateway:chat-event', callback)
      return () => ipcRenderer.removeListener('gateway:chat-event', callback)
    },
    onAgentEvent: (callback: (event: any, payload: AgentEventPayload) => void) => {
      ipcRenderer.on('gateway:agent-event', callback)
      return () => ipcRenderer.removeListener('gateway:agent-event', callback)
    },
  },
  
  // 安装事件监听
  install: {
    onProgress: (callback: (event: any, payload: { type: string; slug?: string; name?: string; output: string }) => void) => {
      ipcRenderer.on('install:progress', callback)
      return () => ipcRenderer.removeListener('install:progress', callback)
    },
    onComplete: (callback: (event: any, payload: { type: string; slug?: string; name?: string; success: boolean; alreadyInstalled?: boolean; error?: string }) => void) => {
      ipcRenderer.on('install:complete', callback)
      return () => ipcRenderer.removeListener('install:complete', callback)
    },
  },
  
  // 通知
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  
  // API 模型管理
  api: {
    providers: () => ipcRenderer.invoke('api:providers'),
    listModels: (provider: string, apiKey: string) => ipcRenderer.invoke('api:list-models', provider, apiKey),
    validateKey: (provider: string, apiKey: string) => ipcRenderer.invoke('api:validate-key', provider, apiKey),
    benchmarkModel: (provider: string, apiKey: string, model: string) =>
      ipcRenderer.invoke('api:benchmark-model', provider, apiKey, model),
  },
  
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  
  // 系统监控
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    appUptime: () => ipcRenderer.invoke('app:uptime'),
    processMemory: () => ipcRenderer.invoke('system:process-memory'),
  },
  
  // 应用设置
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', key, value),
    save: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  },
  
  // 日志
  logs: {
    export: (logs: string[], filename?: string) => ipcRenderer.invoke('logs:export', logs, filename),
  },
  
  // 心跳管理
  heartbeat: {
    getStatus: () => ipcRenderer.invoke('heartbeat:status'),
    getConfig: () => ipcRenderer.invoke('heartbeat:get-config'),
    updateConfig: (updates: Record<string, unknown>) => ipcRenderer.invoke('heartbeat:update-config', updates),
    trigger: () => ipcRenderer.invoke('heartbeat:trigger'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('heartbeat:set-enabled', enabled),
    getChannels: () => ipcRenderer.invoke('heartbeat:get-channels'),
    getMd: () => ipcRenderer.invoke('heartbeat:get-md'),
    saveMd: (content: string) => ipcRenderer.invoke('heartbeat:save-md', content),
    deleteMd: () => ipcRenderer.invoke('heartbeat:delete-md'),
  },
  
  // Moltbook 自主 Agent
  Moltbook: {
    getConfig: () => ipcRenderer.invoke('Moltbook:get-config'),
    updateConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('Moltbook:update-config', config),
    getStatus: () => ipcRenderer.invoke('Moltbook:get-status'),
    getLogs: () => ipcRenderer.invoke('Moltbook:get-logs'),
    clearLogs: () => ipcRenderer.invoke('Moltbook:clear-logs'),
    getPosts: () => ipcRenderer.invoke('Moltbook:get-posts'),
    getInteractions: () => ipcRenderer.invoke('Moltbook:get-interactions'),
    clearAll: () => ipcRenderer.invoke('Moltbook:clear-all'),
    start: (config: Record<string, unknown>) => ipcRenderer.invoke('Moltbook:start', config),
    stop: () => ipcRenderer.invoke('Moltbook:stop'),
  },
  
  // 对话框
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  },
  
  // 浏览器扩展
  browserExtension: {
    getPath: () => ipcRenderer.invoke('browser-extension:get-path'),
    openFolder: () => ipcRenderer.invoke('browser-extension:open-folder'),
    openChromeExtensions: () => ipcRenderer.invoke('browser-extension:open-chrome-extensions'),
  },
  
  // 记忆管理
  memory: {
    getStats: () => ipcRenderer.invoke('memory:stats'),
    search: (query: string) => ipcRenderer.invoke('memory:search', query),
    clear: () => ipcRenderer.invoke('memory:clear'),
  },
})
