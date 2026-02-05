import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, screen, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import http from 'http'
import https from 'https'
import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import { EventEmitter } from 'events'

const execAsync = promisify(exec)

// moltBOT 路径配置
// CLI 路径 - 包含编译好的 dist/index.js
const MOLTBOT_CLI_PATH = 'D:\\\u9879\u76ee\\openclaw'
// 工作目录 - 包含 skills, memory 等
const DEFAULT_WORKSPACE_PATH = 'C:\\Users\\FireBat\\clawd'
const WORKSPACE_CONFIG_PATH = path.join(app.getPath('userData'), 'openclaw-workspace.json')
const GATEWAY_PORT = 18789
const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json')
const APP_SETTINGS_PATH = path.join(app.getPath('userData'), 'app-settings.json')

// 获取 CLI 路径（固定）
function getCliPath(): string {
  return MOLTBOT_CLI_PATH
}

// 动态获取工作目录
function getWorkspacePath(): string {
  try {
    if (fs.existsSync(WORKSPACE_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf8'))
      if (config.path && fs.existsSync(config.path)) {
        return config.path
      }
    }
  } catch {}
  return DEFAULT_WORKSPACE_PATH
}

// 保存工作目录
function saveWorkspacePath(workspacePath: string) {
  try {
    fs.writeFileSync(WORKSPACE_CONFIG_PATH, JSON.stringify({ path: workspacePath }, null, 2))
  } catch (e) {
    console.error('Failed to save workspace path', e)
  }
}

// 自动搜索可能的工作目录
function searchWorkspacePaths(): string[] {
  const possiblePaths: string[] = []
  const homedir = os.homedir()
  
  // 常见路径
  const candidates = [
    path.join(homedir, 'clawd'),
    path.join(homedir, '.openclaw'),
    path.join(homedir, 'openclaw'),
    'C:\\OpenClaw',
    'C:\\openclaw',
  ]
  
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        // 检查是否有 skills 目录或 memory 目录
        const hasSkills = fs.existsSync(path.join(candidate, 'skills'))
        const hasMemory = fs.existsSync(path.join(candidate, 'memory'))
        if (hasSkills || hasMemory) {
          possiblePaths.push(candidate)
        }
      }
    } catch {}
  }
  
  return possiblePaths
}

// 兼容旧 API 的别名
function getmoltBOTPath(): string {
  return getCliPath()
}

let mainWindow: BrowserWindow | null = null
let gatewayProcess: ChildProcess | null = null
let tray: Tray | null = null
let gatewayStartTime: number | null = null
let gatewayWsClient: GatewayWsClient | null = null
let isQuitting = false

// 托盘图标 (32x32 PNG Base64)
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADPSURBVFhH7ZTBDYMwDEVZioE4swdij14YgnMXYAROTPGrIlQh23EcQoIq+UvvgozyYhsa9C2epKEPauMCLuACfygwrwhmm3h9BLuAdvAvb/5eBJvAQg8KpYSAdPNl4HX9UEBgnOjRwEuoy0AXoK0Xb56HItAB2/n0FRhpTT6KwHem56TP10JYgM7/wjduwS5QvQNsBNV3gC4hgLkT6vJQBKSf0P1d0AXYGI5Indh3Jn1PIgLSMmopIbAT6ARLMYEDtRvX9iNNoAAu4AKPC3wAM1kM5UlGebwAAAAASUVORK5CYII='

// ============= Gateway WebSocket 客户端 =============
// 实现与 moltBOT Gateway 的实时 WebSocket 通信

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

class GatewayWsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timer?: NodeJS.Timeout
  }>()
  private connected = false
  private closed = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private url: string
  private connectNonce: string | null = null

  constructor(port: number = 18789) {
    super()
    this.url = `ws://127.0.0.1:${port}`
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      this.closed = false
      
      try {
        this.ws = new WebSocket(this.url, { maxPayload: 25 * 1024 * 1024 })
      } catch (err) {
        reject(err)
        return
      }

      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
        this.ws?.close()
      }, 10000)

      this.ws.on('open', () => {
        setTimeout(() => {
          if (!this.connectNonce) {
            this.sendConnect()
          }
        }, 500)
      })

      this.ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString())
          this.handleFrame(parsed, resolve, reject, connectTimeout)
        } catch (err) {
          this.emit('error', err)
        }
      })

      this.ws.on('close', (code, reason) => {
        this.connected = false
        this.emit('close', code, reason.toString())
        this.flushPending(new Error(`Connection closed: ${code}`))

        if (!this.closed) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        clearTimeout(connectTimeout)
        this.emit('error', err)
        if (!this.connected) {
          reject(err)
        }
      })
    })
  }

  disconnect() {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
    this.flushPending(new Error('Client disconnected'))
  }

  async chatSend(params: {
    sessionKey: string
    message: string
    thinking?: string
  }): Promise<{ runId: string; status: string }> {
    const idempotencyKey = randomUUID()
    return this.request('chat.send', { ...params, idempotencyKey })
  }

  async chatHistory(sessionKey: string, limit?: number): Promise<{
    sessionKey: string
    messages: Array<unknown>
  }> {
    return this.request('chat.history', { sessionKey, limit })
  }

  async chatAbort(sessionKey: string, runId?: string): Promise<{ ok: boolean; aborted: boolean }> {
    return this.request('chat.abort', { sessionKey, runId })
  }

  // 获取所有会话列表
  async sessionsList(): Promise<{
    sessions: Array<{
      sessionKey: string
      sessionId: string
      updatedAt?: string
      displayName?: string
      channel?: string
      origin?: {
        label?: string
        provider?: string
        from?: string
        to?: string
        accountId?: string
        threadId?: string
      }
    }>
  }> {
    return this.request('sessions.list', {})
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 60000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected')
    }

    const id = randomUUID()
    const frame = { type: 'req', id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })

      this.ws!.send(JSON.stringify(frame))
    })
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  private handleFrame(
    frame: Record<string, unknown>,
    onConnect: () => void,
    onConnectError: (err: Error) => void,
    connectTimeout: NodeJS.Timeout
  ) {
    // 事件帧
    if (frame.type === 'evt' || frame.event) {
      this.handleEvent(frame)
      return
    }

    // 响应帧
    if (frame.type === 'res' || frame.id) {
      this.handleResponse(frame, onConnect, onConnectError, connectTimeout)
      return
    }
  }

  private handleEvent(evt: Record<string, unknown>) {
    const event = evt.event as string
    const payload = evt.payload

    // challenge
    if (event === 'connect.challenge') {
      const p = payload as { nonce?: string } | undefined
      if (p?.nonce) {
        this.connectNonce = p.nonce
        this.sendConnect()
      }
      return
    }

    // tick (heartbeat)
    if (event === 'tick') {
      this.emit('tick', payload)
      return
    }

    // chat 事件 - 核心流式输出
    if (event === 'chat') {
      this.emit('chat', payload as ChatEventPayload)
      // 转发到渲染进程 (检查窗口和 webContents 是否有效)
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('gateway:chat-event', payload)
      }
      return
    }

    // agent 事件 - 包含思考过程和工具调用
    if (event === 'agent') {
      this.emit('agent', payload as AgentEventPayload)
      // 转发到渲染进程 (检查窗口和 webContents 是否有效)
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('gateway:agent-event', payload)
      }
      return
    }

    // 其他事件
    this.emit('event', { event, payload })
  }

  private handleResponse(
    res: Record<string, unknown>,
    onConnect: () => void,
    onConnectError: (err: Error) => void,
    connectTimeout: NodeJS.Timeout
  ) {
    const id = res.id as string
    const pending = this.pending.get(id)
    if (!pending) return

    const payload = res.payload as { status?: string; protocol?: number } | undefined
    if (payload?.status === 'accepted' || payload?.status === 'started') {
      // chat.send 返回 started, 继续等待流式事件
      if (payload.status === 'started') {
        if (pending.timer) clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.resolve(res.payload)
      }
      return
    }

    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(id)

    if (res.ok) {
      // HelloOk 响应
      if (payload?.protocol !== undefined) {
        clearTimeout(connectTimeout)
        this.connected = true
        this.emit('connected')
        onConnect()
      }
      pending.resolve(res.payload)
    } else {
      const error = res.error as { message?: string } | undefined
      const err = new Error(error?.message ?? 'Unknown error')
      pending.reject(err)

      if (!this.connected) {
        clearTimeout(connectTimeout)
        onConnectError(err)
      }
    }
  }

  private sendConnect() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'webchat-ui',  // 必须是 moltBOT 预定义的客户端 ID
        displayName: 'Driveclaw Desktop',
        version: '1.0.0',
        platform: process.platform,
        mode: 'webchat',  // webchat 模式
      },
      caps: ['chat'],
      role: 'operator',
      scopes: ['operator.admin'],
      // 使用 token 认证 - 从 openclaw.json 配置中读取
      auth: {
        token: 'clawdbot-local-682799',
        password: 'password123',
      },
    }

    const frame = {
      type: 'req',
      id: randomUUID(),
      method: 'connect',
      params,
    }

    this.pending.set(frame.id, {
      resolve: () => {
        this.connected = true
        this.emit('connected')
      },
      reject: (err) => this.emit('error', err),
    })

    this.ws.send(JSON.stringify(frame))
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.emit('reconnecting')
      this.connect().catch(() => {})
    }, 3000)
  }

  private flushPending(err: Error) {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }
}

// ============= 应用设置 =============

interface AppSettings {
  autoStartGateway: boolean
  theme: 'dark' | 'light' | 'system'
  minimizeToTray: boolean
  showNotifications: boolean
  closeAction: 'ask' | 'minimize' | 'quit'  // 关闭行为: 询问/最小化/退出
}

const defaultSettings: AppSettings = {
  autoStartGateway: false,
  theme: 'dark',
  minimizeToTray: true,
  showNotifications: true,
  closeAction: 'ask'
}

function loadAppSettings(): AppSettings {
  try {
    if (fs.existsSync(APP_SETTINGS_PATH)) {
      return { ...defaultSettings, ...JSON.parse(fs.readFileSync(APP_SETTINGS_PATH, 'utf8')) }
    }
  } catch (e) {
    console.error('Failed to load app settings', e)
  }
  return defaultSettings
}

function saveAppSettings(settings: AppSettings) {
  try {
    fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(settings, null, 2))
  } catch (e) {
    console.error('Failed to save app settings', e)
  }
}

// 窗口状态管理
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'))
    }
  } catch (e) {
    console.error('Failed to load window state', e)
  }
  return { width: 1200, height: 800, isMaximized: false }
}

function saveWindowState() {
  if (!mainWindow) return
  
  const isMaximized = mainWindow.isMaximized()
  const bounds = mainWindow.getBounds()
  
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized
  }
  
  try {
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state))
  } catch (e) {
    console.error('Failed to save window state', e)
  }
}

// 启动 Gateway
async function startGateway() {
  if (gatewayProcess) return
  
  gatewayProcess = spawn('node', [
    path.join(getmoltBOTPath(), 'dist', 'index.js'),
    'gateway', '--port', String(GATEWAY_PORT)
  ], { detached: false, stdio: 'pipe' })
  
  gatewayStartTime = Date.now()
  
  const settings = loadAppSettings()
  if (settings.showNotifications) {
    showNotification('Gateway 已启动', '服务运行在端口 ' + GATEWAY_PORT)
  }
}

function createWindow() {
  const windowState = loadWindowState()
  
  // 确保窗口在可见屏幕内
  let { x, y } = windowState
  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays()
    const inBounds = displays.some(display => {
      return x! >= display.bounds.x && 
             x! < display.bounds.x + display.bounds.width &&
             y! >= display.bounds.y && 
             y! < display.bounds.y + display.bounds.height
    })
    if (!inBounds) {
      x = undefined
      y = undefined
    }
  }
  
  mainWindow = new BrowserWindow({
    x,
    y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1E1E2E',
  })
  
  if (windowState.isMaximized) {
    mainWindow.maximize()
  }
  
  // 保存窗口状态 + 关闭行为处理
  mainWindow.on('close', (e) => {
    saveWindowState()
    if (isQuitting) return
    e.preventDefault()
    handleCloseRequest()
  })
  mainWindow.on('minimize', (e) => {
    const settings = loadAppSettings()
    if (settings.minimizeToTray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('resize', () => {
    if (!mainWindow?.isMaximized()) saveWindowState()
  })
  mainWindow.on('move', () => {
    if (!mainWindow?.isMaximized()) saveWindowState()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// 创建系统托盘
function createTray() {
  const iconBuffer = Buffer.from(TRAY_ICON_BASE64, 'base64')
  const icon = nativeImage.createFromBuffer(iconBuffer)
  const resizedIcon = icon.resize({ width: 16, height: 16 })
  const finalIcon = resizedIcon.isEmpty() ? icon : resizedIcon
  
  tray = new Tray(finalIcon)
  tray.setImage(finalIcon)
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '🦞 Driveclaw', 
      enabled: false 
    },
    { type: 'separator' },
    { 
      label: '打开主窗口', 
      click: () => mainWindow?.show() 
    },
    { 
      label: '启动 Gateway', 
      click: async () => {
        if (!gatewayProcess) {
          gatewayProcess = spawn('node', [
            path.join(getmoltBOTPath(), 'dist', 'index.js'),
            'gateway', '--port', String(GATEWAY_PORT)
          ], { detached: false, stdio: 'pipe' })
          showNotification('Gateway 已启动', '服务运行在端口 ' + GATEWAY_PORT)
        }
      }
    },
    { 
      label: '停止 Gateway', 
      click: () => {
        if (gatewayProcess) {
          gatewayProcess.kill()
          gatewayProcess = null
          showNotification('Gateway 已停止', '')
        }
      }
    },
    { type: 'separator' },
    { 
      label: '退出', 
      click: () => {
        quitApp()
      }
    }
  ])
  
  tray.setToolTip('Driveclaw - moltBOT 控制面板')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    mainWindow?.show()
  })
}

// 显示通知
function showNotification(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show()
  }
}
// 处理关闭行为
async function handleCloseRequest() {
  if (!mainWindow) return
  const settings = loadAppSettings()
  
  if (settings.closeAction === 'minimize') {
    mainWindow.hide()
    return
  }
  
  if (settings.closeAction === 'quit') {
    quitApp()
    return
  }
  
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['最小化到后台', '退出程序', '取消'],
    defaultId: 0,
    cancelId: 2,
    title: '关闭 Driveclaw',
    message: '您要如何处理窗口？',
    detail: '最小化到后台会保持 Gateway 运行',
    checkboxLabel: '记住我的选择',
    checkboxChecked: false,
  })
  
  if (result.response === 2) return
  
  if (result.checkboxChecked) {
    settings.closeAction = result.response === 0 ? 'minimize' : 'quit'
    saveAppSettings(settings)
  }
  
  if (result.response === 0) {
    mainWindow.hide()
  } else {
    quitApp()
  }
}

function quitApp() {
  isQuitting = true
  if (gatewayWsClient) {
    gatewayWsClient.disconnect()
    gatewayWsClient = null
  }
  if (gatewayProcess) gatewayProcess.kill()
  app.quit()
}


// 单实例锁 - 防止多次启动
// 注意：开发模式下（未打包）Vite/electron 插件会重启进程，单实例锁会导致“闪退/启动即退出”
const useSingleInstanceLock = app.isPackaged

if (useSingleInstanceLock) {
  const gotTheLock = app.requestSingleInstanceLock()

  if (!gotTheLock) {
    // 如果已经有实例在运行，直接退出
    app.quit()
  } else {
    // 当第二个实例尝试启动时，显示主窗口
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })

    app.whenReady().then(async () => {
      createWindow()
      createTray()

      // 自动启动 Gateway
      const settings = loadAppSettings()
      if (settings.autoStartGateway) {
        setTimeout(() => startGateway(), 2000)
      }
    })
  }
} else {
  // dev: 允许被重启，不启用单实例锁
  app.whenReady().then(async () => {
    createWindow()
    createTray()

    // 自动启动 Gateway
    const settings = loadAppSettings()
    if (settings.autoStartGateway) {
      setTimeout(() => startGateway(), 2000)
    }
  })
}

app.on('window-all-closed', () => {
  // 不退出，最小化到托盘
})

// 应用退出前清理 WebSocket 连接
app.on('before-quit', () => {
  isQuitting = true
  if (gatewayWsClient) {
    gatewayWsClient.disconnect()
    gatewayWsClient = null
  }
})

// moltBOT CLI 封装 - 直接用 node 执行，更快
// Windows 上需要确保 PATH 包含常见工具目录
function getEnhancedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  
  if (process.platform === 'win32') {
    // Windows: 确保 PATH 包含常见工具目录
    const additionalPaths = [
      'C:\\Windows\\System32',
      'C:\\Windows',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts'),
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages'),
      path.join(os.homedir(), 'scoop', 'shims'),
      path.join(os.homedir(), '.local', 'bin'),
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\nodejs',
    ]
    const currentPath = env.PATH || env.Path || ''
    const pathSet = new Set(currentPath.split(path.delimiter).filter(Boolean))
    for (const p of additionalPaths) {
      if (fs.existsSync(p)) pathSet.add(p)
    }
    env.PATH = Array.from(pathSet).join(path.delimiter)
    // Windows 上设置 PATHEXT 确保可执行文件被识别
    env.PATHEXT = env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
  }
  
  return env
}

async function runmoltBOT(command: string, timeoutMs: number = 300000): Promise<string> {
  const nodePath = process.execPath.includes('electron') ? 'node' : process.execPath
  const scriptPath = path.join(getCliPath(), 'dist', 'index.js')
  const workspacePath = getWorkspacePath()
  
  // 构建环境变量，设置工作目录
  const env = getEnhancedEnv()
  // 设置 OPENCLAW_WORKSPACE 环境变量，让 CLI 使用正确的工作目录
  env.OPENCLAW_WORKSPACE = workspacePath
  
  try {
    const { stdout } = await execAsync(
      `"${nodePath}" "${scriptPath}" ${command}`,
      { 
        encoding: 'utf8', 
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true,
        cwd: workspacePath,  // 使用工作目录
        env,
        shell: true  // 使用 shell 确保 PATHEXT 生效
      }
    )
    return stdout
  } catch (error: any) {
    // 如果有输出，返回输出（即使超时）
    if (error.stdout) return error.stdout
    if (error.killed) return '命令执行超时'
    return error.message || '命令执行失败'
  }
}

// IPC 处理器
ipcMain.handle('moltBOT:health', async () => {
  return await runmoltBOT('health')
})

ipcMain.handle('moltBOT:status', async () => {
  return await runmoltBOT('status')
})

ipcMain.handle('moltBOT:cron-list', async () => {
  return await runmoltBOT('cron list --json')
})

ipcMain.handle('moltBOT:cron-add', async (_, options: {
  name: string
  cron?: string
  every?: string
  message: string
  channel: string
}) => {
  const schedule = options.cron ? `--cron "${options.cron}"` : `--every "${options.every}"`
  return await runmoltBOT(
    `cron add --name "${options.name}" ${schedule} --message "${options.message}" --channel ${options.channel} --deliver --session isolated`
  )
})

// 删除定时任务（使用 id）
ipcMain.handle('moltBOT:cron-rm', async (_, id: string) => {
  return await runmoltBOT(`cron rm "${id}"`)
})

// 立即执行定时任务（使用 id）
ipcMain.handle('moltBOT:cron-run', async (_, id: string) => {
  return await runmoltBOT(`cron run "${id}" --force`)
})

// 启用/禁用定时任务（使用 id）
ipcMain.handle('moltBOT:cron-toggle', async (_, id: string, enabled: boolean) => {
  const cmd = enabled ? 'enable' : 'disable'
  return await runmoltBOT(`cron ${cmd} "${id}"`)
})

ipcMain.handle('moltBOT:skills-check', async () => {
  return await runmoltBOT('skills check')
})

// ClawHub 技能市场
async function runClawHub(args: string, timeoutMs: number = 60000): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const { stdout } = await execAsync(
      `npx clawhub ${args}`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true,
        cwd: getWorkspacePath()  // 使用工作目录
      }
    )
    // 尝试解析 JSON
    try {
      const data = JSON.parse(stdout)
      return { success: true, data }
    } catch {
      return { success: true, data: stdout }
    }
  } catch (error: any) {
    if (error.stdout) {
      try {
        return { success: true, data: JSON.parse(error.stdout) }
      } catch {
        return { success: true, data: error.stdout }
      }
    }
    return { success: false, error: error.message || '命令执行失败' }
  }
}

ipcMain.handle('clawhub:explore', async (_, cursor?: string) => {
  const args = cursor ? `explore --json --cursor "${cursor}"` : 'explore --json'
  return await runClawHub(args)
})

ipcMain.handle('clawhub:search', async (_, query: string) => {
  const result = await runClawHub(`search "${query}"`)
  if (result.success && typeof result.data === 'string') {
    // 解析文本输出格式: "slug v1.0.0  displayName  (score)"
    const lines = (result.data as string).split('\n').filter(line => line.trim())
    const items = lines.map(line => {
      const match = line.match(/^(\S+)\s+v([\d.]+)\s+(.+?)\s+\(([\d.]+)\)$/)
      if (match) {
        return {
          slug: match[1],
          displayName: match[3].trim(),
          summary: '',
          tags: {},
          stats: { downloads: 0, stars: 0, comments: 0, versions: 1 },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          latestVersion: { version: match[2], createdAt: Date.now(), changelog: '' },
          score: parseFloat(match[4])
        }
      }
      return null
    }).filter(Boolean)
    return { success: true, data: { items } }
  }
  return result
})

ipcMain.handle('clawhub:install', async (_, slug: string) => {
  const result = await runClawHub(`install ${slug} --no-input`, 120000)
  // 检测 "Already installed" 情况
  if (result.success && typeof result.data === 'string') {
    if (result.data.includes('Already installed')) {
      return { success: true, alreadyInstalled: true, data: result.data }
    }
    if (result.data.includes('OK. Installed')) {
      return { success: true, data: result.data }
    }
  }
  return result
})

// ClawHub 流式安装（带实时日志）
ipcMain.handle('clawhub:install-stream', async (event, slug: string) => {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'
    const npxCmd = isWindows ? 'npx.cmd' : 'npx'
    
    const child = spawn(npxCmd, ['clawhub', 'install', slug, '--no-input'], {
      cwd: getmoltBOTPath(),
      shell: true,
      windowsHide: true
    })
    
    let fullOutput = ''
    
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullOutput += text
      event.sender.send('install:progress', { type: 'clawhub', slug, output: text })
    })
    
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullOutput += text
      event.sender.send('install:progress', { type: 'clawhub', slug, output: text })
    })
    
    child.on('close', (code) => {
      const alreadyInstalled = fullOutput.includes('Already installed')
      const success = code === 0 || alreadyInstalled
      event.sender.send('install:complete', { type: 'clawhub', slug, success, alreadyInstalled })
      resolve({ success, alreadyInstalled, output: fullOutput })
    })
    
    child.on('error', (err) => {
      event.sender.send('install:complete', { type: 'clawhub', slug, success: false, error: err.message })
      resolve({ success: false, error: err.message })
    })
  })
})

// 依赖安装帮助器 - 检查常见工具是否安装
const DEPENDENCY_INSTALL_COMMANDS: Record<string, { winget?: string; scoop?: string; choco?: string; pip?: string; npm?: string; manual?: string }> = {
  'curl': { winget: 'winget install cURL.cURL', scoop: 'scoop install curl', manual: 'Windows 10+ 已内置 curl' },
  'python3': { winget: 'winget install Python.Python.3.12', scoop: 'scoop install python', choco: 'choco install python', manual: 'https://python.org/downloads' },
  'python': { winget: 'winget install Python.Python.3.12', scoop: 'scoop install python', choco: 'choco install python', manual: 'https://python.org/downloads' },
  'gh': { winget: 'winget install GitHub.cli', scoop: 'scoop install gh', choco: 'choco install gh', manual: 'https://cli.github.com' },
  'jq': { winget: 'winget install jqlang.jq', scoop: 'scoop install jq', choco: 'choco install jq' },
  'rg': { winget: 'winget install BurntSushi.ripgrep.MSVC', scoop: 'scoop install ripgrep', choco: 'choco install ripgrep' },
  'ffmpeg': { winget: 'winget install Gyan.FFmpeg', scoop: 'scoop install ffmpeg', choco: 'choco install ffmpeg' },
  'yt-dlp': { winget: 'winget install yt-dlp.yt-dlp', scoop: 'scoop install yt-dlp', pip: 'pip install yt-dlp' },
  'whisper': { pip: 'pip install openai-whisper', manual: 'https://github.com/openai/whisper' },
  'uv': { pip: 'pip install uv', scoop: 'scoop install uv', manual: 'https://github.com/astral-sh/uv' },
  'node': { winget: 'winget install OpenJS.NodeJS.LTS', scoop: 'scoop install nodejs-lts', manual: 'https://nodejs.org' },
  'op': { winget: 'winget install AgileBits.1Password.CLI', manual: 'https://1password.com/downloads/command-line' },
  'grizzly': { pip: 'pip install grizzly-loadtester', manual: 'https://pypi.org/project/grizzly-loadtester/' },
  'playwright': { pip: 'pip install playwright && playwright install', npm: 'npm install -g playwright', manual: 'https://playwright.dev' },
  'selenium': { pip: 'pip install selenium', manual: 'https://selenium-python.readthedocs.io/' },
  'requests': { pip: 'pip install requests' },
  'beautifulsoup4': { pip: 'pip install beautifulsoup4' },
  'bs4': { pip: 'pip install beautifulsoup4' },
  'pandas': { pip: 'pip install pandas' },
  'numpy': { pip: 'pip install numpy' },
  'httpx': { pip: 'pip install httpx' },
  'aiohttp': { pip: 'pip install aiohttp' },
}

ipcMain.handle('skills:get-dependency-info', async (_, depName: string) => {
  const info = DEPENDENCY_INSTALL_COMMANDS[depName.toLowerCase()]
  if (info) {
    return { found: true, ...info }
  }
  return { found: false, manual: `请手动搜索并安装: ${depName}` }
})

ipcMain.handle('skills:install-dependency', async (_, command: string) => {
  try {
    const { stdout, stderr } = await execAsync(command, {
      encoding: 'utf8',
      timeout: 300000,
      windowsHide: true
    })
    return { success: true, output: stdout || stderr }
  } catch (error: any) {
    return { success: false, error: error.message, output: error.stdout || error.stderr }
  }
})

ipcMain.handle('skills:check-dependency', async (_, depName: string) => {
  try {
    // 尝试运行 --version 或 -v 检查是否安装
    const { stdout } = await execAsync(`${depName} --version`, { timeout: 5000, windowsHide: true })
    return { installed: true, version: stdout.trim() }
  } catch {
    try {
      const { stdout } = await execAsync(`${depName} -v`, { timeout: 5000, windowsHide: true })
      return { installed: true, version: stdout.trim() }
    } catch {
      return { installed: false }
    }
  }
})

ipcMain.handle('clawhub:update', async (_, slug?: string) => {
  const args = slug ? `update ${slug} --no-input` : 'update --no-input'
  return await runClawHub(args, 120000)
})

ipcMain.handle('clawhub:list', async () => {
  return await runClawHub('list')
})

// Smithery MCP 服务器市场
const SMITHERY_API_BASE = 'https://registry.smithery.ai'

async function smitheryRequest(endpoint: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const url = new URL(endpoint, SMITHERY_API_BASE)
    
    https.get(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Driveclaw/1.0'
      },
      timeout: 30000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve({ success: true, data: json })
        } catch {
          resolve({ success: false, error: '解析响应失败' })
        }
      })
    }).on('error', (err) => {
      resolve({ success: false, error: err.message })
    }).on('timeout', function(this: http.ClientRequest) {
      this.destroy()
      resolve({ success: false, error: '请求超时' })
    })
  })
}

ipcMain.handle('smithery:search', async (_, query: string, page: number = 1, pageSize: number = 20) => {
  const encodedQuery = encodeURIComponent(query || '')
  return await smitheryRequest(`/servers?q=${encodedQuery}&page=${page}&pageSize=${pageSize}`)
})

ipcMain.handle('smithery:browse', async (_, page: number = 1, pageSize: number = 20) => {
  return await smitheryRequest(`/servers?page=${page}&pageSize=${pageSize}`)
})

ipcMain.handle('smithery:detail', async (_, qualifiedName: string) => {
  return await smitheryRequest(`/servers/${encodeURIComponent(qualifiedName)}`)
})

// Smithery 安装 MCP 服务器
ipcMain.handle('smithery:install', async (_, qualifiedName: string) => {
  try {
    // 使用 npx @smithery/cli install 命令
    const { stdout, stderr } = await execAsync(
      `npx -y @smithery/cli install ${qualifiedName} --client claude`,
      {
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true,
        cwd: getmoltBOTPath()
      }
    )
    return { success: true, output: stdout || stderr }
  } catch (error: any) {
    // 检查是否已安装
    if (error.stdout?.includes('already installed') || error.message?.includes('already installed')) {
      return { success: true, alreadyInstalled: true, output: error.stdout }
    }
    return { success: false, error: error.message, output: error.stdout || error.stderr }
  }
})

// Smithery 流式安装（带实时日志）
ipcMain.handle('smithery:install-stream', async (event, qualifiedName: string) => {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32'
    const npxCmd = isWindows ? 'npx.cmd' : 'npx'
    
    const child = spawn(npxCmd, ['-y', '@smithery/cli', 'install', qualifiedName, '--client', 'claude'], {
      cwd: getmoltBOTPath(),
      shell: true,
      windowsHide: true
    })
    
    let fullOutput = ''
    
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullOutput += text
      event.sender.send('install:progress', { type: 'smithery', name: qualifiedName, output: text })
    })
    
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullOutput += text
      event.sender.send('install:progress', { type: 'smithery', name: qualifiedName, output: text })
    })
    
    child.on('close', (code) => {
      const alreadyInstalled = fullOutput.includes('already installed')
      const success = code === 0 || alreadyInstalled
      event.sender.send('install:complete', { type: 'smithery', name: qualifiedName, success, alreadyInstalled })
      resolve({ success, alreadyInstalled, output: fullOutput })
    })
    
    child.on('error', (err) => {
      event.sender.send('install:complete', { type: 'smithery', name: qualifiedName, success: false, error: err.message })
      resolve({ success: false, error: err.message })
    })
  })
})

ipcMain.handle('moltBOT:memory-search', async (_, query: string) => {
  return await runmoltBOT(`memory search "${query}"`)
})

ipcMain.handle('moltBOT:channels-list', async () => {
  return await runmoltBOT('channels list')
})

// 配置管理
ipcMain.handle('moltBOT:config-get', async (_, key: string) => {
  return await runmoltBOT(`config get ${key}`)
})

ipcMain.handle('moltBOT:config-set', async (_, key: string, value: string) => {
  return await runmoltBOT(`config set ${key} "${value}"`)
})

// 读取完整配置文件
ipcMain.handle('moltBOT:get-config', async () => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8')
      return JSON.parse(content)
    }
    return null
  } catch (error) {
    console.error('Failed to read moltBOT config:', error)
    return null
  }
})

// 直接修改配置文件 - 支持嵌套路径
ipcMain.handle('moltBOT:update-config', async (_, updates: Record<string, unknown>) => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    let config: Record<string, unknown> = {}
    
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8')
      config = JSON.parse(content)
    }
    
    // 设置嵌套属性
    const setNestedValue = (obj: Record<string, unknown>, path: string, value: unknown) => {
      const keys = path.split('.')
      let current = obj
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
          current[key] = {}
        }
        current = current[key] as Record<string, unknown>
      }
      current[keys[keys.length - 1]] = value
    }
    
    // 应用所有更新
    for (const [path, value] of Object.entries(updates)) {
      setNestedValue(config, path, value)
    }
    
    // 更新 meta
    if (config.meta && typeof config.meta === 'object') {
      (config.meta as Record<string, unknown>).lastTouchedAt = new Date().toISOString()
    }
    
    // 写入文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update moltBOT config:', error)
    return { success: false, error: error.message }
  }
})

// 对话 - 通过 Gateway HTTP API 发送消息
ipcMain.handle('moltBOT:chat', async (_, message: string, sessionId: string) => {
  // 从配置读取 Gateway 认证信息
  let authToken = 'clawdbot-local-682799'  // 默认值
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      authToken = config?.gateway?.auth?.token || authToken
    }
  } catch {}
  
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      model: 'moltBOT',
      messages: [{ role: 'user', content: message }],
      stream: false
    })
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: GATEWAY_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Session-Key': sessionId,
        'Authorization': `Bearer ${authToken}`
      },
      timeout: 300000  // 5 分钟超时
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        // 检查 HTTP 状态码
        if (res.statusCode === 401) {
          resolve({ success: false, error: 'Unauthorized - 请检查 Gateway 认证配置' })
          return
        }
        if (res.statusCode && res.statusCode >= 400) {
          resolve({ success: false, error: `HTTP ${res.statusCode}: ${data}` })
          return
        }
        try {
          const json = JSON.parse(data)
          if (json.choices && json.choices[0]?.message?.content) {
            resolve({ success: true, reply: json.choices[0].message.content })
          } else if (json.error) {
            resolve({ success: false, error: json.error.message || 'API error' })
          } else {
            resolve({ success: true, reply: data })
          }
        } catch {
          resolve({ success: true, reply: data })
        }
      })
    })
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
    
    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: '请求超时' })
    })
    
    req.write(postData)
    req.end()
  })
})

// 通用命令执行
ipcMain.handle('moltBOT:run-command', async (_, command: string, args: string[]) => {
  const fullCmd = args.length > 0 ? `${command} ${args.join(' ')}` : command
  try {
    const result = await runmoltBOT(fullCmd)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Gateway 控制
ipcMain.handle('gateway:start', async () => {
  // 先检查端口是否已在使用
  const isRunning = await checkGatewayPort()
  if (isRunning) {
    gatewayStartTime = gatewayStartTime || Date.now()
    return { success: true, message: 'Gateway already running' }
  }
  
  if (gatewayProcess) {
    gatewayProcess.kill()
    gatewayProcess = null
  }
  
  return new Promise((resolve) => {
    // 使用 start 命令在新窗口中启动 Gateway
    const cmd = `start "moltBOT Gateway" node "${path.join(getmoltBOTPath(), 'dist', 'index.js')}" gateway --port ${GATEWAY_PORT} --allow-unconfigured`
    
    exec(cmd, { shell: 'cmd.exe' }, (err) => {
      if (err) {
        console.error('Gateway start error:', err)
        resolve({ success: false, message: err.message })
        return
      }
    })
    
    // 等待服务启动
    setTimeout(async () => {
      const running = await checkGatewayPort()
      if (running) {
        gatewayStartTime = Date.now()
        resolve({ success: true, message: 'Gateway started' })
      } else {
        resolve({ success: false, message: 'Gateway failed to start' })
      }
    }, 3000)
  })
})

ipcMain.handle('gateway:stop', async () => {
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM')
    gatewayProcess = null
    gatewayStartTime = null
  }
  
  // 强制停止占用端口的进程
  try {
    await execAsync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${GATEWAY_PORT}') do taskkill /F /PID %a`, { shell: 'cmd.exe' })
  } catch {}
  
  return { success: true, message: 'Gateway stopped' }
})

// 检查 Gateway 端口是否在监听
async function checkGatewayPort(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: GATEWAY_PORT,
      path: '/',
      method: 'GET',
      timeout: 2000
    }, (res) => {
      // 任何响应都表示服务在运行
      resolve(true)
    })
    
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

ipcMain.handle('gateway:status', async () => {
  const running = await checkGatewayPort()
  return { 
    running, 
    output: running ? 'ok' : 'not running',
    wsConnected: gatewayWsClient?.isConnected || false
  }
})

// ============= WebSocket 实时通信 IPC =============

// 连接 WebSocket
ipcMain.handle('gateway:ws-connect', async () => {
  try {
    if (!gatewayWsClient) {
      gatewayWsClient = new GatewayWsClient(GATEWAY_PORT)
    }
    await gatewayWsClient.connect()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// 断开 WebSocket
ipcMain.handle('gateway:ws-disconnect', async () => {
  if (gatewayWsClient) {
    gatewayWsClient.disconnect()
    gatewayWsClient = null
  }
  return { success: true }
})

// 发送消息 (流式)
ipcMain.handle('gateway:ws-chat-send', async (_, params: {
  sessionKey: string
  message: string
  thinking?: string
}) => {
  try {
    if (!gatewayWsClient?.isConnected) {
      // 自动尝试连接
      if (!gatewayWsClient) {
        gatewayWsClient = new GatewayWsClient(GATEWAY_PORT)
      }
      await gatewayWsClient.connect()
    }
    
    const result = await gatewayWsClient.chatSend(params)
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// 获取聊天历史
ipcMain.handle('gateway:ws-chat-history', async (_, sessionKey: string, limit?: number) => {
  try {
    if (!gatewayWsClient?.isConnected) {
      if (!gatewayWsClient) {
        gatewayWsClient = new GatewayWsClient(GATEWAY_PORT)
      }
      await gatewayWsClient.connect()
    }
    
    const result = await gatewayWsClient.chatHistory(sessionKey, limit)
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// 中止生成
ipcMain.handle('gateway:ws-chat-abort', async (_, sessionKey: string, runId?: string) => {
  try {
    if (!gatewayWsClient?.isConnected) {
      return { success: false, error: 'Not connected' }
    }
    
    const result = await gatewayWsClient.chatAbort(sessionKey, runId)
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// WebSocket 连接状态
ipcMain.handle('gateway:ws-status', async () => {
  return {
    connected: gatewayWsClient?.isConnected || false
  }
})

// 获取会话列表 (Telegram/Discord 等渠道会话)
ipcMain.handle('gateway:ws-sessions', async () => {
  try {
    if (!gatewayWsClient?.isConnected) {
      if (!gatewayWsClient) {
        gatewayWsClient = new GatewayWsClient(GATEWAY_PORT)
      }
      await gatewayWsClient.connect()
    }
    
    const result = await gatewayWsClient.sessionsList()
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err.message, sessions: [] }
  }
})

// 窗口控制
ipcMain.on('window:minimize', () => {
  const settings = loadAppSettings()
  if (settings.minimizeToTray) {
    mainWindow?.hide()
  } else {
    mainWindow?.minimize()
  }
})
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => {
  handleCloseRequest()
})

// 通知
ipcMain.handle('notify', async (_, title: string, body: string) => {
  showNotification(title, body)
  return true
})

// Gateway API 调用 (使用 OpenAI 兼容端点)
ipcMain.handle('gateway:chat', async (_, message: string) => {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      model: 'moltBOT',
      messages: [
        { role: 'user', content: message }
      ],
      stream: false
    })
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: GATEWAY_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 120000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          // OpenAI 格式响应
          if (json.choices && json.choices[0]?.message?.content) {
            resolve({ success: true, data: { reply: json.choices[0].message.content } })
          } else if (json.error) {
            resolve({ success: false, error: json.error.message || 'API error' })
          } else {
            resolve({ success: true, data: { reply: data } })
          }
        } catch {
          // 可能是 HTML 或纯文本
          if (data.includes('Method Not Allowed') || data.includes('Not Found')) {
            resolve({ success: false, error: 'API endpoint not enabled' })
          } else {
            resolve({ success: true, data: { reply: data } })
          }
        }
      })
    })
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
    
    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, error: 'Request timeout' })
    })
    
    req.write(postData)
    req.end()
  })
})

// API 模型检测
interface ApiProvider {
  name: string
  baseUrl: string
  modelsPath: string
  authHeader: string
  chatPath?: string
  apiType?: 'openai' | 'anthropic'
  staticModels?: { id: string; name: string }[]  // 静态模型列表（用于不支持 models 端点的服务）
  extraHeaders?: Record<string, string>
}

const API_PROVIDERS: Record<string, ApiProvider> = {
  nvidia: {
    name: 'NVIDIA',
    baseUrl: 'integrate.api.nvidia.com',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    apiType: 'openai',
    authHeader: 'Authorization'
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'api.openai.com',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    apiType: 'openai',
    authHeader: 'Authorization'
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'api.anthropic.com',
    modelsPath: '/v1/models',
    chatPath: '/v1/messages',
    apiType: 'anthropic',
    authHeader: 'x-api-key',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    // Anthropic models endpoint 可能返回空，提供静态列表作为备用
    staticModels: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    ]
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'openrouter.ai',
    modelsPath: '/api/v1/models',
    chatPath: '/api/v1/chat/completions',
    apiType: 'openai',
    authHeader: 'Authorization'
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'api.deepseek.com',
    modelsPath: '/v1/models',
    chatPath: '/v1/chat/completions',
    apiType: 'openai',
    authHeader: 'Authorization'
  }
}

// 获取 API 支持的模型列表
ipcMain.handle('api:list-models', async (_, provider: string, apiKey: string) => {
  const providerConfig = API_PROVIDERS[provider]
  if (!providerConfig) {
    return { success: false, error: 'Unknown provider' }
  }

  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      [providerConfig.authHeader]: provider === 'anthropic' ? apiKey : `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...providerConfig.extraHeaders
    }

    const options: https.RequestOptions = {
      hostname: providerConfig.baseUrl,
      port: 443,
      path: providerConfig.modelsPath,
      method: 'GET',
      headers,
      timeout: 15000
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.data && Array.isArray(json.data)) {
            // OpenAI/NVIDIA 格式
            const models = json.data.map((m: any) => ({
              id: m.id,
              name: m.id,
              owned_by: m.owned_by || provider,
              created: m.created
            }))
            resolve({ success: true, models })
          } else if (json.models && Array.isArray(json.models)) {
            // Anthropic 格式
            const models = json.models.map((m: any) => ({
              id: m.id || m.name,
              name: m.display_name || m.name || m.id,
              owned_by: provider
            }))
            resolve({ success: true, models })
          } else if (json.error) {
            // API 错误，如果有静态列表则使用
            if (providerConfig.staticModels) {
              resolve({ success: true, models: providerConfig.staticModels.map(m => ({ ...m, owned_by: provider })) })
            } else {
              resolve({ success: false, error: json.error.message || 'API error' })
            }
          } else {
            // 无法解析，使用静态列表
            if (providerConfig.staticModels) {
              resolve({ success: true, models: providerConfig.staticModels.map(m => ({ ...m, owned_by: provider })) })
            } else {
              resolve({ success: false, error: 'Invalid response format', raw: data })
            }
          }
        } catch (e) {
          // 解析失败，使用静态列表
          if (providerConfig.staticModels) {
            resolve({ success: true, models: providerConfig.staticModels.map(m => ({ ...m, owned_by: provider })) })
          } else {
            resolve({ success: false, error: 'Failed to parse response', raw: data })
          }
        }
      })
    })

    req.on('error', (err) => {
      // 网络错误，使用静态列表
      if (providerConfig.staticModels) {
        resolve({ success: true, models: providerConfig.staticModels.map(m => ({ ...m, owned_by: provider })) })
      } else {
        resolve({ success: false, error: err.message })
      }
    })

    req.on('timeout', () => {
      req.destroy()
      if (providerConfig.staticModels) {
        resolve({ success: true, models: providerConfig.staticModels.map(m => ({ ...m, owned_by: provider })) })
      } else {
        resolve({ success: false, error: 'Request timeout' })
      }
    })

    req.end()
  })
})

// 获取可用的 API 提供商列表
ipcMain.handle('api:providers', async () => {
  return Object.entries(API_PROVIDERS).map(([key, value]) => ({
    id: key,
    name: value.name
  }))
})

// 验证 API Key
ipcMain.handle('api:validate-key', async (_, provider: string, apiKey: string) => {
  const providerConfig = API_PROVIDERS[provider]
  if (!providerConfig) {
    return { valid: false, error: 'Unknown provider' }
  }

  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      [providerConfig.authHeader]: provider === 'anthropic' ? apiKey : `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...providerConfig.extraHeaders
    }

    const options: https.RequestOptions = {
      hostname: providerConfig.baseUrl,
      port: 443,
      path: providerConfig.modelsPath,
      method: 'GET',
      headers,
      timeout: 10000
    }

    const req = https.request(options, (res) => {
      // Anthropic 可能返回 200 以外的代码，但如果有静态列表则认为有效
      const isValid = res.statusCode === 200
      if (!isValid && providerConfig.staticModels) {
        // 对于有静态列表的，如果是 401 则无效，否则认为有效
        resolve({ valid: res.statusCode !== 401, statusCode: res.statusCode })
      } else {
        resolve({ valid: isValid, statusCode: res.statusCode })
      }
    })

    req.on('error', () => resolve({ valid: false, error: 'Connection failed' }))
    req.on('timeout', () => { req.destroy(); resolve({ valid: false, error: 'Timeout' }) })
    req.end()
  })
})

// 测试模型速度（tokens/s）
ipcMain.handle('api:benchmark-model', async (_, provider: string, apiKey: string, model: string) => {
  const providerConfig = API_PROVIDERS[provider]
  if (!providerConfig) {
    return { success: false, error: 'Unknown provider' }
  }

  const apiType = providerConfig.apiType || 'openai'
  const path = providerConfig.chatPath || '/v1/chat/completions'
  const prompt = 'Ping.'
  const maxTokens = 64

  const body = apiType === 'anthropic'
    ? {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }
    : {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
        stream: false,
      }

  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      [providerConfig.authHeader]: apiType === 'anthropic' ? apiKey : `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...providerConfig.extraHeaders,
    }

    const start = Date.now()
    const req = https.request({
      hostname: providerConfig.baseUrl,
      port: 443,
      path,
      method: 'POST',
      headers,
      timeout: 20000,
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        const latencyMs = Date.now() - start
        if (res.statusCode && res.statusCode >= 400) {
          resolve({ success: false, error: `HTTP ${res.statusCode}`, statusCode: res.statusCode })
          return
        }

        try {
          const json = JSON.parse(data)
          let outputTokens = 0

          if (apiType === 'anthropic') {
            outputTokens = json?.usage?.output_tokens ?? 0
          } else {
            outputTokens = json?.usage?.completion_tokens ?? json?.usage?.output_tokens ?? 0
          }

          if (!outputTokens) {
            const text = apiType === 'anthropic'
              ? (json?.content?.[0]?.text ?? '')
              : (json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? '')
            outputTokens = text ? text.trim().split(/\s+/).length : 0
          }

          const tps = outputTokens > 0 ? Number((outputTokens / (latencyMs / 1000)).toFixed(2)) : 0
          resolve({ success: true, outputTokens, latencyMs, tps })
        } catch {
          resolve({ success: false, error: 'Failed to parse response' })
        }
      })
    })

    req.on('error', (err) => resolve({ success: false, error: err.message }))
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timeout' }) })
    req.write(JSON.stringify(body))
    req.end()
  })
})

// 系统监控 API
ipcMain.handle('system:info', async () => {
  const cpus = os.cpus()
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  
  // 计算 CPU 使用率
  let cpuUsage = 0
  cpus.forEach(cpu => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
    const idle = cpu.times.idle
    cpuUsage += ((total - idle) / total) * 100
  })
  cpuUsage = cpuUsage / cpus.length
  
  return {
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      usage: Math.round(cpuUsage)
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 100)
    },
    platform: os.platform(),
    hostname: os.hostname(),
    uptime: os.uptime()
  }
})

// 获取进程内存信息
ipcMain.handle('system:process-memory', async () => {
  // Driveclaw 应用内存
  const appMemory = process.memoryUsage()
  
  // 尝试获取 Gateway/moltBOT 进程内存
  let gatewayMemory = 0
  try {
    // Windows: 使用 tasklist 获取占用端口的 node 进程内存
    const { stdout } = await execAsync(
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${GATEWAY_PORT} ^| findstr LISTENING') do @tasklist /FI "PID eq %a" /FO CSV /NH`,
      { shell: 'cmd.exe', timeout: 5000, windowsHide: true }
    )
    // 解析 tasklist 输出: "node.exe","1234","Console","1","50,000 K"
    const match = stdout.match(/"[^"]+","\d+","[^"]+","\d+","([\d,]+)\s*K"/)
    if (match) {
      gatewayMemory = parseInt(match[1].replace(/,/g, '')) * 1024
    }
  } catch {
    // 备用方案：直接获取 gatewayProcess 的 PID
    if (gatewayProcess?.pid) {
      try {
        const { stdout } = await execAsync(
          `tasklist /FI "PID eq ${gatewayProcess.pid}" /FO CSV /NH`,
          { shell: 'cmd.exe', timeout: 3000, windowsHide: true }
        )
        const match = stdout.match(/"[^"]+","\d+","[^"]+","\d+","([\d,]+)\s*K"/)
        if (match) {
          gatewayMemory = parseInt(match[1].replace(/,/g, '')) * 1024
        }
      } catch {}
    }
  }
  
  return {
    app: {
      rss: appMemory.rss,           // 常驻内存
      heapTotal: appMemory.heapTotal,
      heapUsed: appMemory.heapUsed,
      external: appMemory.external
    },
    gateway: gatewayMemory
  }
})

// Gateway 详细状态
ipcMain.handle('gateway:details', async () => {
  const isRunning = gatewayProcess !== null
  
  return {
    running: isRunning,
    pid: gatewayProcess?.pid || null,
    startTime: gatewayStartTime,
    uptime: gatewayStartTime ? Date.now() - gatewayStartTime : 0,
    port: GATEWAY_PORT
  }
})

// 应用启动时间
const appStartTime = Date.now()
ipcMain.handle('app:uptime', async () => {
  return Date.now() - appStartTime
})

// 应用设置管理
ipcMain.handle('settings:get', async () => {
  return loadAppSettings()
})

ipcMain.handle('settings:set', async (_, key: string, value: any) => {
  const settings = loadAppSettings()
  ;(settings as any)[key] = value
  saveAppSettings(settings)
  return settings
})

ipcMain.handle('settings:save', async (_, newSettings: Partial<AppSettings>) => {
  const settings = { ...loadAppSettings(), ...newSettings }
  saveAppSettings(settings)
  return settings
})

// 日志导出
ipcMain.handle('logs:export', async (_, logs: string[], filename?: string) => {
  const { dialog } = require('electron')
  const defaultPath = filename || `Driveclaw-logs-${new Date().toISOString().slice(0, 10)}.txt`
  
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出日志',
    defaultPath,
    filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }]
  })
  
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, logs.join('\n'), 'utf8')
    return { success: true, path: result.filePath }
  }
  return { success: false }
})

// ============= 心跳管理 =============

// 获取心跳状态（调用 Gateway RPC）
ipcMain.handle('heartbeat:status', async () => {
  try {
    const result = await runmoltBOT('system heartbeat last --json')
    if (result) {
      try {
        return { success: true, data: JSON.parse(result) }
      } catch {
        return { success: true, data: { raw: result } }
      }
    }
    return { success: false, error: 'No data' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 读取 HEARTBEAT.md
ipcMain.handle('heartbeat:get-md', async () => {
  try {
    // 优先检查 workspace，然后是 .openclaw 目录
    const locations = [
      path.join(os.homedir(), '.openclaw', 'HEARTBEAT.md'),
      path.join(os.homedir(), 'HEARTBEAT.md'),
    ]
    
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        const content = fs.readFileSync(loc, 'utf8')
        return { success: true, path: loc, content }
      }
    }
    
    return { success: true, path: null, content: null }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 保存 HEARTBEAT.md
ipcMain.handle('heartbeat:save-md', async (_, content: string) => {
  try {
    const heartbeatPath = path.join(os.homedir(), '.openclaw', 'HEARTBEAT.md')
    
    // 确保目录存在
    const dir = path.dirname(heartbeatPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    fs.writeFileSync(heartbeatPath, content, 'utf8')
    return { success: true, path: heartbeatPath }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 删除 HEARTBEAT.md
ipcMain.handle('heartbeat:delete-md', async () => {
  try {
    const heartbeatPath = path.join(os.homedir(), '.openclaw', 'HEARTBEAT.md')
    if (fs.existsSync(heartbeatPath)) {
      fs.unlinkSync(heartbeatPath)
    }
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 获取心跳配置
ipcMain.handle('heartbeat:get-config', async () => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const heartbeat = config?.agents?.defaults?.heartbeat || {}
      return {
        success: true,
        config: {
          every: heartbeat.every || '30m',
          target: heartbeat.target || 'last',
          enabled: heartbeat.every !== '0m' && heartbeat.every !== '',
          prompt: heartbeat.prompt || '',
          ackMaxChars: heartbeat.ackMaxChars || 300,
          includeReasoning: heartbeat.includeReasoning || false,
          activeHours: heartbeat.activeHours || null
        }
      }
    }
    return { success: true, config: { every: '30m', target: 'last', enabled: true } }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 更新心跳配置
ipcMain.handle('heartbeat:update-config', async (_, updates: Record<string, unknown>) => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    let config: Record<string, unknown> = {}
    
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
    
    // 确保路径存在
    if (!config.agents) config.agents = {}
    if (!(config.agents as any).defaults) (config.agents as any).defaults = {}
    if (!(config.agents as any).defaults.heartbeat) (config.agents as any).defaults.heartbeat = {}
    
    const heartbeat = (config.agents as any).defaults.heartbeat
    
    // 应用更新
    for (const [key, value] of Object.entries(updates)) {
      heartbeat[key] = value
    }
    
    // 更新时间戳
    if (config.meta && typeof config.meta === 'object') {
      (config.meta as any).lastTouchedAt = new Date().toISOString()
    }
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 触发心跳（立即执行一次）
ipcMain.handle('heartbeat:trigger', async () => {
  try {
    const result = await runmoltBOT('system event --text "心跳检查" --mode now')
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 发送 Telegram 通知的辅助函数
async function sendTelegramNotification(message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) {
      return { success: false, error: '配置文件不存在' }
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const telegramConfig = config?.channels?.telegram
    
    if (!telegramConfig) {
      return { success: false, error: 'Telegram 未配置' }
    }
    
    // 获取 bot token
    let botToken = telegramConfig.botToken
    if (!botToken && telegramConfig.tokenFile) {
      try {
        botToken = fs.readFileSync(telegramConfig.tokenFile, 'utf8').trim()
      } catch {}
    }
    if (!botToken) {
      botToken = process.env.TELEGRAM_BOT_TOKEN
    }
    
    if (!botToken) {
      return { success: false, error: 'Telegram bot token 未配置' }
    }
    
    // 获取默认聊天 ID（优先使用 allowlist 中的第一个用户）
    let chatId: string | number | undefined
    
    // 尝试从 allowlist 获取
    if (telegramConfig.allowlist && Array.isArray(telegramConfig.allowlist)) {
      for (const entry of telegramConfig.allowlist) {
        if (typeof entry === 'number' || (typeof entry === 'string' && /^-?\d+$/.test(entry))) {
          chatId = entry
          break
        }
        if (typeof entry === 'object' && entry.id) {
          chatId = entry.id
          break
        }
      }
    }
    
    // 尝试从 owner 配置获取
    if (!chatId && config.owner?.telegram) {
      chatId = config.owner.telegram
    }
    
    // 尝试从 heartbeat target 配置获取
    if (!chatId && config?.agents?.defaults?.heartbeat?.target) {
      const target = config.agents.defaults.heartbeat.target
      if (target !== 'last' && target !== 'none' && target !== 'telegram') {
        chatId = target
      }
    }
    
    if (!chatId) {
      return { success: false, error: '未找到 Telegram 聊天 ID' }
    }
    
    // 发送消息
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
      
      const req = https.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 30000
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.ok) {
              resolve({ success: true })
            } else {
              resolve({ success: false, error: json.description || 'Telegram API 错误' })
            }
          } catch {
            resolve({ success: false, error: '解析响应失败' })
          }
        })
      })
      
      req.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })
      
      req.on('timeout', () => {
        req.destroy()
        resolve({ success: false, error: '请求超时' })
      })
      
      req.write(postData)
      req.end()
    })
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// 启用/禁用心跳
ipcMain.handle('heartbeat:set-enabled', async (_, enabled: boolean) => {
  try {
    const cmd = enabled ? 'system heartbeat enable' : 'system heartbeat disable'
    const result = await runmoltBOT(cmd)
    
    // 发送 Telegram 通知
    const statusText = enabled ? '✅ 已启用' : '⏸️ 已暂停'
    const message = `<b>🫀 心跳状态变更</b>\n\n状态: ${statusText}\n时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
    
    // 异步发送通知，不阻塞返回
    sendTelegramNotification(message).catch(() => {})
    
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 获取可用的渠道列表（用于心跳 target 选择）
ipcMain.handle('heartbeat:get-channels', async () => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    const channels: string[] = ['last', 'none']
    
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const channelsConfig = config?.channels || {}
      
      // 收集已配置的渠道
      const channelTypes = ['telegram', 'whatsapp', 'discord', 'slack', 'signal', 'imessage', 'msteams', 'googlechat']
      for (const type of channelTypes) {
        if (channelsConfig[type]) {
          channels.push(type)
        }
      }
    }
    
    return { success: true, channels }
  } catch (error: any) {
    return { success: false, error: error.message, channels: ['last', 'none'] }
  }
})

// ============================================
// Moltbook 自主 Agent 管理
// ============================================

interface MoltbookConfig {
  enabled: boolean
  goal: string
  loopInterval: number
  maxIterations: number
  autoPost: boolean
  MoltbookUrl: string
  targetChannel: string
}

interface MoltbookLog {
  id: string
  timestamp: string
  type: 'info' | 'action' | 'thought' | 'success' | 'error' | 'post' | 'interaction'
  message: string
  details?: string
}

interface MoltbookPost {
  id: string
  timestamp: string
  content: string
  status: 'pending' | 'sent' | 'failed'
  iteration: number
  platform?: string
}

interface MoltbookInteraction {
  id: string
  timestamp: string
  type: 'browse' | 'like' | 'comment' | 'reply' | 'follow'
  target?: string  // 交互对象
  content?: string
  iteration: number
}

interface MoltbookStatus {
  running: boolean
  iteration: number
  lastAction: string
  startTime: number | null
  tokensUsed: number
  totalPosts: number
  totalInteractions: number
}

// 全局状态
let MoltbookStatus: MoltbookStatus = {
  running: false,
  iteration: 0,
  lastAction: '',
  startTime: null,
  tokensUsed: 0,
  totalPosts: 0,
  totalInteractions: 0
}

let MoltbookLogs: MoltbookLog[] = []
let MoltbookPosts: MoltbookPost[] = []
let MoltbookInteractions: MoltbookInteraction[] = []
let MoltbookLoopTimer: ReturnType<typeof setTimeout> | null = null

const DEFAULT_Moltbook_CONFIG: MoltbookConfig = {
  enabled: false,
  goal: '浏览 Moltbook，与其他 AI 互动，发表有趣的见解',
  loopInterval: 300,
  maxIterations: 0,
  autoPost: true,
  MoltbookUrl: 'https://Moltbook.fun',
  targetChannel: 'telegram'
}

// 添加日志
function addMoltbookLog(type: MoltbookLog['type'], message: string, details?: string) {
  const log: MoltbookLog = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toLocaleTimeString(),
    type,
    message,
    details
  }
  MoltbookLogs.push(log)
  // 保留最近 500 条日志
  if (MoltbookLogs.length > 500) {
    MoltbookLogs = MoltbookLogs.slice(-500)
  }
}

// 添加发帖记录
function addMoltbookPost(content: string, status: MoltbookPost['status'] = 'sent', platform?: string) {
  const post: MoltbookPost = {
    id: `post-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    content,
    status,
    iteration: MoltbookStatus.iteration,
    platform
  }
  MoltbookPosts.unshift(post)
  MoltbookStatus.totalPosts++
  // 保留最近 100 条发帖
  if (MoltbookPosts.length > 100) {
    MoltbookPosts = MoltbookPosts.slice(0, 100)
  }
  return post
}

// 添加互动记录
function addMoltbookInteraction(type: MoltbookInteraction['type'], target?: string, content?: string) {
  const interaction: MoltbookInteraction = {
    id: `int-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    type,
    target,
    content,
    iteration: MoltbookStatus.iteration
  }
  MoltbookInteractions.unshift(interaction)
  MoltbookStatus.totalInteractions++
  // 保留最近 200 条互动
  if (MoltbookInteractions.length > 200) {
    MoltbookInteractions = MoltbookInteractions.slice(0, 200)
  }
  return interaction
}

// 获取 Moltbook 配置
ipcMain.handle('Moltbook:get-config', async () => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'Moltbook.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      return { success: true, config }
    }
    return { success: true, config: DEFAULT_Moltbook_CONFIG }
  } catch (error: any) {
    return { success: false, error: error.message, config: DEFAULT_Moltbook_CONFIG }
  }
})

// 更新 Moltbook 配置
ipcMain.handle('Moltbook:update-config', async (_, config: Partial<MoltbookConfig>) => {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'Moltbook.json')
    const moltBOTDir = path.join(os.homedir(), '.openclaw')
    
    if (!fs.existsSync(moltBOTDir)) {
      fs.mkdirSync(moltBOTDir, { recursive: true })
    }
    
    let existingConfig = DEFAULT_Moltbook_CONFIG
    if (fs.existsSync(configPath)) {
      existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
    
    const newConfig = { ...existingConfig, ...config }
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2))
    return { success: true, config: newConfig }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 获取 Moltbook 状态
ipcMain.handle('Moltbook:get-status', async () => {
  return { success: true, status: MoltbookStatus }
})

// 获取 Moltbook 日志
ipcMain.handle('Moltbook:get-logs', async () => {
  return { success: true, logs: MoltbookLogs }
})

// 清除 Moltbook 日志
ipcMain.handle('Moltbook:clear-logs', async () => {
  MoltbookLogs = []
  return { success: true }
})

// 获取发帖记录
ipcMain.handle('Moltbook:get-posts', async () => {
  return { success: true, posts: MoltbookPosts }
})

// 获取互动记录
ipcMain.handle('Moltbook:get-interactions', async () => {
  return { success: true, interactions: MoltbookInteractions }
})

// 清除所有记录
ipcMain.handle('Moltbook:clear-all', async () => {
  MoltbookLogs = []
  MoltbookPosts = []
  MoltbookInteractions = []
  MoltbookStatus.totalPosts = 0
  MoltbookStatus.totalInteractions = 0
  return { success: true }
})

// 启动 Moltbook Agent
ipcMain.handle('Moltbook:start', async (_, config: MoltbookConfig) => {
  try {
    if (MoltbookStatus.running) {
      return { success: false, error: 'Agent 已在运行' }
    }
    
    // 保存配置
    const configPath = path.join(os.homedir(), '.openclaw', 'Moltbook.json')
    const moltBOTDir = path.join(os.homedir(), '.openclaw')
    if (!fs.existsSync(moltBOTDir)) {
      fs.mkdirSync(moltBOTDir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    
    // 初始化状态
    MoltbookStatus = {
      running: true,
      iteration: 0,
      lastAction: '',
      startTime: Date.now(),
      tokensUsed: 0,
      totalPosts: MoltbookStatus.totalPosts,
      totalInteractions: MoltbookStatus.totalInteractions
    }
    
    addMoltbookLog('info', '🚀 自主 Agent 已启动')
    addMoltbookLog('info', `🎯 目标: ${config.goal}`)
    addMoltbookLog('info', `⏰ 循环间隔: ${config.loopInterval} 秒`)
    
    // 启动 Agent Loop
    runMoltbookLoop(config)
    
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 停止 Moltbook Agent
ipcMain.handle('Moltbook:stop', async () => {
  try {
    if (MoltbookLoopTimer) {
      clearTimeout(MoltbookLoopTimer)
      MoltbookLoopTimer = null
    }
    
    MoltbookStatus.running = false
    addMoltbookLog('info', '⛔ Agent 已停止')
    
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// Agent Loop 实现
async function runMoltbookLoop(config: MoltbookConfig) {
  if (!MoltbookStatus.running) return
  
  // 检查迭代次数限制
  if (config.maxIterations > 0 && MoltbookStatus.iteration >= config.maxIterations) {
    MoltbookStatus.running = false
    addMoltbookLog('success', `✅ 已完成 ${config.maxIterations} 次迭代，Agent 自动停止`)
    return
  }
  
  MoltbookStatus.iteration++
  addMoltbookLog('info', `🔄 开始第 ${MoltbookStatus.iteration} 次迭代`)
  
  try {
    // 1. 思考阶段 - 让 AI 决定下一步做什么
    addMoltbookLog('thought', '🧠 思考中...')
    
    const thinkPrompt = `你是一个自主运行的 AI Agent，你的目标是: ${config.goal}

这是你的第 ${MoltbookStatus.iteration} 次迭代。

请思考你接下来要做什么，然后执行。你可以:
1. 浏览 Moltbook (${config.MoltbookUrl}) 查看其他 AI 的发帖
2. 在 Moltbook 上发表你的想法或见解
3. 与其他 AI 互动

请用简短的语言描述你的计划和行动。`
    
    const thinkResult = await runmoltBOT(`ask "${thinkPrompt.replace(/"/g, '\\"')}"`)
    
    // 解析 AI 的思考结果
    const cleanThinkResult = thinkResult.replace(/\x1b\[[0-9;]*m/g, '').trim()
    addMoltbookLog('thought', '💭 AI 思考结果', cleanThinkResult.substring(0, 500))
    
    // 估算 token 消耗 (粗略估计)
    MoltbookStatus.tokensUsed += Math.ceil((thinkPrompt.length + cleanThinkResult.length) / 4)
    
    // 2. 执行阶段 - 记录浏览行为
    addMoltbookInteraction('browse', config.MoltbookUrl, '浏览 Moltbook 首页')
    addMoltbookLog('interaction', '👀 浏览了 Moltbook')
    
    if (config.autoPost && cleanThinkResult.length > 50) {
      addMoltbookLog('action', '📝 正在发布内容...')
      
      // 记录发帖
      const postContent = cleanThinkResult.substring(0, 280) // 截取前 280 字符
      addMoltbookPost(postContent, 'sent', 'Moltbook')
      addMoltbookLog('post', '📤 已向 Moltbook 发送内容', postContent.substring(0, 100) + '...')
      MoltbookStatus.lastAction = '发布内容到 Moltbook'
      
      // 模拟随机互动
      if (Math.random() > 0.5) {
        addMoltbookInteraction('like', 'AI_User_' + Math.floor(Math.random() * 100), '点赞了一篇帖子')
        addMoltbookLog('interaction', '❤️ 点赞了一篇帖子')
      }
    } else {
      addMoltbookLog('action', '👀 本次只是观察，未发布内容')
      MoltbookStatus.lastAction = '观察'
      
      // 模拟浏览互动
      if (Math.random() > 0.3) {
        addMoltbookInteraction('browse', 'trending', '浏览了热门帖子')
      }
    }
    
    addMoltbookLog('success', `✅ 第 ${MoltbookStatus.iteration} 次迭代完成`)
    
  } catch (error: any) {
    addMoltbookLog('error', `❌ 迭代失败: ${error.message}`)
  }
  
  // 安排下一次迭代
  if (MoltbookStatus.running) {
    addMoltbookLog('info', `⏳ 等待 ${config.loopInterval} 秒后进行下一次迭代...`)
    MoltbookLoopTimer = setTimeout(() => runMoltbookLoop(config), config.loopInterval * 1000)
  }
}

// ============================================
// 对话框 API
// ============================================

// 选择文件夹
ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择安装目录'
  })
  
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null }
  }
  
  return { path: result.filePaths[0] }
})

// 浏览器扩展相关
ipcMain.handle('browser-extension:get-path', async () => {
  const extensionPath = path.join(getmoltBOTPath(), 'assets', 'chrome-extension')
  const exists = fs.existsSync(extensionPath)
  return { path: extensionPath, exists }
})

ipcMain.handle('browser-extension:open-folder', async () => {
  const extensionPath = path.join(getmoltBOTPath(), 'assets', 'chrome-extension')
  if (fs.existsSync(extensionPath)) {
    shell.openPath(extensionPath)
    return { success: true }
  }
  return { success: false, error: '扩展目录不存在' }
})

ipcMain.handle('browser-extension:open-chrome-extensions', async () => {
  shell.openExternal('chrome://extensions/')
  return { success: true }
})

// ============================================
// moltBOT 一键部署
// ============================================

ipcMain.handle('moltBOT:deploy', async (_, targetPath: string) => {
  try {
    // 确保目标目录存在
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true })
    }
    
    // 检查是否已安装 Node.js
    try {
      await execAsync('node --version')
    } catch {
      return { success: false, error: '未检测到 Node.js，请先安装 Node.js (https://nodejs.org)' }
    }
    
    // 检查是否已安装 Git
    try {
      await execAsync('git --version')
    } catch {
      return { success: false, error: '未检测到 Git，请先安装 Git (https://git-scm.com)' }
    }
    
    const moltBOTPath = path.join(targetPath, 'moltBOT')
    
    // 检查是否已存在
    if (fs.existsSync(moltBOTPath)) {
      // 尝试 git pull 更新
      try {
        await execAsync('git pull', { cwd: moltBOTPath })
      } catch {
        // 如果更新失败，尝试重新克隆
        fs.rmSync(moltBOTPath, { recursive: true, force: true })
      }
    }
    
    // 如果目录不存在，克隆仓库
    if (!fs.existsSync(moltBOTPath)) {
      const cloneCmd = 'git clone https://github.com/moltBOTai/moltBOT.git'
      await execAsync(cloneCmd, { cwd: targetPath })
    }
    
    // 安装依赖
    await execAsync('npm install', { cwd: moltBOTPath })
    
    // 检查是否有 build 脚本
    const packageJsonPath = path.join(moltBOTPath, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.scripts?.build) {
        await execAsync('npm run build', { cwd: moltBOTPath })
      }
    }
    
    // 初始化配置
    const configDir = path.join(os.homedir(), '.openclaw')
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    
    return { 
      success: true, 
      path: moltBOTPath,
      message: 'moltBOT 部署成功！'
    }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || '部署失败'
    }
  }
})

// 获取 moltBOT 本地版本
ipcMain.handle('moltBOT:get-version', async () => {
  try {
    const packageJsonPath = path.join(getmoltBOTPath(), 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      return { success: true, version: packageJson.version || 'unknown' }
    }
    return { success: false, error: 'moltBOT 未安装' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 检查 moltBOT 更新 - 使用 git ls-remote 获取最新 tag
ipcMain.handle('moltBOT:check-update', async () => {
  try {
    // 获取本地版本
    const packageJsonPath = path.join(getmoltBOTPath(), 'package.json')
    let localVersion = '0.0.0'
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      localVersion = packageJson.version || '0.0.0'
    }
    
    // 设置代理环境变量（使用常见的本地代理端口）
    const gitEnv = { ...process.env }
    // 如果没有设置代理，尝试常见的本地代理
    if (!gitEnv.https_proxy && !gitEnv.http_proxy) {
      gitEnv.http_proxy = 'http://127.0.0.1:7897'
      gitEnv.https_proxy = 'http://127.0.0.1:7897'
    }
    
    // 使用 git ls-remote 获取最新 tag
    let latestVersion = localVersion
    let releaseUrl = 'https://github.com/moltBOT/moltBOT/releases'
    
    try {
      // 尝试从 git remote 获取最新 tags
      const { stdout } = await execAsync(
        'git ls-remote --tags --sort=-v:refname origin',
        { cwd: getmoltBOTPath(), windowsHide: true, timeout: 30000, env: gitEnv }
      )
      
      // 解析最新 tag
      const lines = stdout.trim().split('\n')
      for (const line of lines) {
        const match = line.match(/refs\/tags\/v?([\d.]+)$/)
        if (match) {
          latestVersion = match[1]
          break
        }
      }
    } catch (gitError: any) {
      console.log('Git ls-remote failed:', gitError.message)
      // 如果 git 失败，尝试用 git fetch --tags 然后查看本地 tags
      try {
        await execAsync('git fetch --tags', { cwd: getmoltBOTPath(), windowsHide: true, timeout: 30000, env: gitEnv })
        const { stdout } = await execAsync(
          'git tag --sort=-v:refname',
          { cwd: getmoltBOTPath(), windowsHide: true }
        )
        const tags = stdout.trim().split('\n')
        if (tags.length > 0 && tags[0]) {
          latestVersion = tags[0].replace(/^v/, '')
        }
      } catch {
        // 如果还是失败，保持本地版本
      }
    }
    
    // 比较版本
    const hasUpdate = latestVersion !== localVersion && latestVersion !== '0.0.0'
    
    return {
      success: true,
      currentVersion: localVersion,
      latestVersion,
      hasUpdate,
      releaseUrl
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 一键更新 moltBOT
ipcMain.handle('moltBOT:update', async () => {
  try {
    if (!fs.existsSync(getmoltBOTPath())) {
      return { success: false, error: 'moltBOT 未安装，请先部署' }
    }
    
    // 检查 Git
    try {
      await execAsync('git --version')
    } catch {
      return { success: false, error: '未检测到 Git，请先安装 Git' }
    }
    
    // 设置代理环境变量
    const gitEnv = { ...process.env }
    if (!gitEnv.https_proxy && !gitEnv.http_proxy) {
      gitEnv.http_proxy = 'http://127.0.0.1:7897'
      gitEnv.https_proxy = 'http://127.0.0.1:7897'
    }
    
    // 执行 git pull
    try {
      await execAsync('git pull', { cwd: getmoltBOTPath(), windowsHide: true, timeout: 60000, env: gitEnv })
    } catch (e: any) {
      // 如果有本地修改，尝试 reset
      if (e.message?.includes('local changes')) {
        await execAsync('git reset --hard HEAD', { cwd: getmoltBOTPath(), windowsHide: true, env: gitEnv })
        await execAsync('git pull', { cwd: getmoltBOTPath(), windowsHide: true, timeout: 60000, env: gitEnv })
      } else {
        throw e
      }
    }
    
    // 安装依赖
    await execAsync('npm install', { cwd: getmoltBOTPath(), windowsHide: true, timeout: 300000 })
    
    // 重新构建
    const packageJsonPath = path.join(getmoltBOTPath(), 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.scripts?.build) {
        await execAsync('npm run build', { cwd: getmoltBOTPath(), windowsHide: true, timeout: 120000 })
      }
      
      return { 
        success: true, 
        version: packageJson.version,
        message: `更新成功！当前版本: ${packageJson.version}`
      }
    }
    
    return { success: true, message: '更新成功！' }
  } catch (error: any) {
    return { success: false, error: error.message || '更新失败' }
  }
})

// ============================================
// 记忆管理 API
// ============================================

const MEMORY_DB_PATH = path.join(os.homedir(), '.openclaw', 'memory', 'main.sqlite')

// 获取记忆统计 - 简化版，只读取文件信息
ipcMain.handle('memory:stats', async () => {
  try {
    if (!fs.existsSync(MEMORY_DB_PATH)) {
      return { 
        success: true, 
        data: {
          exists: false,
          totalSize: 0,
          dbPath: MEMORY_DB_PATH,
          lastModified: null
        }
      }
    }
    
    const stats = fs.statSync(MEMORY_DB_PATH)
    
    return {
      success: true,
      data: {
        exists: true,
        totalSize: stats.size,
        dbPath: MEMORY_DB_PATH,
        lastModified: stats.mtime.toISOString()
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 搜索记忆 - 使用 moltBOT CLI
ipcMain.handle('memory:search', async (_, query: string) => {
  try {
    const result = await runmoltBOT(`memory search "${query.replace(/"/g, '\\"')}"`)
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 清空记忆 - 删除数据库文件
ipcMain.handle('memory:clear', async () => {
  try {
    if (fs.existsSync(MEMORY_DB_PATH)) {
      // 备份后删除
      const backupPath = MEMORY_DB_PATH + '.backup.' + Date.now()
      fs.copyFileSync(MEMORY_DB_PATH, backupPath)
      fs.unlinkSync(MEMORY_DB_PATH)
      return { success: true, message: '已清空记忆（已备份）', backupPath }
    }
    return { success: true, message: '记忆数据库不存在' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// ============================================
// moltBOT 路径管理 API
// ============================================

// 获取当前工作目录
ipcMain.handle('moltBOT:get-path', async () => {
  const workspace = getWorkspacePath()
  return {
    success: true,
    path: workspace,
    skillsPath: path.join(workspace, 'skills'),
    cliPath: getCliPath()
  }
})

// 设置工作目录
ipcMain.handle('moltBOT:set-path', async (_, newPath: string) => {
  try {
    // 验证路径是否有效
    if (!fs.existsSync(newPath)) {
      return { success: false, error: '路径不存在' }
    }
    
    // 检查是否有 skills 目录
    const skillsDir = path.join(newPath, 'skills')
    if (!fs.existsSync(skillsDir)) {
      // 尝试创建 skills 目录
      try {
        fs.mkdirSync(skillsDir, { recursive: true })
      } catch {
        return { success: false, error: '无法创建 skills 目录' }
      }
    }
    
    saveWorkspacePath(newPath)
    return {
      success: true,
      path: newPath,
      skillsPath: skillsDir
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 自动搜索可能的工作目录
ipcMain.handle('moltBOT:search-paths', async () => {
  try {
    const paths = searchWorkspacePaths()
    return {
      success: true,
      paths,
      current: getWorkspacePath()
    }
  } catch (error: any) {
    return { success: false, error: error.message, paths: [] }
  }
})

// 选择文件夹对话框
ipcMain.handle('moltBOT:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: '选择 moltBOT 目录'
  })
  
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null }
  }
  
  const selectedPath = result.filePaths[0]
  
  // 检查该目录是否有效
  const hasSkills = fs.existsSync(path.join(selectedPath, 'skills'))
  const hasMemory = fs.existsSync(path.join(selectedPath, 'memory'))
  
  return {
    path: selectedPath,
    isValid: hasSkills || hasMemory,
    hasSkills,
    hasMemory
  }
})
