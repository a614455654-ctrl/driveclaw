import { useEffect, useState } from 'react'
import { 
  Search, Brain, RefreshCw, AlertCircle, Info, HardDrive, Trash2, X, Clock
} from 'lucide-react'
import './Memory.css'

interface MemoryStats {
  exists: boolean
  totalSize: number
  dbPath: string
  lastModified: string | null
}

const CACHE_KEY = 'memory_cache'
const CACHE_TTL = 60000 // 1分钟缓存

function loadCache(): { stats: MemoryStats | null; timestamp: number } | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) return JSON.parse(cached)
  } catch {}
  return null
}

function saveCache(stats: MemoryStats | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ stats, timestamp: Date.now() }))
  } catch {}
}

export default function Memory() {
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<MemoryStats | null>(() => {
    const cached = loadCache()
    return cached?.stats || null
  })
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)

  // 加载记忆配置和统计
  useEffect(() => {
    const load = async () => {
      // 检查缓存是否有效
      const cached = loadCache()
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setStats(cached.stats)
        // 后台加载配置
        try {
          const raw = await window.electronAPI?.moltBOT.configGet('agents.defaults.memorySearch.enabled')
          setMemoryEnabled(String(raw || '').toLowerCase().includes('true'))
        } catch {}
        return
      }
      
      setLoading(true)
      try {
        // 加载配置
        const raw = await window.electronAPI?.moltBOT.configGet('agents.defaults.memorySearch.enabled')
        setMemoryEnabled(String(raw || '').toLowerCase().includes('true'))
        
        // 加载统计
        const statsResult = await (window.electronAPI as any)?.memory?.getStats()
        if (statsResult?.success) {
          setStats(statsResult.data)
          saveCache(statsResult.data)
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [])

  const toggleMemory = async () => {
    try {
      setSaving(true)
      const next = !memoryEnabled
      await window.electronAPI?.moltBOT.configSet('agents.defaults.memorySearch.enabled', String(next))
      setMemoryEnabled(next)
    } catch {}
    setSaving(false)
  }

  const handleSearch = async () => {
    if (!query.trim()) return
    
    setSearching(true)
    setError('')
    setSearchResult('')
    
    try {
      const result = await (window.electronAPI as any)?.memory?.search(query)
      if (result?.success) {
        setSearchResult(result.data || '未找到相关记忆')
      } else {
        setError(result?.error || '搜索失败')
      }
    } catch (err: any) {
      setError(err.message || '搜索失败')
    }
    setSearching(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleClearAll = async () => {
    setClearing(true)
    try {
      const result = await (window.electronAPI as any)?.memory?.clear()
      if (result?.success) {
        const newStats = { exists: false, totalSize: 0, dbPath: stats?.dbPath || '', lastModified: null }
        setStats(newStats)
        saveCache(newStats)
        setShowClearConfirm(false)
        setSearchResult('')
      } else {
        alert(result?.error || '清空失败')
      }
    } catch (err: any) {
      alert(err.message || '清空失败')
    }
    setClearing(false)
  }

  const refreshStats = async () => {
    setLoading(true)
    try {
      const statsResult = await (window.electronAPI as any)?.memory?.getStats()
      if (statsResult?.success) {
        setStats(statsResult.data)
        saveCache(statsResult.data)
      }
    } catch {}
    setLoading(false)
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('zh-CN')
  }

  return (
    <div className="memory-page">
      <div className="page-header">
        <h2><Brain size={24} /> 记忆管理</h2>
        <div className="header-actions">
          <button className="secondary" onClick={refreshStats} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            刷新
          </button>
          {stats?.exists && (
            <button className="danger-outline" onClick={() => setShowClearConfirm(true)}>
              <Trash2 size={16} />
              清空记忆
            </button>
          )}
        </div>
      </div>

      {/* Memory 开关 */}
      <div className="card" style={{marginBottom: 12}}>
        <div className="setting-item toggle-item">
          <div className="setting-info">
            <label>启用记忆（向量搜索）</label>
            <span className="hint">关闭后将不进行向量检索与索引，需重启 Gateway 生效</span>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={memoryEnabled} onChange={toggleMemory} disabled={saving} />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="memory-stats-grid">
          <div className="stat-card">
            <div className="stat-icon"><HardDrive size={24} /></div>
            <div className="stat-content">
              <div className="stat-value">{formatBytes(stats.totalSize)}</div>
              <div className="stat-label">存储大小</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Clock size={24} /></div>
            <div className="stat-content">
              <div className="stat-value" style={{fontSize: 14}}>{formatDate(stats.lastModified)}</div>
              <div className="stat-label">最后更新</div>
            </div>
          </div>
        </div>
      )}

      {/* 搜索框 */}
      <div className="search-box card">
        <div className="search-input-wrapper">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="搜索记忆内容..."
          />
          <button className="primary" onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? <RefreshCw className="spin" size={16} /> : '搜索'}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="error-box card">
          <AlertCircle size={20} />
          <div className="error-content">
            <p>搜索出错</p>
            <small>{error}</small>
          </div>
        </div>
      )}

      {/* 搜索结果 */}
      {searchResult && (
        <div className="search-results card">
          <h3>搜索结果</h3>
          <pre className="result-content">{searchResult}</pre>
        </div>
      )}

      {/* 空状态 */}
      {!stats?.exists && (
        <div className="empty-state card">
          <Brain size={48} />
          <h3>暂无记忆</h3>
          <p>记忆会在与 AI 对话时自动创建</p>
        </div>
      )}

      {/* 记忆说明 */}
      <div className="memory-info card">
        <div className="info-icon"><Info size={20} /></div>
        <div className="info-content">
          <h4>记忆系统说明</h4>
          <p>记忆存储在本地 SQLite 数据库中，通过向量搜索实现跨会话上下文。需要 Gateway 运行时才能使用。</p>
          {stats?.dbPath && <p className="db-path">路径: {stats.dbPath}</p>}
        </div>
      </div>

      {/* 清空确认模态框 */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><AlertCircle size={20} /> 确认清空</h3>
              <button className="close-btn" onClick={() => setShowClearConfirm(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>确定要清空所有记忆吗？</p>
              <p className="warning-text">记忆数据库将被删除（会自动备份）。</p>
            </div>
            <div className="modal-footer">
              <button className="secondary" onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="danger" onClick={handleClearAll} disabled={clearing}>
                {clearing ? <><RefreshCw size={16} className="spin" /> 清空中...</> : <><Trash2 size={16} /> 确认清空</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
