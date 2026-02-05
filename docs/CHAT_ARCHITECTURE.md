# Driveclaw 实时对话系统架构

## 概述

Driveclaw 是 moltBOT 的桌面客户端，实现与 moltBOT Gateway 的实时双向通信。核心技术是基于 **WebSocket** 协议的长连接通信，而非 HTTP SSE。

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Driveclaw (Electron)                        │
│                                                                     │
│  ┌─────────────────────┐         IPC          ┌──────────────────┐ │
│  │    Main Process     │ ←─────────────────→  │  Renderer Process │ │
│  │  (GatewayWsClient)  │   contextBridge      │    (Chat.tsx)     │ │
│  └──────────┬──────────┘                      └──────────────────┘ │
│             │                                                       │
└─────────────┼───────────────────────────────────────────────────────┘
              │ WebSocket (ws://127.0.0.1:18789)
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     moltBOT Gateway (Node.js)                      │
│                                                                     │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐   │
│  │  WebSocket     │    │   Chat API     │    │  Agent Engine  │   │
│  │  Server        │ →  │  (chat.send)   │ →  │  (AI Backend)  │   │
│  └────────────────┘    └────────────────┘    └────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 通信协议

### 协议概述

moltBOT Gateway 使用自定义的 JSON-RPC 风格协议，基于 WebSocket 传输。

### 帧类型

#### 1. 请求帧 (Request Frame)
客户端发送给服务端的请求。

```typescript
interface RequestFrame {
  type: 'req'
  id: string        // UUID, 用于匹配响应
  method: string    // 方法名, 如 'chat.send'
  params?: unknown  // 方法参数
}
```

示例:
```json
{
  "type": "req",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "chat.send",
  "params": {
    "sessionKey": "Driveclaw-1706745600000",
    "message": "你好",
    "idempotencyKey": "550e8400-e29b-41d4-a716-446655440001"
  }
}
```

#### 2. 响应帧 (Response Frame)
服务端对请求的响应。

```typescript
interface ResponseFrame {
  type: 'res'
  id: string        // 对应请求的 id
  ok: boolean       // 是否成功
  payload?: unknown // 响应数据
  error?: {
    code: number
    message: string
  }
}
```

示例:
```json
{
  "type": "res",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "ok": true,
  "payload": {
    "runId": "run-123456",
    "status": "started"
  }
}
```

#### 3. 事件帧 (Event Frame)
服务端主动推送的事件，这是**流式输出的核心**。

```typescript
interface EventFrame {
  type: 'evt'
  event: string     // 事件类型
  seq?: number      // 序列号
  payload?: unknown // 事件数据
}
```

### Chat 事件 (`event: 'chat'`)

Chat 事件是流式对话的核心，包含以下状态：

```typescript
interface ChatEventPayload {
  runId: string      // 本次对话的唯一标识
  sessionKey: string // 会话标识
  seq: number        // 事件序列号
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
```

**状态机**:
```
[发送消息] → started
     ↓
  delta (可能多次) ← 流式增量内容
     ↓
  final | aborted | error ← 结束状态
```

### Agent 事件 (`event: 'agent'`)

Agent 事件包含 AI 的思考过程、工具调用等信息：

```typescript
interface AgentEventPayload {
  runId: string
  seq: number
  stream: 'lifecycle' | 'tool' | 'assistant' | 'error'
  ts: number
  sessionKey?: string
  data: Record<string, unknown>
}
```

**stream 类型**:
- `lifecycle`: 生命周期事件 (开始/结束)
- `tool`: 工具调用事件
- `assistant`: 助手输出事件 (包含 thinking)
- `error`: 错误事件

## 连接握手

### 连接流程

```
1. Client 建立 WebSocket 连接
2. Server 发送 connect.challenge 事件 (包含 nonce)
3. Client 发送 connect 请求
4. Server 返回 HelloOk 响应
5. 连接建立完成，开始正常通信
```

### Connect 请求参数

```typescript
interface ConnectParams {
  minProtocol: number  // 最小协议版本
  maxProtocol: number  // 最大协议版本
  client: {
    id: string           // 客户端标识
    displayName?: string // 显示名称
    version: string      // 版本号
    platform: string     // 平台
    mode: string         // 模式: 'backend' | 'frontend'
  }
  caps?: string[]      // 能力列表
  role?: string        // 角色: 'operator'
  scopes?: string[]    // 权限范围
  auth?: {
    token?: string
    password?: string
  }
}
```

## 核心 API

### chat.send - 发送消息

请求:
```json
{
  "method": "chat.send",
  "params": {
    "sessionKey": "Driveclaw-xxx",
    "message": "用户输入的消息",
    "thinking": "off|minimal|low|medium|high",  // 可选
    "idempotencyKey": "uuid"  // 幂等键
  }
}
```

响应:
```json
{
  "ok": true,
  "payload": {
    "runId": "run-xxx",
    "status": "started"
  }
}
```

之后通过 `chat` 事件接收流式内容。

### chat.history - 获取历史

请求:
```json
{
  "method": "chat.history",
  "params": {
    "sessionKey": "Driveclaw-xxx",
    "limit": 100
  }
}
```

响应:
```json
{
  "ok": true,
  "payload": {
    "sessionKey": "Driveclaw-xxx",
    "sessionId": "session-id",
    "messages": [...],
    "thinkingLevel": "medium"
  }
}
```

### chat.abort - 中止生成

请求:
```json
{
  "method": "chat.abort",
  "params": {
    "sessionKey": "Driveclaw-xxx",
    "runId": "run-xxx"  // 可选
  }
}
```

## 代码实现

### 主进程 WebSocket 客户端 (electron/main.ts)

```typescript
class GatewayWsClient extends EventEmitter {
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve, reject, timer }>()
  
  // 连接到 Gateway
  connect(): Promise<void>
  
  // 断开连接
  disconnect(): void
  
  // 发送 RPC 请求
  async request<T>(method: string, params?: unknown): Promise<T>
  
  // 发送聊天消息
  async chatSend(params: { sessionKey, message, thinking? }): Promise<{ runId, status }>
  
  // 获取聊天历史
  async chatHistory(sessionKey: string, limit?: number): Promise<{ messages }>
  
  // 中止生成
  async chatAbort(sessionKey: string, runId?: string): Promise<{ ok, aborted }>
}
```

**事件转发到渲染进程**:
```typescript
// 在 handleEvent 中
if (event === 'chat') {
  mainWindow?.webContents.send('gateway:chat-event', payload)
}
if (event === 'agent') {
  mainWindow?.webContents.send('gateway:agent-event', payload)
}
```

### Preload 桥接 (electron/preload.ts)

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  gateway: {
    // WebSocket API
    wsConnect: () => ipcRenderer.invoke('gateway:ws-connect'),
    wsDisconnect: () => ipcRenderer.invoke('gateway:ws-disconnect'),
    wsStatus: () => ipcRenderer.invoke('gateway:ws-status'),
    wsChatSend: (params) => ipcRenderer.invoke('gateway:ws-chat-send', params),
    wsChatHistory: (sessionKey, limit) => ipcRenderer.invoke('gateway:ws-chat-history', sessionKey, limit),
    wsChatAbort: (sessionKey, runId) => ipcRenderer.invoke('gateway:ws-chat-abort', sessionKey, runId),
    
    // 事件监听
    onChatEvent: (callback) => {
      ipcRenderer.on('gateway:chat-event', callback)
      return () => ipcRenderer.removeListener('gateway:chat-event', callback)
    },
    onAgentEvent: (callback) => {
      ipcRenderer.on('gateway:agent-event', callback)
      return () => ipcRenderer.removeListener('gateway:agent-event', callback)
    },
  }
})
```

### 渲染进程事件处理 (src/pages/Chat.tsx)

```typescript
useEffect(() => {
  // 监听 Chat 事件
  const unsubChat = window.electronAPI?.gateway.onChatEvent((_, payload) => {
    if (payload.sessionKey !== sessionIdRef.current) return
    
    const { state, message, errorMessage } = payload
    
    if (state === 'delta') {
      // 流式增量 - 更新消息内容
      const textContent = extractTextFromMessage(message)
      setMessages(prev => updateStreamingMessage(prev, textContent))
    } 
    else if (state === 'final') {
      // 完成 - 标记消息结束
      setMessages(prev => finalizeMessage(prev, message))
      setIsStreaming(false)
    }
    else if (state === 'error') {
      // 错误处理
      setMessages(prev => markMessageError(prev, errorMessage))
      setIsStreaming(false)
    }
  })
  
  return () => unsubChat?.()
}, [])
```

## 思考块解析

moltBOT 的思考内容使用 `<think>...</think>` 标签包裹：

```typescript
const parseThinkingBlocks = (text: string): { content: string; thinking: ThinkingBlock[] } => {
  const thinking: ThinkingBlock[] = []
  let content = ''
  let remaining = text
  
  while (remaining) {
    const thinkStart = remaining.indexOf('<think>')
    if (thinkStart === -1) {
      content += remaining
      break
    }
    
    content += remaining.slice(0, thinkStart)
    remaining = remaining.slice(thinkStart + 7)
    
    const thinkEnd = remaining.indexOf('</think>')
    if (thinkEnd !== -1) {
      thinking.push({
        id: `think-${Date.now()}`,
        content: remaining.slice(0, thinkEnd).trim(),
        collapsed: false
      })
      remaining = remaining.slice(thinkEnd + 8)
    }
  }
  
  return { content, thinking }
}
```

## 依赖

- **ws** (^8.18.0): Node.js WebSocket 客户端
- **electron**: 主进程运行环境

## 文件结构

```
Driveclaw/
├── electron/
│   ├── main.ts           # 主进程 (包含 GatewayWsClient)
│   └── preload.ts        # IPC 桥接
├── src/
│   └── pages/
│       └── Chat.tsx      # 聊天界面 (事件监听)
└── docs/
    └── CHAT_ARCHITECTURE.md  # 本文档
```

## 调试

### 查看 WebSocket 帧

在主进程中添加日志：
```typescript
this.ws.on('message', (data) => {
  console.log('[WS RX]', data.toString())
})
```

### 检查连接状态

```typescript
const status = await window.electronAPI.gateway.wsStatus()
console.log('WebSocket connected:', status.connected)
```

## 注意事项

1. **会话隔离**: 每个 Chat 页面使用独立的 `sessionKey`
2. **幂等性**: `chat.send` 使用 `idempotencyKey` 防止重复发送
3. **自动重连**: WebSocket 断开后会自动尝试重连
4. **超时处理**: 请求默认 60 秒超时
5. **asar 打包**: `ws` 模块需要 unpack 才能正常工作
