import { useState, useEffect } from 'react'
import { Heart, Play, FileText, Save, Trash2, X, RefreshCw, Clock, Radio, Info } from 'lucide-react'
import './Heartbeat.css'

interface HeartbeatConfig {
  every: string
  target: string
  enabled: boolean
  prompt: string
  ackMaxChars: number
  includeReasoning: boolean
  activeHours: { start: string; end: string } | null
}

// 心跳间隔快捷选项
const INTERVAL_PRESETS = [
  { value: '15m', label: '15分' },
  { value: '30m', label: '30分' },
  { value: '1h', label: '1小时' },
  { value: '2h', label: '2小时' },
  { value: '4h', label: '4小时' },
]

// 格式化间隔显示
const formatInterval = (value: string) => {
  if (!value || value === '0m') return '已禁用'
  // 尝试解析常见格式
  const hourMatch = value.match(/^(\d+)h$/)
  const minMatch = value.match(/^(\d+)m$/)
  const mixedMatch = value.match(/^(\d+)h(\d+)m$/)
  
  if (hourMatch) return `${hourMatch[1]} 小时`
  if (minMatch) return `${minMatch[1]} 分钟`
  if (mixedMatch) return `${mixedMatch[1]}小时${mixedMatch[2]}分`
  return value
}

// 目标渠道显示名称
const getTargetLabel = (target: string) => {
  const labels: Record<string, string> = {
    'last': '最后活跃渠道',
    'none': '不发送（仅运行）',
    'telegram': 'Telegram',
    'whatsapp': 'WhatsApp',
    'discord': 'Discord',
    'slack': 'Slack',
    'signal': 'Signal',
    'imessage': 'iMessage',
  }
  return labels[target] || target
}

const HEARTBEAT_CACHE_KEY = 'heartbeat_cache'
const HEARTBEAT_CACHE_TTL = 30000 // 30秒

function loadHeartbeatCache() {
  try {
    const cached = localStorage.getItem(HEARTBEAT_CACHE_KEY)
    if (cached) return JSON.parse(cached)
  } catch {}
  return null
}

function saveHeartbeatCache(data: any) {
  try {
    localStorage.setItem(HEARTBEAT_CACHE_KEY, JSON.stringify({ ...data, timestamp: Date.now() }))
  } catch {}
}

export default function Heartbeat() {
  const cached = loadHeartbeatCache()
  const [config, setConfig] = useState<HeartbeatConfig>(cached?.config || {
    every: '30m',
    target: 'last',
    enabled: true,
    prompt: '',
    ackMaxChars: 300,
    includeReasoning: false,
    activeHours: null
  })
  const [availableChannels, setAvailableChannels] = useState<string[]>(cached?.channels || ['last', 'none'])
  const [heartbeatMdContent, setHeartbeatMdContent] = useState<string | null>(cached?.mdContent || null)
  const [heartbeatMdPath, setHeartbeatMdPath] = useState<string | null>(cached?.mdPath || null)
  const [showMdModal, setShowMdModal] = useState(false)
  const [mdEditing, setMdEditing] = useState('')
  const [loading, setLoading] = useState(!cached)
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [lastTrigger, setLastTrigger] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [gatewayRunning, setGatewayRunning] = useState(false)
  
  const electronAPI = (window as any).electronAPI

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  // 加载配置
  const loadConfig = async (force = false) => {
    // 检查缓存
    const cached = loadHeartbeatCache()
    if (!force && cached && Date.now() - cached.timestamp < HEARTBEAT_CACHE_TTL) {
      // 只检查 Gateway 状态
      const status = await electronAPI?.gateway.status()
      setGatewayRunning(status?.running || false)
      return
    }
    
    setLoading(true)
    try {
      // 检查 Gateway 状态
      const status = await electronAPI?.gateway.status()
      setGatewayRunning(status?.running || false)
      
      // 加载心跳配置
      const result = await electronAPI?.heartbeat.getConfig()
      if (result?.success && result.config) {
        setConfig(result.config)
      }
      
      // 加载可用渠道
      const channelsResult = await electronAPI?.heartbeat.getChannels()
      if (channelsResult?.success) {
        setAvailableChannels(channelsResult.channels)
      }
      
      // 加载 HEARTBEAT.md
      const mdResult = await electronAPI?.heartbeat.getMd()
      if (mdResult?.success) {
        setHeartbeatMdContent(mdResult.content)
        setHeartbeatMdPath(mdResult.path)
      }
      
      // 保存缓存
      saveHeartbeatCache({
        config: result?.config,
        channels: channelsResult?.channels,
        mdContent: mdResult?.content,
        mdPath: mdResult?.path
      })
    } catch (e) {
      console.error('Failed to load heartbeat config:', e)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadConfig()
    
    // 定期检查 Gateway 状态
    const interval = setInterval(async () => {
      const status = await electronAPI?.gateway.status()
      setGatewayRunning(status?.running || false)
    }, 10000)
    
    return () => clearInterval(interval)
  }, [])

  // 更新配置
  const updateConfig = async (updates: Partial<HeartbeatConfig>) => {
    setSaving(true)
    try {
      const newConfig = { ...config, ...updates }
      
      // 构建更新对象
      const configUpdates: Record<string, unknown> = {}
      if ('enabled' in updates || 'every' in updates) {
        configUpdates.every = newConfig.enabled ? newConfig.every : '0m'
      }
      if ('target' in updates) {
        configUpdates.target = updates.target
      }
      if ('includeReasoning' in updates) {
        configUpdates.includeReasoning = updates.includeReasoning
      }
      if ('ackMaxChars' in updates) {
        configUpdates.ackMaxChars = updates.ackMaxChars
      }
      
      const result = await electronAPI?.heartbeat.updateConfig(configUpdates)
      if (result?.success) {
        setConfig(newConfig)
        
        // 尝试即时启用/禁用
        if ('enabled' in updates) {
          try {
            await electronAPI?.heartbeat.setEnabled(newConfig.enabled)
          } catch {}
        }
        
        showMessage('success', '配置已保存（重启 Gateway 完全生效）')
      } else {
        showMessage('error', result?.error || '保存失败')
      }
    } catch (e: any) {
      showMessage('error', e?.message || '保存失败')
    }
    setSaving(false)
  }

  // 触发心跳
  const triggerHeartbeat = async () => {
    if (!gatewayRunning) {
      showMessage('error', 'Gateway 未运行')
      return
    }
    
    setTriggering(true)
    try {
      const result = await electronAPI?.heartbeat.trigger()
      if (result?.success) {
        setLastTrigger(new Date().toLocaleTimeString())
        showMessage('success', '心跳已触发')
      } else {
        showMessage('error', result?.error || '触发失败')
      }
    } catch (e: any) {
      showMessage('error', e?.message || '触发失败')
    }
    setTriggering(false)
  }

  // 打开 HEARTBEAT.md 编辑器
  const openMdEditor = () => {
    setMdEditing(heartbeatMdContent || `# 心跳任务清单

- 检查邮箱是否有紧急消息
- 如果有进行中的任务，汇报进度
- 如果空闲超过 4 小时，轻度问候
- 如果没有任何需要关注的事项，回复 HEARTBEAT_OK`)
    setShowMdModal(true)
  }

  // 保存 HEARTBEAT.md
  const saveMd = async () => {
    setSaving(true)
    try {
      const result = await electronAPI?.heartbeat.saveMd(mdEditing)
      if (result?.success) {
        setHeartbeatMdContent(mdEditing)
        setHeartbeatMdPath(result.path)
        showMessage('success', 'HEARTBEAT.md 已保存')
        setShowMdModal(false)
      } else {
        showMessage('error', result?.error || '保存失败')
      }
    } catch (e: any) {
      showMessage('error', e?.message || '保存失败')
    }
    setSaving(false)
  }

  // 删除 HEARTBEAT.md
  const deleteMd = async () => {
    if (!confirm('确定要删除 HEARTBEAT.md 吗？')) return
    try {
      const result = await electronAPI?.heartbeat.deleteMd()
      if (result?.success) {
        setHeartbeatMdContent(null)
        setHeartbeatMdPath(null)
        showMessage('success', 'HEARTBEAT.md 已删除')
        setShowMdModal(false)
      }
    } catch (e: any) {
      showMessage('error', e?.message || '删除失败')
    }
  }

  if (loading) {
    return (
      <div className="page heartbeat-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="page heartbeat-page">
      <div className="page-header">
        <h2><Heart size={24} /> 心跳管理</h2>
        <div className="header-actions">
          <button className="btn-icon" onClick={() => loadConfig(true)} title="刷新">
            <RefreshCw size={18} />
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
          <strong>什么是心跳？</strong>
          <p>心跳是 AI 定期运行的"检查点"。每隔一段时间，AI 会检查 HEARTBEAT.md 中的任务清单，如果有需要告诉你的事情就发送消息，否则保持静默。</p>
        </div>
      </div>

      {/* 状态概览 */}
      <div className="status-overview">
        <div className={`status-card ${config.enabled ? 'active' : 'inactive'}`}>
          <div className="status-icon">
            <Heart size={32} />
          </div>
          <div className="status-info">
            <div className="status-label">心跳状态</div>
            <div className="status-value">{config.enabled ? '已启用' : '已禁用'}</div>
          </div>
        </div>
        
        <div className="status-card">
          <div className="status-icon">
            <Clock size={32} />
          </div>
          <div className="status-info">
            <div className="status-label">检查间隔</div>
            <div className="status-value">{formatInterval(config.every)}</div>
          </div>
        </div>
        
        <div className="status-card">
          <div className="status-icon">
            <Radio size={32} />
          </div>
          <div className="status-info">
            <div className="status-label">发送目标</div>
            <div className="status-value">{getTargetLabel(config.target)}</div>
          </div>
        </div>
        
        <div className={`status-card ${heartbeatMdContent ? 'active' : ''}`}>
          <div className="status-icon">
            <FileText size={32} />
          </div>
          <div className="status-info">
            <div className="status-label">HEARTBEAT.md</div>
            <div className="status-value">{heartbeatMdContent ? '已配置' : '未配置'}</div>
          </div>
        </div>
      </div>

      {/* 配置区域 */}
      <div className="config-grid">
        {/* 基本设置 */}
        <div className="card">
          <h3>基本设置</h3>
          
          <div className="setting-item toggle-item">
            <div className="setting-info">
              <label>启用心跳</label>
              <span className="hint">定期运行 AI 检查任务清单</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => updateConfig({ enabled: e.target.checked })}
                disabled={saving}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          
          <div className="setting-item">
            <label>检查间隔</label>
            <div className="interval-input-group">
              <input
                type="text"
                className="interval-input"
                value={config.every}
                onChange={(e) => updateConfig({ every: e.target.value })}
                disabled={saving || !config.enabled}
                placeholder="如: 30m, 1h, 2h30m"
              />
              <div className="interval-presets">
                {INTERVAL_PRESETS.map(opt => (
                  <button
                    key={opt.value}
                    className={`preset-btn ${config.every === opt.value ? 'active' : ''}`}
                    onClick={() => updateConfig({ every: opt.value })}
                    disabled={saving || !config.enabled}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="hint">支持格式: 30m, 1h, 2h30m, 90m 等</span>
          </div>
          
          <div className="setting-item">
            <label>发送目标</label>
            <select
              className="select-input"
              value={config.target}
              onChange={(e) => updateConfig({ target: e.target.value })}
              disabled={saving || !config.enabled}
            >
              {availableChannels.map(ch => (
                <option key={ch} value={ch}>{getTargetLabel(ch)}</option>
              ))}
            </select>
            <span className="hint">心跳消息发送到哪个渠道</span>
          </div>
        </div>

        {/* 高级设置 */}
        <div className="card">
          <h3>高级设置</h3>
          
          <div className="setting-item toggle-item">
            <div className="setting-info">
              <label>包含推理过程</label>
              <span className="hint">发送 AI 的思考过程（如果模型支持）</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={config.includeReasoning}
                onChange={(e) => updateConfig({ includeReasoning: e.target.checked })}
                disabled={saving || !config.enabled}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          
          <div className="setting-item">
            <label>静默阈值 (字符)</label>
            <input
              type="number"
              className="input-small"
              value={config.ackMaxChars}
              onChange={(e) => updateConfig({ ackMaxChars: parseInt(e.target.value) || 300 })}
              disabled={saving || !config.enabled}
              min={0}
              max={1000}
            />
            <span className="hint">HEARTBEAT_OK 后允许的最大字符数，超过则发送</span>
          </div>
        </div>
      </div>

      {/* HEARTBEAT.md 管理 */}
      <div className="card md-card">
        <div className="card-header">
          <h3><FileText size={18} /> HEARTBEAT.md 任务清单</h3>
          <div className="card-actions">
            <button className="btn btn-secondary" onClick={openMdEditor}>
              {heartbeatMdContent ? '编辑' : '创建'}
            </button>
          </div>
        </div>
        
        {heartbeatMdContent ? (
          <div className="md-preview">
            <pre>{heartbeatMdContent}</pre>
            <div className="md-meta">
              <span className="md-path">{heartbeatMdPath}</span>
            </div>
          </div>
        ) : (
          <div className="md-empty">
            <FileText size={48} strokeWidth={1} />
            <p>尚未配置 HEARTBEAT.md</p>
            <span className="hint">创建任务清单后，AI 会在每次心跳时检查并执行</span>
            <button className="btn btn-primary" onClick={openMdEditor}>
              创建任务清单
            </button>
          </div>
        )}
      </div>

      {/* 手动触发 */}
      <div className="card trigger-card">
        <div className="trigger-content">
          <div className="trigger-info">
            <h3>手动触发</h3>
            <p>立即执行一次心跳检查，无需等待定时器</p>
            {lastTrigger && <span className="last-trigger">上次触发: {lastTrigger}</span>}
          </div>
          <button 
            className="btn btn-primary btn-large"
            onClick={triggerHeartbeat}
            disabled={triggering || !gatewayRunning}
          >
            <Play size={18} />
            {triggering ? '触发中...' : '立即触发'}
          </button>
        </div>
        {!gatewayRunning && (
          <div className="gateway-warning">
            ⚠️ Gateway 未运行，无法触发心跳
          </div>
        )}
      </div>

      {/* HEARTBEAT.md 编辑模态框 */}
      {showMdModal && (
        <div className="modal-overlay" onClick={() => setShowMdModal(false)}>
          <div className="modal heartbeat-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><FileText size={18} /> 编辑 HEARTBEAT.md</h3>
              <button className="btn-icon" onClick={() => setShowMdModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-hint">
                HEARTBEAT.md 定义了 AI 在每次心跳时需要检查的任务清单。保持简短以节省 token。
                如果没有需要关注的事项，AI 应回复 <code>HEARTBEAT_OK</code>（会被静默处理）。
              </p>
              <textarea
                className="md-editor"
                value={mdEditing}
                onChange={(e) => setMdEditing(e.target.value)}
                placeholder="# 心跳任务清单

- 检查邮箱是否有紧急消息
- 如果有进行中的任务，汇报进度"
              />
              {heartbeatMdPath && (
                <div className="md-path">保存位置: {heartbeatMdPath}</div>
              )}
            </div>
            <div className="modal-footer">
              {heartbeatMdContent && (
                <button className="btn btn-danger" onClick={deleteMd}>
                  <Trash2 size={14} /> 删除
                </button>
              )}
              <div className="footer-right">
                <button className="btn btn-secondary" onClick={() => setShowMdModal(false)}>
                  取消
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={saveMd}
                  disabled={saving}
                >
                  <Save size={14} /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
