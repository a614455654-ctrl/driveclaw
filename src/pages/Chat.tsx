import { useState, useRef, useEffect, useCallback } from 'react'
import { 
  Send, Loader2, Trash2, AlertCircle, ChevronDown, ChevronRight, 
  Brain, Wrench, MessageSquare, Copy, Check, Settings2, StopCircle,
  Plus, MessageCircle, MoreHorizontal, Edit2, RefreshCw
} from 'lucide-react'
import './Chat.css'

// 消息类型
interface ThinkingBlock {
  id: string
  content: string
  collapsed: boolean
}

interface ToolCall {
  id: string
  name: string
  status: 'running' | 'success' | 'error'
  input?: string
  output?: string
  collapsed: boolean
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  thinking?: ThinkingBlock[]
  tools?: ToolCall[]
  isStreaming?: boolean
  error?: string
}

// 会话类型
interface Conversation {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  messages: Message[]
}

// Telegram 会话类型 (来自 Gateway)
interface TelegramSession {
  sessionKey: string
  key?: string  // 可能用 key 而不是 sessionKey
  sessionId: string
  updatedAt?: string
  displayName?: string
  channel?: string
  lastChannel?: string  // 最后使用的渠道
  deliveryContext?: {
    channel?: string
    to?: string
    accountId?: string
  }
  origin?: {
    label?: string
    provider?: string
    from?: string
    to?: string
    accountId?: string
    threadId?: string
  }
}

interface ChatSettings {
  showThinking: boolean
}

// WebSocket 事件负载类型
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

// 持久化存储 key
const CONVERSATIONS_KEY = 'Driveclaw-conversations'
const ACTIVE_CONV_KEY = 'Driveclaw-active-conversation'
const SETTINGS_KEY = 'Driveclaw-chat-settings'

// 生成唯一 ID
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

// 从 localStorage 加载会话列表
const loadConversations = (): Conversation[] => {
  try {
    const saved = localStorage.getItem(CONVERSATIONS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return parsed.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt),
        messages: conv.messages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
          isStreaming: false
        }))
      }))
    }
  } catch {}
  return []
}

// 从 localStorage 加载活跃会话 ID
const loadActiveConversationId = (): string | null => {
  try {
    return localStorage.getItem(ACTIVE_CONV_KEY)
  } catch {}
  return null
}

// 从 localStorage 加载设置
const loadSettings = (): ChatSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { showThinking: true }
}

// 创建新会话
const createNewConversation = (): Conversation => {
  const now = new Date()
  return {
    id: generateId(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: []
  }
}

// 根据消息内容生成会话标题
const generateTitle = (content: string): string => {
  const cleaned = content.replace(/\s+/g, ' ').trim()
  return cleaned.length > 20 ? cleaned.slice(0, 20) + '...' : cleaned
}


export default function Chat() {
  // 会话列表状态
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations()
    if (loaded.length === 0) {
      // 首次使用，创建默认会话
      return [createNewConversation()]
    }
    return loaded
  })
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    const loaded = loadConversations()
    const savedId = loadActiveConversationId()
    if (savedId && loaded.some(c => c.id === savedId)) {
      return savedId
    }
    return loaded[0]?.id || createNewConversation().id
  })
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [showConvMenu, setShowConvMenu] = useState<string | null>(null)
  
  // Telegram 会话状态
  const [telegramSessions, setTelegramSessions] = useState<TelegramSession[]>([])
  const [activeTelegramSession, setActiveTelegramSession] = useState<string | null>(null)
  const [telegramMessages, setTelegramMessages] = useState<Message[]>([])
  const [loadingTelegram, setLoadingTelegram] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [gatewayOnline, setGatewayOnline] = useState(false)
  const [settings, setSettings] = useState<ChatSettings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  
  // 获取当前活跃会话
  const activeConversation = conversations.find(c => c.id === activeConversationId)
  const messages = activeConversation?.messages || []
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<Message[]>(messages)
  const instanceIdRef = useRef(`chat-${Math.random().toString(36).slice(2, 10)}`)
  const streamingMessageRef = useRef<Message | null>(null)
  const streamingMessageIdRef = useRef<string | null>(null)
  const currentRunIdRef = useRef<string | null>(null)
  const contentBufferRef = useRef<string>('')
  const thinkingBufferRef = useRef<ThinkingBlock[]>([])
  const editInputRef = useRef<HTMLInputElement>(null)

  // 持久化会话数据
  const persistConversations = useCallback((convs: Conversation[]) => {
    const toSave = convs.map(conv => ({
      ...conv,
      messages: conv.messages.map(msg => 
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      )
    }))
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(toSave))
    } catch {}
  }, [])

  // 更新当前会话的消息
  const setMessagesSafe = useCallback((updater: (prev: Message[]) => Message[]) => {
    setConversations(prevConvs => {
      const nextConvs = prevConvs.map(conv => {
        if (conv.id !== activeConversationId) return conv
        const nextMessages = updater(conv.messages)
        messagesRef.current = nextMessages
        
        // 如果第一条用户消息且标题是默认的，自动更新标题
        let newTitle = conv.title
        if (conv.title === '新对话' && nextMessages.length > 0) {
          const firstUserMsg = nextMessages.find(m => m.role === 'user')
          if (firstUserMsg) {
            newTitle = generateTitle(firstUserMsg.content)
          }
        }
        
        return {
          ...conv,
          title: newTitle,
          messages: nextMessages,
          updatedAt: new Date()
        }
      })
      persistConversations(nextConvs)
      return nextConvs
    })
  }, [activeConversationId, persistConversations])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    console.log('[Chat] mounted, instance:', instanceIdRef.current)
    return () => {
      console.log('[Chat] unmounted, instance:', instanceIdRef.current)
    }
  }, [])

  // 保存活跃会话 ID
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_CONV_KEY, activeConversationId)
    } catch {}
  }, [activeConversationId])

  // 同步 messagesRef
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 聚焦编辑输入框
  useEffect(() => {
    if (editingConvId && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingConvId])

  const checkGateway = useCallback(async () => {
    try {
      const result = await window.electronAPI?.gateway.status()
      setGatewayOnline(result?.running || false)
    } catch {
      setGatewayOnline(false)
    }
  }, [])

  // 获取 Telegram 会话列表
  const loadTelegramSessions = useCallback(async () => {
    if (!gatewayOnline) return
    setLoadingTelegram(true)
    try {
      const result = await window.electronAPI?.gateway.wsSessions()
      console.log('[Chat] Sessions result:', result)
      if (result?.success && result.sessions) {
        // 过滤出 Telegram 会话 - 检查多个字段
        const telegramOnly = result.sessions.filter((s: TelegramSession) => {
          const key = s.sessionKey || s.key || ''
          return (
            s.lastChannel === 'telegram' ||
            s.channel === 'telegram' || 
            s.deliveryContext?.channel === 'telegram' ||
            key.includes('telegram') ||
            s.origin?.provider === 'telegram'
          )
        }).map((s: TelegramSession) => ({
          ...s,
          sessionKey: s.sessionKey || s.key || s.sessionId  // 确保有 sessionKey
        }))
        console.log('[Chat] Telegram sessions:', telegramOnly)
        // 按更新时间排序
        telegramOnly.sort((a: TelegramSession, b: TelegramSession) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
          return bTime - aTime
        })
        setTelegramSessions(telegramOnly)
      }
    } catch (err) {
      console.error('[Chat] Failed to load telegram sessions:', err)
    }
    setLoadingTelegram(false)
  }, [gatewayOnline])

  // 加载 Telegram 会话的消息历史
  const loadTelegramHistory = useCallback(async (sessionKey: string) => {
    setLoadingHistory(true)
    try {
      const result = await window.electronAPI?.gateway.wsChatHistory(sessionKey, 100)
      if (result?.success && result.messages) {
        // 转换消息格式
        const converted: Message[] = result.messages.map((msg: any, idx: number) => ({
          id: `tg-${sessionKey}-${idx}`,
          role: msg.role || 'user',
          content: typeof msg.content === 'string' 
            ? msg.content 
            : (msg.content?.map((c: any) => c.text || '').join('') || ''),
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          isStreaming: false
        }))
        setTelegramMessages(converted)
      } else {
        setTelegramMessages([])
      }
    } catch (err) {
      console.error('[Chat] Failed to load telegram history:', err)
      setTelegramMessages([])
    }
    setLoadingHistory(false)
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, telegramMessages, scrollToBottom])

  useEffect(() => {
    checkGateway()
    const interval = setInterval(checkGateway, 10000)
    return () => clearInterval(interval)
  }, [checkGateway])

  // Gateway 上线后加载 Telegram 会话
  useEffect(() => {
    if (gatewayOnline) {
      loadTelegramSessions()
    }
  }, [gatewayOnline, loadTelegramSessions])

  // 组件卸载时保存正在生成的内容，避免切页丢失
  useEffect(() => {
    return () => {
      if (!activeConversation) return
      const current = messagesRef.current
      if (!current || current.length === 0) return
      
      const saved = current.map(msg => {
        if (!msg.isStreaming) return msg
        const content = msg.content || contentBufferRef.current || '(生成中...)'
        return { ...msg, content, isStreaming: false }
      })
      
      const convs = conversations.map(conv => 
        conv.id === activeConversationId ? { ...conv, messages: saved } : conv
      )
      try {
        localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs))
      } catch {}
    }
  }, [activeConversation, activeConversationId, conversations])

  // 保存设置
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {}
  }, [settings])

  // 监听 WebSocket 事件 - 核心流式输出
  useEffect(() => {
    // 判断是否是当前会话的事件
    const isCurrentSession = (sessionKey: string) => {
      // 如果当前选中的是 Telegram 会话
      if (activeTelegramSession) {
        return sessionKey === activeTelegramSession
      }
      return sessionKey === activeConversationId
    }
    
    // 更新消息的帮助函数
    const updateMessages = (updater: (prev: Message[]) => Message[]) => {
      if (activeTelegramSession) {
        setTelegramMessages(updater)
      } else {
        setMessagesSafe(updater)
      }
    }
    
    // Chat 事件处理
    const unsubChat = window.electronAPI?.gateway.onChatEvent((_: unknown, payload: ChatEventPayload) => {
      // 只处理当前会话的事件
      if (!isCurrentSession(payload.sessionKey)) return
      
      const { state, message, errorMessage } = payload

      if (state === 'delta') {
        // 增量更新 - 从 message.content 提取文本
        if (message?.content) {
          const textContent = message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '')
            .join('')
          
          // 解析 <think> 标签
          const { content, thinking } = parseThinkingBlocks(textContent, thinkingBufferRef.current)
          contentBufferRef.current = content
          thinkingBufferRef.current = thinking
          
          // 更新消息
          const targetId = streamingMessageIdRef.current
          if (targetId) {
            updateMessages(prev => prev.map(msg => 
              msg.id === targetId
                ? { 
                    ...msg, 
                    content: contentBufferRef.current,
                    thinking: thinkingBufferRef.current.length > 0 ? thinkingBufferRef.current : undefined
                  }
                : msg
            ))
          }
        }
      } else if (state === 'final') {
        // 完成
        const targetId = streamingMessageIdRef.current
        if (message?.content) {
          const textContent = message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '')
            .join('')
          
          const { content, thinking } = parseThinkingBlocks(textContent, [])
          
          if (targetId) {
            updateMessages(prev => prev.map(msg => 
              msg.id === targetId
                ? { 
                    ...msg, 
                    content: content || contentBufferRef.current,
                    thinking: thinking.length > 0 ? thinking : thinkingBufferRef.current,
                    isStreaming: false
                  }
                : msg
            ))
          }
        } else if (targetId) {
          updateMessages(prev => prev.map(msg => 
            msg.id === targetId
              ? { ...msg, isStreaming: false }
              : msg
          ))
        }
        
        setIsStreaming(false)
        streamingMessageRef.current = null
        streamingMessageIdRef.current = null
        currentRunIdRef.current = null
        contentBufferRef.current = ''
        thinkingBufferRef.current = []
      } else if (state === 'aborted') {
        // 中止
        const targetId = streamingMessageIdRef.current
        if (targetId) {
          updateMessages(prev => prev.map(msg => 
            msg.id === targetId
              ? { ...msg, isStreaming: false, content: msg.content || '(已停止)' }
              : msg
          ))
        }
        setIsStreaming(false)
        streamingMessageRef.current = null
        streamingMessageIdRef.current = null
        currentRunIdRef.current = null
        contentBufferRef.current = ''
        thinkingBufferRef.current = []
      } else if (state === 'error') {
        // 错误
        const targetId = streamingMessageIdRef.current
        if (targetId) {
          updateMessages(prev => prev.map(msg => 
            msg.id === targetId
              ? { 
                  ...msg, 
                  isStreaming: false, 
                  error: errorMessage || '发生错误',
                  content: msg.content || `错误: ${errorMessage || '未知错误'}`
                }
              : msg
          ))
        }
        setIsStreaming(false)
        streamingMessageRef.current = null
        streamingMessageIdRef.current = null
        currentRunIdRef.current = null
        contentBufferRef.current = ''
        thinkingBufferRef.current = []
      }
    })

    // Agent 事件处理 (思考过程、工具调用等)
    const unsubAgent = window.electronAPI?.gateway.onAgentEvent((_: unknown, payload: AgentEventPayload) => {
      if (!isCurrentSession(payload.sessionKey || '')) return
      
      const { stream, data } = payload
      
      // 处理思考过程
      if (stream === 'assistant' && data.thinking) {
        const thinkingText = String(data.thinking)
        if (thinkingText.trim()) {
          thinkingBufferRef.current = [...thinkingBufferRef.current, {
            id: `think-${Date.now()}-${thinkingBufferRef.current.length}`,
            content: thinkingText,
            collapsed: false
          }]
          
          const targetId = streamingMessageIdRef.current
          if (targetId) {
            updateMessages(prev => prev.map(msg => 
              msg.id === targetId
                ? { ...msg, thinking: thinkingBufferRef.current }
                : msg
            ))
          }
        }
      }
      
      // 处理工具调用
      if (stream === 'tool') {
        // TODO: 处理工具调用事件
      }
    })

    return () => {
      unsubChat?.()
      unsubAgent?.()
    }
  }, [activeConversationId, activeTelegramSession, setMessagesSafe])

  // 解析思考块
  const parseThinkingBlocks = (text: string, existing: ThinkingBlock[]): { content: string; thinking: ThinkingBlock[] } => {
    const thinking = [...existing]
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
        const thinkContent = remaining.slice(0, thinkEnd).trim()
        if (thinkContent) {
          thinking.push({
            id: `think-${Date.now()}-${thinking.length}`,
            content: thinkContent,
            collapsed: false
          })
        }
        remaining = remaining.slice(thinkEnd + 8)
      } else {
        // 未完成的思考块，暂时不处理
        break
      }
    }
    
    return { content, thinking }
  }

  // 复制消息内容
  const copyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {}
  }

  // 切换思考块折叠状态
  const toggleThinking = (messageId: string, thinkingId: string) => {
    setMessagesSafe(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg
      return {
        ...msg,
        thinking: msg.thinking?.map(t => 
          t.id === thinkingId ? { ...t, collapsed: !t.collapsed } : t
        )
      }
    }))
  }

  // 切换工具调用折叠状态
  const toggleTool = (messageId: string, toolId: string) => {
    setMessagesSafe(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg
      return {
        ...msg,
        tools: msg.tools?.map(t => 
          t.id === toolId ? { ...t, collapsed: !t.collapsed } : t
        )
      }
    }))
  }

  // 新建对话
  const createConversation = () => {
    const newConv = createNewConversation()
    setConversations(prev => {
      const next = [newConv, ...prev]
      persistConversations(next)
      return next
    })
    setActiveConversationId(newConv.id)
    setIsStreaming(false)
    streamingMessageRef.current = null
    streamingMessageIdRef.current = null
    currentRunIdRef.current = null
    contentBufferRef.current = ''
    thinkingBufferRef.current = []
  }

  // 切换会话
  const switchConversation = (convId: string) => {
    if (convId === activeConversationId) return
    // 如果正在流式输出，先停止
    if (isStreaming) {
      stopGeneration()
    }
    setActiveConversationId(convId)
    setShowConvMenu(null)
  }

  // 删除会话
  const deleteConversation = (convId: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== convId)
      // 如果删除的是当前会话，切换到第一个或创建新会话
      if (convId === activeConversationId) {
        if (next.length > 0) {
          setActiveConversationId(next[0].id)
        } else {
          const newConv = createNewConversation()
          next.push(newConv)
          setActiveConversationId(newConv.id)
        }
      }
      persistConversations(next)
      return next
    })
    setShowConvMenu(null)
  }

  // 开始编辑会话标题
  const startEditTitle = (convId: string, currentTitle: string) => {
    setEditingConvId(convId)
    setEditingTitle(currentTitle)
    setShowConvMenu(null)
  }

  // 保存会话标题
  const saveTitle = () => {
    if (!editingConvId || !editingTitle.trim()) {
      setEditingConvId(null)
      return
    }
    setConversations(prev => {
      const next = prev.map(c => 
        c.id === editingConvId ? { ...c, title: editingTitle.trim() } : c
      )
      persistConversations(next)
      return next
    })
    setEditingConvId(null)
  }

  // 清空当前对话
  const clearChat = async () => {
    if (isStreaming) {
      await window.electronAPI?.gateway.wsChatAbort(activeConversationId, currentRunIdRef.current || undefined)
    }
    setMessagesSafe(() => [])
    setIsStreaming(false)
    streamingMessageRef.current = null
    streamingMessageIdRef.current = null
    currentRunIdRef.current = null
    contentBufferRef.current = ''
    thinkingBufferRef.current = []
  }

  // 停止生成
  const stopGeneration = async () => {
    // 使用 WebSocket API 中止
    await window.electronAPI?.gateway.wsChatAbort(activeConversationId, currentRunIdRef.current || undefined)
    setIsStreaming(false)
    
    // 标记当前流式消息为完成
    const targetId = streamingMessageIdRef.current
    if (targetId) {
      setMessagesSafe(prev => prev.map(msg => 
        msg.id === targetId
          ? { ...msg, isStreaming: false, content: msg.content || '(已停止生成)' }
          : msg
      ))
      streamingMessageRef.current = null
      streamingMessageIdRef.current = null
      currentRunIdRef.current = null
      contentBufferRef.current = ''
      thinkingBufferRef.current = []
    }
  }

  // 发送消息 - 使用 WebSocket 实时通信
  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return
    if (!gatewayOnline) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: '请先启动 Gateway 服务',
        timestamp: new Date(),
        error: 'Gateway 未运行'
      }
      if (activeTelegramSession) {
        setTelegramMessages(prev => [...prev, errorMsg])
      } else {
        setMessagesSafe(prev => [...prev, errorMsg])
      }
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    }

    const assistantMessageId = (Date.now() + 1).toString()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      thinking: [],
      tools: [],
      isStreaming: true
    }
    
    // 确定当前 sessionKey
    const sessionKey = activeTelegramSession || activeConversationId

    // 添加消息到对应列表
    if (activeTelegramSession) {
      setTelegramMessages(prev => [...prev, userMessage, assistantMessage])
    } else {
      setMessagesSafe(prev => [...prev, userMessage, assistantMessage])
    }
    
    setInput('')
    setIsStreaming(true)
    streamingMessageRef.current = assistantMessage
    streamingMessageIdRef.current = assistantMessageId
    currentRunIdRef.current = null

    try {
      // 使用 WebSocket API 发送消息
      const result = await window.electronAPI?.gateway.wsChatSend({
        sessionKey,
        message: userMessage.content,
      })

      if (!result?.success) {
        throw new Error(result?.error || '发送失败')
      }

      // 记录 runId 用于匹配事件
      currentRunIdRef.current = result.runId
      
    } catch (error: any) {
      // 更新错误状态
      const updateError = (prev: Message[]) => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { 
              ...msg, 
              isStreaming: false, 
              error: error.message || '发送失败',
              content: `发送失败: ${error.message || '未知错误'}`
            }
          : msg
      )
      
      if (activeTelegramSession) {
        setTelegramMessages(updateError)
      } else {
        setMessagesSafe(updateError)
      }
      
      setIsStreaming(false)
      streamingMessageRef.current = null
      streamingMessageIdRef.current = null
      currentRunIdRef.current = null
      contentBufferRef.current = ''
      thinkingBufferRef.current = []
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 渲染思考块
  const renderThinking = (messageId: string, thinking: ThinkingBlock[]) => {
    if (!settings.showThinking || thinking.length === 0) return null
    
    return (
      <div className="thinking-blocks">
        {thinking.map(block => (
          <div key={block.id} className="thinking-block">
            <div 
              className="thinking-header"
              onClick={() => toggleThinking(messageId, block.id)}
            >
              {block.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <Brain size={14} />
              <span>思考过程</span>
            </div>
            {!block.collapsed && (
              <div className="thinking-content">
                <pre>{block.content}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // 渲染工具调用
  const renderTools = (messageId: string, tools: ToolCall[]) => {
    if (!tools || tools.length === 0) return null
    
    return (
      <div className="tool-calls">
        {tools.map(tool => (
          <div key={tool.id} className={`tool-call ${tool.status}`}>
            <div 
              className="tool-header"
              onClick={() => toggleTool(messageId, tool.id)}
            >
              {tool.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <Wrench size={14} />
              <span className="tool-name">{tool.name}</span>
              <span className={`tool-status ${tool.status}`}>
                {tool.status === 'running' && <Loader2 size={12} className="spin" />}
                {tool.status === 'success' && <Check size={12} />}
                {tool.status === 'error' && <AlertCircle size={12} />}
              </span>
            </div>
            {!tool.collapsed && (
              <div className="tool-details">
                {tool.input && (
                  <div className="tool-input">
                    <span className="label">输入:</span>
                    <pre>{tool.input}</pre>
                  </div>
                )}
                {tool.output && (
                  <div className="tool-output">
                    <span className="label">输出:</span>
                    <pre>{tool.output}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // 渲染消息内容 (支持代码块)
  const renderContent = (content: string) => {
    if (!content) return null
    
    // 简单的代码块处理
    const parts = content.split(/(```[\s\S]*?```)/g)
    
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(\w*)\n?([\s\S]*?)```/)
        if (match) {
          const [, lang, code] = match
          return (
            <pre key={i} className="code-block" data-lang={lang || 'text'}>
              <code>{code.trim()}</code>
            </pre>
          )
        }
      }
      // 处理行内代码
      const inlineProcessed = part.split(/(`[^`]+`)/g).map((segment, j) => {
        if (segment.startsWith('`') && segment.endsWith('`')) {
          return <code key={j} className="inline-code">{segment.slice(1, -1)}</code>
        }
        return segment
      })
      return <span key={i}>{inlineProcessed}</span>
    })
  }

  // 格式化时间
  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    } else if (days === 1) {
      return '昨天'
    } else if (days < 7) {
      return `${days}天前`
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    }
  }

  // 获取当前显示的消息列表
  const currentMessages = activeTelegramSession ? telegramMessages : messages
  
  // 获取当前会话标题
  const getCurrentTitle = () => {
    if (activeTelegramSession) {
      return 'Telegram 同步'
    }
    return activeConversation?.title || '对话'
  }
  
  // 切换本地会话时清除 Telegram 选中状态
  const handleSwitchLocalConversation = (convId: string) => {
    setActiveTelegramSession(null)  // 清除 Telegram 选中
    switchConversation(convId)
  }
  
  
  // 切换到 Telegram 同步 - 合并所有 Telegram 会话的消息
  const handleSwitchToTelegram = async () => {
    console.log('[Chat] handleSwitchToTelegram called, sessions:', telegramSessions)
    if (telegramSessions.length === 0) {
      console.log('[Chat] No telegram sessions')
      return
    }
    
    // 用第一个会话的 key 作为标识
    const primarySession = telegramSessions[0]
    console.log('[Chat] Primary session:', primarySession)
    setActiveTelegramSession(primarySession.sessionKey)
    setLoadingHistory(true)
    
    try {
      // 加载所有 Telegram 会话的消息并合并
      const allMessages: Message[] = []
      
      for (const session of telegramSessions) {
        console.log('[Chat] Loading history for:', session.sessionKey)
        const result = await window.electronAPI?.gateway.wsChatHistory(session.sessionKey, 200)
        console.log('[Chat] History result:', result)
        if (result?.success && result.messages) {
          const converted: Message[] = result.messages
            .filter((msg: any) => {
              // 只保留 user 和 assistant 消息，过滤 toolResult/toolCall 等
              const role = msg.role || msg.message?.role
              return role === 'user' || role === 'assistant'
            })
            .map((msg: any, idx: number) => {
              // 支持两种格式: 直接的 msg 或 msg.message
              const msgData = msg.message || msg
              const role = msgData.role
              
              // 提取文本内容
              let content = ''
              if (typeof msgData.content === 'string') {
                content = msgData.content
              } else if (Array.isArray(msgData.content)) {
                content = msgData.content
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text || '')
                  .join('')
              }
              
              // 如果是 Telegram 用户消息，去掉前缀 [Telegram xxx]
              if (role === 'user') {
                // 匹配并移除 [Telegram ...] 前缀
                const prefixMatch = content.match(/^\[Telegram[^\]]*\]\s*/)
                if (prefixMatch) {
                  content = content.slice(prefixMatch[0].length)
                }
                // 移除末尾的 [message_id: xxx]
                content = content.replace(/\n?\[message_id:\s*\d+\]\s*$/, '')
              }
              
              return {
                id: `tg-${session.sessionKey}-${idx}`,
                role: role === 'user' ? 'user' : 'assistant' as const,
                content,
                timestamp: msgData.timestamp ? new Date(msgData.timestamp) : (msg.timestamp ? new Date(msg.timestamp) : new Date()),
                isStreaming: false
              }
            })
            .filter((msg: Message) => msg.content.trim())  // 过滤空消息
          console.log('[Chat] Converted messages:', converted.length)
          allMessages.push(...converted)
        }
      }
      
      console.log('[Chat] Total messages:', allMessages.length)
      // 按时间排序
      allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      setTelegramMessages(allMessages)
    } catch (err) {
      console.error('[Chat] Failed to load telegram messages:', err)
      setTelegramMessages([])
    }
    setLoadingHistory(false)
  }

  return (
    <div className="chat-page-v2">
      {/* 左侧会话列表 */}
      <div className="conversation-list">
        {/* 本地对话 */}
        <div className="conversation-list-header">
          <span className="conv-list-title">对话</span>
          <button className="new-conv-btn" onClick={createConversation} title="新建对话">
            <Plus size={18} />
          </button>
        </div>
        <div className="conversation-items">
          {/* 本地对话列表 */}
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`conversation-item ${conv.id === activeConversationId && !activeTelegramSession ? 'active' : ''}`}
              onClick={() => handleSwitchLocalConversation(conv.id)}
            >
              <div className="conv-icon">
                <MessageCircle size={18} />
              </div>
              <div className="conv-content">
                {editingConvId === conv.id ? (
                  <input
                    ref={editInputRef}
                    className="conv-title-input"
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveTitle()
                      if (e.key === 'Escape') setEditingConvId(null)
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="conv-title">{conv.title}</span>
                    <span className="conv-time">{formatTime(conv.updatedAt)}</span>
                  </>
                )}
              </div>
              <div className="conv-actions">
                <button 
                  className="conv-menu-btn"
                  onClick={e => {
                    e.stopPropagation()
                    setShowConvMenu(showConvMenu === conv.id ? null : conv.id)
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
                {showConvMenu === conv.id && (
                  <div className="conv-menu">
                    <button onClick={e => { e.stopPropagation(); startEditTitle(conv.id, conv.title) }}>
                      <Edit2 size={14} /> 重命名
                    </button>
                    <button 
                      className="danger"
                      onClick={e => { e.stopPropagation(); deleteConversation(conv.id) }}
                    >
                      <Trash2 size={14} /> 删除
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {/* Telegram 同步入口 - 单一条目 */}
          {gatewayOnline && telegramSessions.length > 0 && (
            <div
              className={`conversation-item telegram ${activeTelegramSession ? 'active' : ''}`}
              onClick={handleSwitchToTelegram}
            >
              <div className="conv-icon telegram-icon">
                📱
              </div>
              <div className="conv-content">
                <span className="conv-title">Telegram 同步</span>
                <span className="conv-time">
                  {telegramSessions[0]?.updatedAt ? formatTime(new Date(telegramSessions[0].updatedAt)) : ''}
                </span>
              </div>
              {loadingTelegram && <Loader2 size={14} className="spin" />}
            </div>
          )}
        </div>
      </div>

      {/* 右侧聊天区域 */}
      <div className="chat-main">
        {/* 头部 */}
        <div className="chat-header-v2">
          <div className="chat-info">
            {activeTelegramSession ? <span className="tg-badge">✈️</span> : <MessageSquare size={20} />}
            <span className="chat-title">{getCurrentTitle()}</span>
            <span className={`gateway-badge ${gatewayOnline ? 'online' : 'offline'}`}>
              <span className="status-dot"></span>
              {gatewayOnline ? '已连接' : '未连接'}
            </span>
          </div>
          <div className="chat-actions">
            {activeTelegramSession && (
              <button 
                className="icon-btn" 
                onClick={() => loadTelegramHistory(activeTelegramSession)}
                title="刷新消息"
                disabled={loadingHistory}
              >
                <RefreshCw size={18} className={loadingHistory ? 'spin' : ''} />
              </button>
            )}
            <button 
              className="icon-btn" 
              onClick={() => setShowSettings(!showSettings)}
              title="设置"
            >
              <Settings2 size={18} />
            </button>
            {!activeTelegramSession && (
              <button 
                className="icon-btn" 
                onClick={clearChat}
                title="清空当前对话"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>

        {/* 设置面板 */}
        {showSettings && (
          <div className="chat-settings-panel">
            <div className="setting-row">
              <label>显示思考过程</label>
              <label className="toggle-switch small">
                <input 
                  type="checkbox" 
                  checked={settings.showThinking}
                  onChange={e => setSettings(s => ({ ...s, showThinking: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        )}

        {/* Gateway 警告 */}
        {!gatewayOnline && (
          <div className="gateway-warning">
            <AlertCircle size={16} />
            <span>Gateway 未运行，请先在仪表盘启动服务</span>
          </div>
        )}

        {/* 消息列表 */}
        <div className="messages-container-v2">
        {loadingHistory ? (
          <div className="empty-chat-v2">
            <Loader2 size={32} className="spin" />
            <p>加载消息中...</p>
          </div>
        ) : currentMessages.length === 0 ? (
          <div className="empty-chat-v2">
            <span className="chat-logo">{activeTelegramSession ? '✈️' : '🦞'}</span>
            <h3>{activeTelegramSession ? '选择一个对话' : '开始对话'}</h3>
            <p>{activeTelegramSession 
              ? '点击左侧 Telegram 会话查看聊天记录'
              : '发送消息与 moltBOT 交互'
            }</p>
            {!activeTelegramSession && (
              <div className="quick-prompts">
                <button onClick={() => setInput('你好，介绍一下你自己')}>
                  👋 自我介绍
                </button>
                <button onClick={() => setInput('帮我写一个 Python 脚本')}>
                  💻 写代码
                </button>
                <button onClick={() => setInput('今天的天气怎么样？')}>
                  🌤️ 查天气
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="messages-list-v2">
            {currentMessages.map(msg => (
              <div 
                key={msg.id} 
                className={`message-v2 ${msg.role} ${msg.error ? 'error' : ''} ${msg.isStreaming ? 'streaming' : ''}`}
              >
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : msg.role === 'system' ? '⚠️' : '🦞'}
                </div>
                <div className="message-body">
                  {/* 思考过程 */}
                  {msg.thinking && renderThinking(msg.id, msg.thinking)}
                  
                  {/* 工具调用 */}
                  {msg.tools && renderTools(msg.id, msg.tools)}
                  
                  {/* 消息内容 */}
                  <div className="message-content-v2">
                    {renderContent(msg.content)}
                    {msg.isStreaming && (
                      <span className="typing-cursor">▊</span>
                    )}
                  </div>
                  
                  {/* 消息元信息 */}
                  <div className="message-meta">
                    <span className="message-time">
                      {msg.timestamp.toLocaleTimeString()}
                    </span>
                    {msg.role === 'assistant' && !msg.isStreaming && !msg.error && (
                      <button 
                        className="copy-btn"
                        onClick={() => copyMessage(msg.id, msg.content)}
                        title="复制"
                      >
                        {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="input-container-v2">
        {isStreaming && (
          <button className="stop-btn" onClick={stopGeneration}>
            <StopCircle size={14} />
            停止生成
          </button>
        )}
        <div className="input-wrapper-v2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={gatewayOnline ? "输入消息... (Enter 发送, Shift+Enter 换行)" : "请先启动 Gateway..."}
            rows={1}
            disabled={isStreaming || !gatewayOnline}
          />
          <button 
            className="send-btn-v2"
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming || !gatewayOnline}
          >
            {isStreaming ? (
              <Loader2 size={20} className="spin" />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
        <div className="input-hint">
          <span>Shift + Enter 换行</span>
          <span>•</span>
          <span>{messages.length} 条消息</span>
        </div>
      </div>
      </div>{/* 结束 chat-main */}
    </div>
  )
}
