import { useState, useEffect, useRef } from 'react'
import { Power, RefreshCw, Radio, Clock, Terminal, Play, Trash2, Cpu, HardDrive, Activity, Server, Timer, Download } from 'lucide-react'
import './Dashboard.css'

interface SystemInfo {
  cpu: { cores: number; model: string; usage: number }
  memory: { total: number; used: number; usagePercent: number }
  hostname: string
  uptime: number
}

interface ProcessMemory {
  app: { rss: number; heapUsed: number }
  gateway: number
}

interface CronJob {
  id: string
  name: string
  cron?: string
  every?: string
  enabled?: boolean
  lastRun?: string
}

interface ChannelInfo {
  name: string
  type: string
  enabled: boolean
  description: string
}

interface GatewayDetails {
  running: boolean
  pid: number | null
  uptime: number
  port: number
}

// Cache keys
const CACHE_KEYS = {
  cronJobs: 'Driveclaw_dashboard_crons',
  memory: 'Driveclaw_dashboard_memory',
  logs: 'Driveclaw_dashboard_logs'
}

const formatBytes = (bytes: number) => {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

const formatMB = (bytes: number) => {
  if (bytes === 0) return '-'
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}

const formatUptime = (ms: number) => {
  if (ms < 1000) return '0秒'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}天 ${hours % 24}小时`
  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`
  if (minutes > 0) return `${minutes}分钟`
  return `${seconds}秒`
}

const formatSystemUptime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}天 ${hours % 24}小时`
  return `${hours}小时`
}

export default function Dashboard() {
  const [gatewayStatus, setGatewayStatus] = useState<'running' | 'stopped' | 'checking'>('checking')
  const [gatewayDetails, setGatewayDetails] = useState<GatewayDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.logs)
      return cached ? JSON.parse(cached) : ['✔ Driveclaw 已启动']
    } catch { return ['✔ Driveclaw 已启动'] }
  })
  const [cronJobs, setCronJobs] = useState<CronJob[]>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.cronJobs)
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [processMemory, setProcessMemory] = useState<ProcessMemory | null>(null)
  const [memoryEnabled, setMemoryEnabled] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEYS.memory)
      return cached === 'true'
    } catch { return true }
  })
  const [memorySaving, setMemorySaving] = useState<boolean>(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const electronAPI = (window as any).electronAPI

  const addLog = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString()
    const prefix = type === 'success' ? '✔' : type === 'error' ? '✘' : '●'
    setLogs(prev => {
      const newLogs = [...prev.slice(-100), `[${time}] ${prefix} ${msg}`]
      localStorage.setItem(CACHE_KEYS.logs, JSON.stringify(newLogs))
      return newLogs
    })
  }

  const checkStatus = async () => {
    setGatewayStatus('checking')
    try {
      const result = await electronAPI?.gateway.status()
      const details = await electronAPI?.gateway.details()
      setGatewayStatus(result?.running ? 'running' : 'stopped')
      setGatewayDetails(details)
    } catch {
      setGatewayStatus('stopped')
    }
  }

  const toggleGateway = async () => {
    setLoading(true)
    try {
      if (gatewayStatus === 'running') {
        addLog('正在停止 Gateway...')
        await electronAPI?.gateway.stop()
        addLog('Gateway 已停止', 'success')
      } else {
        addLog('正在启动 Gateway...')
        const result = await electronAPI?.gateway.start()
        if (result?.success) {
          addLog('Gateway 已启动', 'success')
        } else {
          addLog(`Gateway 启动失败: ${result?.message || '未知错误'}`, 'error')
          if (result?.needConfig) {
            addLog('请先在「设置」中配置 OpenClaw CLI 路径', 'error')
          }
        }
      }
      await new Promise(r => setTimeout(r, 2000))
      await checkStatus()
    } catch (e: any) {
      addLog(`操作失败: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadCronJobs = async () => {
    try {
      const result = await electronAPI?.moltBOT.cronList()
      if (result) {
        // 查找 JSON 开始位置（支持 { 或 [）
        const lines = result.split('\n')
        const jsonStart = lines.findIndex((l: string) => l.trim().startsWith('{') || l.trim().startsWith('['))
        if (jsonStart >= 0) {
          const jsonStr = lines.slice(jsonStart).join('\n')
          const parsed = JSON.parse(jsonStr)
          // 支持 {"jobs": [...]} 或直接 [...]
          const jobsArray = Array.isArray(parsed) ? parsed : (parsed.jobs || [])
          const mappedJobs = jobsArray.map((j: any) => ({
            id: j.id,
            name: j.name,
            cron: j.schedule?.expr,
            every: j.schedule?.everyMs ? `每 ${Math.round(j.schedule.everyMs / 60000)} 分钟` : undefined,
            enabled: j.enabled !== false,
            lastRun: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toLocaleString() : undefined
          }))
          setCronJobs(mappedJobs)
          localStorage.setItem(CACHE_KEYS.cronJobs, JSON.stringify(mappedJobs))
        }
      }
    } catch {
      // Keep cached data on error
    }
  }

  const loadSystemInfo = async () => {
    try {
      const [info, procMem] = await Promise.all([
        electronAPI?.system.info(),
        electronAPI?.system.processMemory()
      ])
      if (info) setSystemInfo(info)
      if (procMem) setProcessMemory(procMem)
    } catch {}
  }

  const loadChannels = async () => {
    try {
      const result = await electronAPI?.moltBOT.channelsList()
      if (result) {
        const parsed: ChannelInfo[] = []
        const lines = result.split('\n')
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
            parsed.push({
              name: `Telegram ${name}`,
              type: 'telegram',
              enabled: isEnabled,
              description: status === 'configured' ? '已配置' : '未配置'
            })
          }
        }
        // 只有解析成功才更新，避免闪烁
        if (parsed.length > 0 || !channels.length) {
          setChannels(parsed)
          // 缓存到 localStorage
          localStorage.setItem('Driveclaw_channels', JSON.stringify(parsed))
        }
      }
    } catch {
      // 失败时不清空，保持上次的状态
    }
  }

  // 加载缓存的渠道状态
  const loadCachedChannels = () => {
    try {
      const cached = localStorage.getItem('Driveclaw_channels')
      if (cached) {
        setChannels(JSON.parse(cached))
      }
    } catch {}
  }

  const runCronJob = async (id: string, name: string) => {
    if (gatewayStatus !== 'running') {
      addLog(`无法执行任务: Gateway 未运行`, 'error')
      return
    }
    addLog(`正在执行任务: ${name}...`)
    try {
      const result = await electronAPI?.moltBOT.cronRun(id)
      if (result?.includes('error') && !result?.includes('"error"')) {
        addLog(`任务 ${name} 执行失败: ${result.split('\n')[0]}`, 'error')
      } else {
        addLog(`任务 ${name} 已触发`, 'success')
      }
    } catch {
      addLog(`任务 ${name} 执行失败`, 'error')
    }
  }

  const clearLogs = () => {
    const newLogs = ['● 日志已清空']
    setLogs(newLogs)
    localStorage.setItem(CACHE_KEYS.logs, JSON.stringify(newLogs))
  }

  const toggleMemory = async () => {
    try {
      setMemorySaving(true)
      const next = !memoryEnabled
      await electronAPI?.moltBOT.configSet('agents.defaults.memorySearch.enabled', String(next))
      setMemoryEnabled(next)
      localStorage.setItem(CACHE_KEYS.memory, String(next))
      addLog(`记忆功能已${next ? '启用' : '禁用'}（需重启 Gateway 生效）`, 'success')
    } catch (e: any) {
      addLog(`切换记忆失败: ${e?.message || '未知错误'}`, 'error')
    } finally {
      setMemorySaving(false)
    }
  }

  const exportLogs = async () => {
    try {
      const result = await electronAPI?.logs.export(logs)
      if (result?.success) {
        addLog(`日志已导出到 ${result.path}`, 'success')
      }
    } catch {
      addLog('日志导出失败', 'error')
    }
  }

  useEffect(() => {
    loadCachedChannels() // 先加载缓存
    checkStatus()
    loadCronJobs()
    loadSystemInfo()
    loadChannels()

    // 加载 memory 开关
    electronAPI?.moltBOT
      .configGet('agents.defaults.memorySearch.enabled')
      .then((raw: any) => {
        const enabled = String(raw || '').toLowerCase().includes('true')
        setMemoryEnabled(enabled)
        localStorage.setItem(CACHE_KEYS.memory, String(enabled))
      })
      .catch(() => {})
    
    const statusInterval = setInterval(checkStatus, 30000)
    const systemInterval = setInterval(loadSystemInfo, 5000)
    const cronInterval = setInterval(loadCronJobs, 60000)
    const channelInterval = setInterval(loadChannels, 60000) // 定期刷新渠道
    
    return () => {
      clearInterval(statusInterval)
      clearInterval(systemInterval)
      clearInterval(cronInterval)
      clearInterval(channelInterval)
    }
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const enabledCrons = cronJobs.filter(j => j.enabled !== false)

  return (
    <div className="dashboard">
      {/* 第一行：核心状态 */}
      <div className="dashboard-grid">
        {/* Gateway 状态卡片 */}
        <div className="card gateway-card">
          <div className="card-header">
            <h3><Server size={18} /> Gateway</h3>
            <button className="icon-btn" onClick={checkStatus} title="刷新状态">
              <RefreshCw size={16} />
            </button>
          </div>
          <div className="gateway-status">
            <span className={`status-dot ${gatewayStatus === 'running' ? 'online' : 'offline'}`}></span>
            <span className="status-text">
              {gatewayStatus === 'checking' ? '检查中...' : gatewayStatus === 'running' ? '运行中' : '已停止'}
            </span>
          </div>
          {gatewayDetails?.running && gatewayDetails.uptime > 0 && (
            <div className="gateway-meta">
              <span><Timer size={12} /> {formatUptime(gatewayDetails.uptime)}</span>
              <span>端口 {gatewayDetails.port}</span>
            </div>
          )}
          <button 
            className={`power-btn ${gatewayStatus === 'running' ? 'stop' : 'start'}`}
            onClick={toggleGateway}
            disabled={loading || gatewayStatus === 'checking'}
          >
            <Power size={20} />
            {loading ? '处理中...' : gatewayStatus === 'running' ? '停止服务' : '启动服务'}
          </button>
        </div>

        {/* 系统资源 */}
        <div className="card system-card">
          <div className="card-header">
            <h3><Activity size={18} /> 系统资源</h3>
          </div>
          <div className="system-stats">
            <div className="stat-row">
              <Cpu size={14} />
              <span>CPU</span>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${systemInfo?.cpu.usage || 0}%` }}></div>
              </div>
              <span className="stat-value">{systemInfo?.cpu.usage || 0}%</span>
            </div>
            <div className="stat-row">
              <HardDrive size={14} />
              <span>内存</span>
              <div className="progress-bar">
                <div className="progress-fill mem" style={{ width: `${systemInfo?.memory.usagePercent || 0}%` }}></div>
              </div>
              <span className="stat-value">{systemInfo?.memory.usagePercent || 0}%</span>
            </div>
          </div>
          <div className="process-memory">
            <div className="process-item">
              <span>🦞 Driveclaw</span>
              <span>{formatMB(processMemory?.app.rss || 0)}</span>
            </div>
            <div className="process-item">
              <span>⚡ Gateway</span>
              <span>{processMemory?.gateway ? formatMB(processMemory.gateway) : '-'}</span>
            </div>
          </div>
          {systemInfo && (
            <div className="system-meta">
              <span>{formatBytes(systemInfo.memory.used)} / {formatBytes(systemInfo.memory.total)}</span>
              <span>运行 {formatSystemUptime(systemInfo.uptime)}</span>
            </div>
          )}
        </div>

        {/* 定时任务概览 + 记忆开关 */}
        <div className="card">
          <div className="card-header">
            <h3><Clock size={18} /> 定时任务</h3>
            <button className="icon-btn" onClick={loadCronJobs} title="刷新">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="stat-number">{enabledCrons.length}</div>
          <div className="stat-label">个活跃任务</div>
          <div className="setting-item toggle-item" style={{marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)'}}>
            <div className="setting-info">
              <label>🧠 记忆功能</label>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={memoryEnabled}
                onChange={toggleMemory}
                disabled={memorySaving}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      {/* 第二行：渠道、任务列表和日志 */}
      <div className="dashboard-row three-col">
        {/* 渠道状态 */}
        <div className="card channel-card">
          <div className="card-header">
            <h3><Radio size={18} /> 已连接渠道</h3>
          </div>
          <div className="channel-list">
            {channels.length === 0 ? (
              <div className="channel-empty">暂无已配置渠道</div>
            ) : (
              channels.map((ch, i) => (
                <div key={i} className="channel-item">
                  <span className={`status-dot ${ch.enabled ? 'online' : 'offline'}`}></span>
                  <span>{ch.type === 'telegram' ? '💬' : '📡'} {ch.name}</span>
                  <span className="channel-status">{ch.enabled ? '已启用' : '已禁用'}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 任务列表 */}
        <div className="card cron-card">
          <div className="card-header">
            <h3><Clock size={18} /> 任务列表</h3>
          </div>
          <div className="cron-list">
            {cronJobs.length === 0 ? (
              <div className="cron-empty">暂无定时任务</div>
            ) : (
              cronJobs.map((job, idx) => (
                <div key={job.id || `job-${idx}`} className={`cron-item ${job.enabled === false ? 'disabled' : ''}`}>
                  <span className={`status-dot ${job.enabled !== false ? 'online' : 'offline'}`}></span>
                  <span className="cron-name">{job.name}</span>
                  <span className="cron-schedule">{job.cron || job.every}</span>
                  <button className="cron-run" onClick={() => runCronJob(job.id, job.name)} title="执行">
                    <Play size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 日志区域 */}
        <div className="card log-card">
          <div className="log-header">
            <h3><Terminal size={18} /> 运行日志</h3>
            <div className="log-actions">
              <button className="icon-btn" onClick={exportLogs} title="导出日志">
                <Download size={16} />
              </button>
              <button className="icon-btn" onClick={clearLogs} title="清空日志">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <div className="log-container">
            {logs.map((log, i) => (
              <div key={i} className={`log-line ${log.includes('✘') ? 'error' : log.includes('✔') ? 'success' : ''}`}>
                {log}
              </div>
            ))}
          <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
