import { useState, useEffect } from 'react'
import { Radio, RefreshCw, ExternalLink, Check, X, Info, Plus, Power, Save, Edit2 } from 'lucide-react'
import './Channels.css'

interface Channel {
  name: string
  type: string
  icon: string
  status: 'configured' | 'not-configured'
  description: string
  enabled: boolean
}

interface ChannelConfig {
  type: 'telegram' | 'discord' | 'webhook'
  name: string
  botToken?: string
  webhookUrl?: string
  enabled: boolean
  proxy?: string
}

const electronAPI = (window as any).electronAPI

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(false)
  const [showConfigHint, setShowConfigHint] = useState(false)
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)
  const [newChannel, setNewChannel] = useState<ChannelConfig>({
    type: 'telegram',
    name: 'default',
    botToken: '',
    enabled: true,
    proxy: 'http://127.0.0.1:7897'
  })
  const [editingChannel, setEditingChannel] = useState<string | null>(null)
  const [editConfig, setEditConfig] = useState<any>(null)

  const parseChannelsOutput = (output: string): Channel[] => {
    const parsed: Channel[] = []
    const lines = output.split('\n')
    
    for (const line of lines) {
      const trimmed = line.trim()
      
      // 匹配多种格式:
      // - Telegram default: configured, token=config, enabled
      // - Telegram default: configured, enabled
      // - Telegram (default): configured, enabled
      const telegramMatch = trimmed.match(/Telegram\s*[\(]?(\w+)[\)]?:\s*(configured|not configured)/i)
      if (telegramMatch) {
        const [, name, status] = telegramMatch
        const isEnabled = /enabled/i.test(trimmed) && !/disabled/i.test(trimmed)
        const descMatch = trimmed.match(/,\s*(.+)$/)
        parsed.push({
          name: `Telegram ${name}`,
          type: 'telegram',
          icon: '💬',
          status: status === 'configured' ? 'configured' : 'not-configured',
          description: descMatch ? descMatch[1] : '',
          enabled: isEnabled
        })
      }
      
      // 可以添加更多渠道类型的解析...
    }
    
    return parsed
  }

  const loadCachedChannels = () => {
    try {
      const cached = localStorage.getItem('driveclaw_channels_detail')
      if (cached) {
        setChannels(JSON.parse(cached))
      }
    } catch {}
  }

  const refreshChannels = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI?.moltBOT.channelsList()
      if (result) {
        const parsed = parseChannelsOutput(result)
        // 只有解析成功才更新
        if (parsed.length > 0 || channels.length === 0) {
          setChannels(parsed)
          localStorage.setItem('driveclaw_channels_detail', JSON.stringify(parsed))
        }
      }
    } catch (error) {
      console.error('Failed to load channels', error)
      // 失败时不清空
    }
    setLoading(false)
  }

  useEffect(() => {
    loadCachedChannels() // 先加载缓存
    refreshChannels()
  }, [])

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const closeModal = () => {
    setEditingChannel(null)
    setEditConfig(null)
  }

  // 保存新渠道
  const saveNewChannel = async () => {
    if (!newChannel.botToken && newChannel.type === 'telegram') {
      showMessage('error', '请输入 Bot Token')
      return
    }

    setSaving(true)
    try {
      let updates: Record<string, unknown> = {}

      if (newChannel.type === 'telegram') {
        updates = {
          'channels.telegram.enabled': newChannel.enabled,
          'channels.telegram.botToken': newChannel.botToken,
          'channels.telegram.proxy': newChannel.proxy || '',
          'channels.telegram.dmPolicy': 'open',
          'channels.telegram.allowFrom': ['*'],
          'channels.telegram.groupPolicy': 'allowlist',
          'channels.telegram.streamMode': 'partial'
        }
      } else if (newChannel.type === 'webhook') {
        updates = {
          'channels.webhook.enabled': newChannel.enabled,
          'channels.webhook.url': newChannel.webhookUrl || ''
        }
      }

      const result = await electronAPI?.moltBOT.updateConfig(updates)
      
      if (result?.success) {
        showMessage('success', '渠道配置已保存，重启 Gateway 生效')
        setShowAddChannel(false)
        setNewChannel({
          type: 'telegram',
          name: 'default',
          botToken: '',
          enabled: true,
          proxy: 'http://127.0.0.1:7897'
        })
        // 刷新渠道列表
        await refreshChannels()
      } else {
        showMessage('error', result?.error || '保存失败')
      }
    } catch (e: any) {
      showMessage('error', e.message || '保存失败')
    }
    setSaving(false)
  }

  // 切换渠道启用状态
  const toggleChannelEnabled = async (channelType: string, currentEnabled: boolean) => {
    setSaving(true)
    try {
      const updates = {
        [`channels.${channelType}.enabled`]: !currentEnabled
      }
      const result = await electronAPI?.moltBOT.updateConfig(updates)
      
      if (result?.success) {
        showMessage('success', `渠道已${!currentEnabled ? '启用' : '禁用'}，重启 Gateway 生效`)
        await refreshChannels()
      } else {
        showMessage('error', result?.error || '操作失败')
      }
    } catch (e: any) {
      showMessage('error', e.message || '操作失败')
    }
    setSaving(false)
  }

  // 编辑渠道
  const startEditChannel = async (channel: Channel) => {
    setEditingChannel(channel.type)
    try {
      const config = await electronAPI?.moltBOT.getConfig()
      if (config?.channels?.[channel.type]) {
        setEditConfig(config.channels[channel.type])
      }
    } catch {}
  }

  // 保存编辑
  const saveEditChannel = async () => {
    if (!editingChannel || !editConfig) return

    setSaving(true)
    try {
      const updates: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(editConfig)) {
        updates[`channels.${editingChannel}.${key}`] = value
      }

      const result = await electronAPI?.moltBOT.updateConfig(updates)
      
      if (result?.success) {
        showMessage('success', '渠道配置已更新，重启 Gateway 生效')
        closeModal()
        await refreshChannels()
      } else {
        showMessage('error', result?.error || '保存失败')
      }
    } catch (e: any) {
      showMessage('error', e.message || '保存失败')
    }
    setSaving(false)
  }

  const availableChannelTypes = [
    { type: 'telegram', name: 'Telegram', icon: '💬', description: 'Telegram 机器人', configurable: true },
    { type: 'webhook', name: 'Webhook', icon: '🔗', description: '自定义 HTTP 回调', configurable: true },
    { type: 'discord', name: 'Discord', icon: '🎮', description: 'Discord 机器人集成', configurable: false },
    { type: 'slack', name: 'Slack', icon: '💼', description: 'Slack 工作区集成', configurable: false },
  ]

  return (
    <div className="page channels-page">
      <div className="page-header">
        <h2><Radio size={24} /> 渠道管理</h2>
        <div className="header-actions">
          <button className="btn-small btn-primary-small" onClick={() => setShowAddChannel(true)}>
            <Plus size={14} /> 添加渠道
          </button>
          <button className="btn-icon" onClick={refreshChannels} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {message && (
        <div className={`message-toast ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 快捷配置卡片 */}
      {showAddChannel && (
        <div className="card quick-config-card">
          <div className="card-header">
            <h3>快捷配置渠道</h3>
            <button className="btn-icon" onClick={() => setShowAddChannel(false)}>✕</button>
          </div>
          <div className="quick-config-form">
            <div className="form-row">
              <label>渠道类型</label>
              <select 
                value={newChannel.type} 
                onChange={e => setNewChannel(prev => ({ ...prev, type: e.target.value as any }))}
              >
                <option value="telegram">Telegram</option>
                <option value="webhook">Webhook</option>
              </select>
            </div>

            {newChannel.type === 'telegram' && (
              <>
                <div className="form-row">
                  <label>Bot Token</label>
                  <input
                    type="text"
                    value={newChannel.botToken || ''}
                    onChange={e => setNewChannel(prev => ({ ...prev, botToken: e.target.value }))}
                    placeholder="粘贴你的 Telegram Bot Token..."
                  />
                </div>
                <div className="form-row">
                  <label>代理地址 (可选)</label>
                  <input
                    type="text"
                    value={newChannel.proxy || ''}
                    onChange={e => setNewChannel(prev => ({ ...prev, proxy: e.target.value }))}
                    placeholder="http://127.0.0.1:7897"
                  />
                </div>
                <div className="token-hint">
                  <Info size={14} />
                  <span>通过 @BotFather 创建 Bot 获取 Token，格式如: 123456789:ABCdefGHI...</span>
                </div>
              </>
            )}

            {newChannel.type === 'webhook' && (
              <div className="form-row">
                <label>Webhook URL</label>
                <input
                  type="text"
                  value={newChannel.webhookUrl || ''}
                  onChange={e => setNewChannel(prev => ({ ...prev, webhookUrl: e.target.value }))}
                  placeholder="https://your-server.com/webhook"
                />
              </div>
            )}

            <div className="form-row toggle-row">
              <label>启用渠道</label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={newChannel.enabled}
                  onChange={e => setNewChannel(prev => ({ ...prev, enabled: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div className="form-actions">
              <button className="btn-primary" onClick={saveNewChannel} disabled={saving}>
                {saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 已配置渠道 */}
      <div className="section">
        <h3>已配置渠道</h3>
        {channels.length === 0 ? (
          <div className="empty-message card">
            <p>暂无已配置的渠道</p>
            <small>点击上方“添加渠道”快捷配置</small>
          </div>
        ) : (
          <div className="channels-list">
            {channels.map(channel => (
              <div key={channel.name} className="channel-card card">
                <div className="channel-main">
                  <span className="channel-icon">{channel.icon}</span>
                  <div className="channel-info">
                    <div className="channel-name">
                      {channel.name}
                      <span className={`status-badge ${channel.enabled ? 'online' : 'offline'}`}>
                        {channel.enabled ? <><Check size={12} /> 已启用</> : <><X size={12} /> 已禁用</>}
                      </span>
                    </div>
                    <div className="channel-desc">{channel.description}</div>
                  </div>
                </div>
                <div className="channel-actions">
                  <button 
                    className={`btn-small ${channel.enabled ? 'btn-danger' : 'btn-success'}`}
                    onClick={() => toggleChannelEnabled(channel.type, channel.enabled)}
                    disabled={saving}
                    title={channel.enabled ? '禁用' : '启用'}
                  >
                    <Power size={14} />
                  </button>
                  <button className="btn-small" onClick={() => startEditChannel(channel)}>
                    <Edit2 size={14} /> 编辑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 可用渠道类型 */}
      <div className="section">
        <h3>可用渠道类型</h3>
        <div className="available-channels">
          {availableChannelTypes.map(ch => (
            <div key={ch.type} className="available-channel card">
              <span className="channel-icon">{ch.icon}</span>
              <div className="channel-info">
                <div className="channel-name">{ch.name}</div>
                <div className="channel-desc">{ch.description}</div>
              </div>
              {ch.configurable ? (
                <button 
                  className="btn-small btn-primary-small"
                  onClick={() => {
                    setNewChannel(prev => ({ ...prev, type: ch.type as any }))
                    setShowAddChannel(true)
                  }}
                >
                  <Plus size={14} /> 配置
                </button>
              ) : (
                <button 
                  className="btn-small"
                  onClick={() => setShowConfigHint(true)}
                >
                  <Info size={14} /> 即将支持
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 提示卡片 */}
      <div className="card tips-card">
        <h3>💡 渠道说明</h3>
        <ul>
          <li>渠道配置需要在 moltBOT 配置文件中设置</li>
          <li>每个渠道可以独立配置消息处理方式</li>
          <li>Telegram 是最常用的交互渠道</li>
          <li>
            <a href="https://github.com/nicepkg/moltBOT" target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> 查看渠道配置文档
            </a>
          </li>
        </ul>
      </div>

      {/* 渠道编辑弹窗 */}
      {editingChannel && editConfig && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>编辑 {editingChannel} 渠道</h3>
              <button className="btn-icon" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              {editingChannel === 'telegram' && (
                <>
                  <div className="form-row">
                    <label>Bot Token</label>
                    <input
                      type="text"
                      value={editConfig.botToken || ''}
                      onChange={e => setEditConfig((prev: any) => ({ ...prev, botToken: e.target.value }))}
                    />
                  </div>
                  <div className="form-row">
                    <label>代理地址</label>
                    <input
                      type="text"
                      value={editConfig.proxy || ''}
                      onChange={e => setEditConfig((prev: any) => ({ ...prev, proxy: e.target.value }))}
                    />
                  </div>
                  <div className="form-row">
                    <label>DM 策略</label>
                    <select
                      value={editConfig.dmPolicy || 'open'}
                      onChange={e => setEditConfig((prev: any) => ({ ...prev, dmPolicy: e.target.value }))}
                    >
                      <option value="open">开放</option>
                      <option value="allowlist">白名单</option>
                      <option value="closed">关闭</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label>群组策略</label>
                    <select
                      value={editConfig.groupPolicy || 'allowlist'}
                      onChange={e => setEditConfig((prev: any) => ({ ...prev, groupPolicy: e.target.value }))}
                    >
                      <option value="open">开放</option>
                      <option value="allowlist">白名单</option>
                      <option value="closed">关闭</option>
                    </select>
                  </div>
                  <div className="form-row toggle-row">
                    <label>启用</label>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={editConfig.enabled !== false}
                        onChange={e => setEditConfig((prev: any) => ({ ...prev, enabled: e.target.checked }))}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </>
              )}

              <div className="form-actions">
                <button className="btn-secondary" onClick={closeModal}>取消</button>
                <button className="btn-primary" onClick={saveEditChannel} disabled={saving}>
                  {saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 配置提示弹窗 */}
      {showConfigHint && (
        <div className="modal-overlay" onClick={() => setShowConfigHint(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📝 如何配置渠道</h3>
              <button className="btn-icon" onClick={() => setShowConfigHint(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="config-steps">
                <div className="step">
                  <span className="step-num">1</span>
                  <div className="step-content">
                    <h4>打开配置文件</h4>
                    <code>~/.moltBOT/moltBOT.json</code>
                  </div>
                </div>
                <div className="step">
                  <span className="step-num">2</span>
                  <div className="step-content">
                    <h4>添加渠道配置</h4>
                    <p>参考文档添加对应渠道的配置项</p>
                  </div>
                </div>
                <div className="step">
                  <span className="step-num">3</span>
                  <div className="step-content">
                    <h4>重启 Gateway</h4>
                    <p>在仪表盘停止并重新启动 Gateway</p>
                  </div>
                </div>
              </div>
              <a 
                href="https://github.com/nicepkg/moltBOT" 
                target="_blank" 
                rel="noreferrer"
                className="doc-link"
              >
                <ExternalLink size={14} /> 查看详细配置文档
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
