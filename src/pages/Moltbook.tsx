import { useState, useEffect, useRef } from 'react'
import { Globe, Play, Square, RefreshCw, Trash2, Settings, Info, Terminal, Target, Clock, Zap, AlertTriangle, CheckCircle, XCircle, Send, Eye, Bot, MessageSquare, Heart, Users, FileText } from 'lucide-react'
import './Moltbook.css'

interface AgentConfig {
  enabled: boolean
  goal: string
  loopInterval: number  // 秒
  maxIterations: number // 0 = 无限
  autoPost: boolean
  MoltbookUrl: string
  targetChannel: string
}

interface AgentLog {
  id: string
  timestamp: string
  type: 'info' | 'action' | 'thought' | 'success' | 'error' | 'post' | 'interaction'
  message: string
  details?: string
}

interface AgentPost {
  id: string
  timestamp: string
  content: string
  status: 'pending' | 'sent' | 'failed'
  iteration: number
  platform?: string
}

interface AgentInteraction {
  id: string
  timestamp: string
  type: 'browse' | 'like' | 'comment' | 'reply' | 'follow'
  target?: string
  content?: string
  iteration: number
}

interface AgentStatus {
  running: boolean
  iteration: number
  lastAction: string
  startTime: number | null
  tokensUsed: number
  totalPosts: number
  totalInteractions: number
}

const DEFAULT_CONFIG: AgentConfig = {
  enabled: false,
  goal: '浏览 Moltbook，与其他 AI 互动，发表有趣的见解',
  loopInterval: 300, // 5分钟
  maxIterations: 0,
  autoPost: true,
  MoltbookUrl: 'https://Moltbook.fun',
  targetChannel: 'telegram'
}

const INTERVAL_OPTIONS = [
  { value: 60, label: '1 分钟' },
  { value: 180, label: '3 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
  { value: 900, label: '15 分钟' },
  { value: 1800, label: '30 分钟' },
]

const Moltbook_CACHE_KEY = 'Moltbook_cache'

function loadMoltbookCache() {
  try {
    const cached = localStorage.getItem(Moltbook_CACHE_KEY)
    if (cached) return JSON.parse(cached)
  } catch {}
  return null
}

function saveMoltbookCache(config: AgentConfig) {
  try {
    localStorage.setItem(Moltbook_CACHE_KEY, JSON.stringify({ config, timestamp: Date.now() }))
  } catch {}
}

export default function Moltbook() {
  const cached = loadMoltbookCache()
  const [config, setConfig] = useState<AgentConfig>(cached?.config || DEFAULT_CONFIG)
  const [status, setStatus] = useState<AgentStatus>({
    running: false,
    iteration: 0,
    lastAction: '',
    startTime: null,
    tokensUsed: 0,
    totalPosts: 0,
    totalInteractions: 0
  })
  const [logs, setLogs] = useState<AgentLog[]>([])
  const [posts, setPosts] = useState<AgentPost[]>([])
  const [interactions, setInteractions] = useState<AgentInteraction[]>([])
  const [loading, setLoading] = useState(!cached)
  const [starting, setStarting] = useState(false)
  const [gatewayRunning, setGatewayRunning] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [editConfig, setEditConfig] = useState<AgentConfig>(cached?.config || DEFAULT_CONFIG)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [activeTab, setActiveTab] = useState<'logs' | 'posts' | 'interactions'>('logs')
  const logsEndRef = useRef<HTMLDivElement>(null)
  
  const electronAPI = (window as any).electronAPI

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  // 格式化运行时间
  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) return `${hours}时 ${minutes % 60}分`
    if (minutes > 0) return `${minutes}分 ${seconds % 60}秒`
    return `${seconds}秒`
  }

  // 加载配置和状态
  const loadData = async () => {
    setLoading(true)
    try {
      // 检查 Gateway 状态
      const gwStatus = await electronAPI?.gateway.status()
      setGatewayRunning(gwStatus?.running || false)
      
      // 加载 Agent 配置
      const configResult = await electronAPI?.Moltbook?.getConfig()
      if (configResult?.success) {
        setConfig(configResult.config)
        setEditConfig(configResult.config)
        saveMoltbookCache(configResult.config)
      }
      
      // 加载 Agent 状态
      const statusResult = await electronAPI?.Moltbook?.getStatus()
      if (statusResult?.success) {
        setStatus(statusResult.status)
      }
      
      // 加载日志
      const logsResult = await electronAPI?.Moltbook?.getLogs()
      if (logsResult?.success) {
        setLogs(logsResult.logs)
      }
      
      // 加载发帖记录
      const postsResult = await electronAPI?.Moltbook?.getPosts()
      if (postsResult?.success) {
        setPosts(postsResult.posts)
      }
      
      // 加载互动记录
      const interactionsResult = await electronAPI?.Moltbook?.getInteractions()
      if (interactionsResult?.success) {
        setInteractions(interactionsResult.interactions)
      }
    } catch (e) {
      console.error('Failed to load Moltbook data:', e)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    
    // 定期刷新状态和日志
    const interval = setInterval(async () => {
      try {
        const gwStatus = await electronAPI?.gateway.status()
        setGatewayRunning(gwStatus?.running || false)
        
        const statusResult = await electronAPI?.Moltbook?.getStatus()
        if (statusResult?.success) {
          setStatus(statusResult.status)
        }
        
        const logsResult = await electronAPI?.Moltbook?.getLogs()
        if (logsResult?.success) {
          setLogs(logsResult.logs)
        }
        
        const postsResult = await electronAPI?.Moltbook?.getPosts()
        if (postsResult?.success) {
          setPosts(postsResult.posts)
        }
        
        const interactionsResult = await electronAPI?.Moltbook?.getInteractions()
        if (interactionsResult?.success) {
          setInteractions(interactionsResult.interactions)
        }
      } catch {}
    }, 3000)
    
    return () => clearInterval(interval)
  }, [])

  // 自动滚动日志
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // 启动 Agent
  const startAgent = async () => {
    if (!gatewayRunning) {
      showMessage('error', 'Gateway 未运行，请先启动 Gateway')
      return
    }
    
    setStarting(true)
    try {
      const result = await electronAPI?.Moltbook?.start(config)
      if (result?.success) {
        setStatus(prev => ({ ...prev, running: true, startTime: Date.now() }))
        showMessage('success', '自主 Agent 已启动！')
      } else {
        showMessage('error', result?.error || '启动失败')
      }
    } catch (e: any) {
      showMessage('error', e?.message || '启动失败')
    }
    setStarting(false)
  }

  // 停止 Agent
  const stopAgent = async () => {
    try {
      const result = await electronAPI?.Moltbook?.stop()
      if (result?.success) {
        setStatus(prev => ({ ...prev, running: false }))
        showMessage('success', 'Agent 已停止')
      }
    } catch (e: any) {
      showMessage('error', e?.message || '停止失败')
    }
  }

  // 保存配置
  const saveConfig = async () => {
    try {
      const result = await electronAPI?.Moltbook?.updateConfig(editConfig)
      if (result?.success) {
        setConfig(editConfig)
        setShowConfigModal(false)
        showMessage('success', '配置已保存')
      } else {
        showMessage('error', result?.error || '保存失败')
      }
    } catch (e: any) {
      showMessage('error', e?.message || '保存失败')
    }
  }

  // 清除所有记录
  const clearAll = async () => {
    try {
      await electronAPI?.Moltbook?.clearAll()
      setLogs([])
      setPosts([])
      setInteractions([])
      showMessage('success', '所有记录已清空')
    } catch {}
  }

  // 获取日志图标
  const getLogIcon = (type: AgentLog['type']) => {
    switch (type) {
      case 'thought': return <Bot size={14} />
      case 'action': return <Zap size={14} />
      case 'success': return <CheckCircle size={14} />
      case 'error': return <XCircle size={14} />
      case 'post': return <Send size={14} />
      case 'interaction': return <Heart size={14} />
      default: return <Info size={14} />
    }
  }

  // 获取互动类型图标
  const getInteractionIcon = (type: AgentInteraction['type']) => {
    switch (type) {
      case 'browse': return <Eye size={14} />
      case 'like': return <Heart size={14} />
      case 'comment': return <MessageSquare size={14} />
      case 'reply': return <Send size={14} />
      case 'follow': return <Users size={14} />
      default: return <Eye size={14} />
    }
  }

  // 获取互动类型文本
  const getInteractionText = (type: AgentInteraction['type']) => {
    switch (type) {
      case 'browse': return '浏览'
      case 'like': return '点赞'
      case 'comment': return '评论'
      case 'reply': return '回复'
      case 'follow': return '关注'
      default: return '互动'
    }
  }

  // 格式化时间
  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="page Moltbook-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page Moltbook-page">
      <div className="page-header">
        <h2><Globe size={24} /> Moltbook 自主 Agent</h2>
        <div className="header-actions">
          <button className="btn-icon" onClick={loadData} title="刷新">
            <RefreshCw size={18} />
          </button>
          <button className="btn-icon" onClick={() => {
            setEditConfig(config)
            setShowConfigModal(true)
          }} title="设置">
            <Settings size={18} />
          </button>
        </div>
      </div>

      {message && (
        <div className={`message-toast ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 说明卡片 */}
      <div className="info-card">
        <Info size={18} />
        <div className="info-content">
          <strong>什么是 Moltbook 自主 Agent？</strong>
          <p>
            Moltbook 是 AI 专属的社交网络。启用自主 Agent 后，你的 AI 将持续运行，
            自主思考、规划任务、在 Moltbook 上发帖互动——就像一个有自主意识的机器人。
            你可以在这里实时监控 AI 的所有行为。
          </p>
        </div>
      </div>

      {/* 状态面板 */}
      <div className="status-panel">
        <div className={`agent-status ${status.running ? 'running' : 'stopped'}`}>
          <div className="status-indicator">
            <span className={`pulse ${status.running ? 'active' : ''}`}></span>
            <span className="status-text">{status.running ? '运行中' : '已停止'}</span>
          </div>
          
          <div className="status-stats">
            {status.running && status.startTime && (
              <div className="stat">
                <Clock size={14} />
                <span>运行 {formatUptime(Date.now() - status.startTime)}</span>
              </div>
            )}
            <div className="stat">
              <Zap size={14} />
              <span>迭代 {status.iteration} 次</span>
            </div>
            <div className="stat">
              <FileText size={14} />
              <span>发帖 {status.totalPosts} 篇</span>
            </div>
            <div className="stat">
              <Heart size={14} />
              <span>互动 {status.totalInteractions} 次</span>
            </div>
          </div>

          <div className="control-buttons">
            {status.running ? (
              <button className="btn btn-danger" onClick={stopAgent}>
                <Square size={16} /> 停止 Agent
              </button>
            ) : (
              <button 
                className="btn btn-primary btn-large" 
                onClick={startAgent}
                disabled={starting || !gatewayRunning}
              >
                <Play size={16} /> {starting ? '启动中...' : '一键部署'}
              </button>
            )}
          </div>
        </div>

        {!gatewayRunning && (
          <div className="gateway-warning">
            <AlertTriangle size={16} />
            <span>Gateway 未运行，请先在仪表盘启动 Gateway</span>
          </div>
        )}
      </div>

      {/* 当前目标 */}
      <div className="card goal-card">
        <div className="card-header">
          <h3><Target size={18} /> 当前目标</h3>
        </div>
        <div className="goal-content">
          <p>{config.goal}</p>
          <div className="goal-meta">
            <span>循环间隔: {INTERVAL_OPTIONS.find(o => o.value === config.loopInterval)?.label || `${config.loopInterval}秒`}</span>
            <span>自动发帖: {config.autoPost ? '开启' : '关闭'}</span>
            {config.maxIterations > 0 && <span>最大迭代: {config.maxIterations}次</span>}
          </div>
        </div>
      </div>

      {/* 记录面板 */}
      <div className="card records-card">
        <div className="card-header">
          <div className="tabs-header">
            <button 
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <Terminal size={16} /> 实时日志
              <span className="tab-count">{logs.length}</span>
            </button>
            <button 
              className={`tab-btn ${activeTab === 'posts' ? 'active' : ''}`}
              onClick={() => setActiveTab('posts')}
            >
              <FileText size={16} /> 发帖记录
              <span className="tab-count">{posts.length}</span>
            </button>
            <button 
              className={`tab-btn ${activeTab === 'interactions' ? 'active' : ''}`}
              onClick={() => setActiveTab('interactions')}
            >
              <Heart size={16} /> 互动记录
              <span className="tab-count">{interactions.length}</span>
            </button>
          </div>
          <button className="btn btn-secondary btn-small" onClick={clearAll}>
            <Trash2 size={14} /> 清空全部
          </button>
        </div>
        
        {/* 实时日志 Tab */}
        {activeTab === 'logs' && (
          <div className="logs-container">
            {logs.length === 0 ? (
              <div className="logs-empty">
                <Eye size={48} strokeWidth={1} />
                <p>暂无日志</p>
                <span>启动 Agent 后，这里会显示 AI 的所有行为</span>
              </div>
            ) : (
              <div className="logs-list">
                {logs.map(log => (
                  <div key={log.id} className={`log-item log-${log.type}`}>
                    <span className="log-time">{log.timestamp}</span>
                    <span className="log-icon">{getLogIcon(log.type)}</span>
                    <span className="log-message">{log.message}</span>
                    {log.details && (
                      <div className="log-details">{log.details}</div>
                    )}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}
        
        {/* 发帖记录 Tab */}
        {activeTab === 'posts' && (
          <div className="posts-container">
            {posts.length === 0 ? (
              <div className="logs-empty">
                <FileText size={48} strokeWidth={1} />
                <p>暂无发帖记录</p>
                <span>Agent 发布的内容会显示在这里</span>
              </div>
            ) : (
              <div className="posts-list">
                {posts.map(post => (
                  <div key={post.id} className={`post-item post-${post.status}`}>
                    <div className="post-header">
                      <span className="post-time">{formatTime(post.timestamp)}</span>
                      <span className="post-platform">{post.platform || 'Moltbook'}</span>
                      <span className={`post-status ${post.status}`}>
                        {post.status === 'sent' ? '✓ 已发送' : post.status === 'pending' ? '• 待发送' : '× 失败'}
                      </span>
                    </div>
                    <div className="post-content">{post.content}</div>
                    <div className="post-meta">
                      <span>第 {post.iteration} 次迭代</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* 互动记录 Tab */}
        {activeTab === 'interactions' && (
          <div className="interactions-container">
            {interactions.length === 0 ? (
              <div className="logs-empty">
                <Heart size={48} strokeWidth={1} />
                <p>暂无互动记录</p>
                <span>Agent 的互动行为会显示在这里</span>
              </div>
            ) : (
              <div className="interactions-list">
                {interactions.map(interaction => (
                  <div key={interaction.id} className={`interaction-item interaction-${interaction.type}`}>
                    <span className="interaction-icon">{getInteractionIcon(interaction.type)}</span>
                    <div className="interaction-info">
                      <span className="interaction-type">{getInteractionText(interaction.type)}</span>
                      {interaction.target && <span className="interaction-target">{interaction.target}</span>}
                      {interaction.content && <span className="interaction-content">{interaction.content}</span>}
                    </div>
                    <div className="interaction-meta">
                      <span className="interaction-time">{formatTime(interaction.timestamp)}</span>
                      <span className="interaction-iteration">第{interaction.iteration}次</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 配置模态框 */}
      {showConfigModal && (
        <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="modal Moltbook-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Settings size={18} /> Agent 配置</h3>
              <button className="btn-icon" onClick={() => setShowConfigModal(false)}>
                <XCircle size={18} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Agent 目标</label>
                <textarea
                  value={editConfig.goal}
                  onChange={e => setEditConfig({ ...editConfig, goal: e.target.value })}
                  placeholder="描述你希望 AI 完成的目标..."
                  rows={3}
                />
                <span className="hint">AI 会自主规划如何完成这个目标</span>
              </div>

              <div className="form-group">
                <label>思考间隔</label>
                <select
                  value={editConfig.loopInterval}
                  onChange={e => setEditConfig({ ...editConfig, loopInterval: Number(e.target.value) })}
                >
                  {INTERVAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className="hint">每次循环之间的等待时间</span>
              </div>

              <div className="form-group">
                <label>最大迭代次数</label>
                <input
                  type="number"
                  value={editConfig.maxIterations}
                  onChange={e => setEditConfig({ ...editConfig, maxIterations: Number(e.target.value) })}
                  min={0}
                  placeholder="0 = 无限"
                />
                <span className="hint">0 表示无限运行，直到手动停止</span>
              </div>

              <div className="form-group">
                <label>Moltbook URL</label>
                <input
                  type="text"
                  value={editConfig.MoltbookUrl}
                  onChange={e => setEditConfig({ ...editConfig, MoltbookUrl: e.target.value })}
                  placeholder="https://Moltbook.fun"
                />
              </div>

              <div className="form-group toggle-group">
                <div className="toggle-info">
                  <label>自动发帖</label>
                  <span className="hint">允许 AI 自动在 Moltbook 发表内容</span>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={editConfig.autoPost}
                    onChange={e => setEditConfig({ ...editConfig, autoPost: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={saveConfig}>
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
