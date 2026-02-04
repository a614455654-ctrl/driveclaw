import { useState, useEffect } from 'react'
import { Plus, Play, Trash2, ToggleLeft, ToggleRight, AlertCircle, RefreshCw, Clock } from 'lucide-react'
import './CronManager.css'

interface CronJob {
  id: string
  name: string
  schedule: string
  message: string
  enabled: boolean
  nextRun: string
}

const CACHE_KEY = 'driveclaw_cron_jobs'

// Strip ANSI color codes from CLI output
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '')

export default function CronManager() {
  const [jobs, setJobs] = useState<CronJob[]>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })
  const [showAdd, setShowAdd] = useState(false)
  const [newJob, setNewJob] = useState({ name: '', cron: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [gatewayOnline, setGatewayOnline] = useState(false)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const checkGateway = async () => {
    try {
      const result = await window.electronAPI?.gateway.status()
      setGatewayOnline(result?.running || false)
      return result?.running || false
    } catch {
      setGatewayOnline(false)
      return false
    }
  }

  const loadJobs = async (force = false) => {
    const hasCache = jobs.length > 0
    if (!hasCache || force) setRefreshing(true)
    setError('')
    
    const online = await checkGateway()
    if (!online && !force) {
      // Keep cached jobs visible but show error
      setError('Gateway 未运行，显示缓存数据')
      setRefreshing(false)
      return
    }
    
    try {
      const result = await window.electronAPI?.moltBOT.cronList()
      // Parse JSON from result (strip ANSI codes first)
      const cleanResult = stripAnsi(result || '')
      
      // 查找 JSON 开始位置（可能是 { 或 [）
      const lines = cleanResult.split('\n')
      const jsonStart = lines.findIndex((l: string) => l.trim().startsWith('{') || l.trim().startsWith('['))
      
      if (jsonStart >= 0) {
        const jsonStr = lines.slice(jsonStart).join('\n')
        const parsed = JSON.parse(jsonStr)
        // 支持两种格式: {"jobs": [...]} 或直接 [...]
        const jobsArray = Array.isArray(parsed) ? parsed : (parsed.jobs || [])
        const mappedJobs = jobsArray.map((j: any) => ({
          id: j.id,
          name: j.name,
          schedule: j.schedule?.expr || (j.schedule?.everyMs ? `每 ${Math.round(j.schedule.everyMs / 60000)} 分钟` : ''),
          message: j.payload?.message || '',
          enabled: j.enabled !== false,
          nextRun: j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : '-'
        }))
        setJobs(mappedJobs)
        localStorage.setItem(CACHE_KEY, JSON.stringify(mappedJobs))
      } else {
        // 检查是否是真正的错误消息（不是 JSON 数据中的 error 字段）
        const firstLine = cleanResult.split('\n')[0]
        if (firstLine.startsWith('Error') || firstLine.includes('failed')) {
          setError('加载失败: ' + firstLine)
        } else {
          setError('未找到有效的任务数据')
        }
      }
    } catch (e) {
      console.error('Failed to load cron jobs', e)
      setError('加载定时任务失败')
    }
    setRefreshing(false)
  }

  const addJob = async () => {
    if (!newJob.name || !newJob.cron || !newJob.message) return
    if (!gatewayOnline) {
      alert('请先启动 Gateway')
      return
    }
    setLoading(true)
    try {
      const result = await window.electronAPI?.moltBOT.cronAdd({
        name: newJob.name,
        cron: newJob.cron,
        message: newJob.message,
        channel: 'telegram'
      })
      if (result?.includes('Error') || result?.includes('error')) {
        alert('添加失败: ' + result)
      } else {
        setShowAdd(false)
        setNewJob({ name: '', cron: '', message: '' })
        await loadJobs(true)  // 强制刷新
      }
    } finally {
      setLoading(false)
    }
  }

  const deleteJob = async (id: string, name: string) => {
    if (!gatewayOnline) {
      alert('请先启动 Gateway')
      return
    }
    if (!confirm(`确定删除任务 "${name}"?`)) return
    
    try {
      const result = await window.electronAPI?.moltBOT.cronRm(id)
      console.log('Delete result:', result)
      
      // 检查是否成功（成功时返回 {"ok": true, "removed": true}）
      const isSuccess = result?.includes('"removed": true') || result?.includes('"ok": true')
      
      if (isSuccess) {
        // 删除成功，强制重新加载列表
        await loadJobs(true)
      } else {
        alert('删除失败: ' + (result?.split('\n')[0] || '未知错误'))
      }
    } catch (e: any) {
      alert('删除失败: ' + (e?.message || '未知错误'))
    }
  }

  const runJob = async (id: string, name: string) => {
    if (!gatewayOnline) {
      alert('请先启动 Gateway')
      return
    }
    try {
      const result = await window.electronAPI?.moltBOT.cronRun(id)
      if (result?.includes('error') && !result?.includes('"error"')) {
        alert('执行失败: ' + result.split('\n')[0])
      } else {
        alert(`任务 "${name}" 已触发执行`)
      }
    } catch (e: any) {
      alert('执行失败: ' + e?.message)
    }
  }

  const toggleJob = async (id: string, enabled: boolean) => {
    if (!gatewayOnline) {
      alert('请先启动 Gateway')
      return
    }
    
    try {
      const result = await window.electronAPI?.moltBOT.cronToggle(id, !enabled)
      console.log('Toggle result:', result)
      
      // 检查是否成功（成功时返回包含 "enabled" 的 JSON）
      const isSuccess = result?.includes('"enabled"') || result?.includes('"id"')
      
      if (isSuccess) {
        // 操作成功，强制重新加载列表
        await loadJobs(true)
      } else {
        alert('操作失败: ' + (result?.split('\n')[0] || '未知错误'))
      }
    } catch (e: any) {
      alert('操作失败: ' + (e?.message || '未知错误'))
    }
  }

  useEffect(() => {
    loadJobs()
    const interval = setInterval(checkGateway, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="cron-manager">
      <div className="page-header">
        <h2><Clock size={24} /> 定时任务</h2>
        <div className="header-actions">
          <button className="btn-icon" onClick={loadJobs} disabled={refreshing} title="刷新">
            <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
          </button>
          <button className="primary" onClick={() => setShowAdd(true)} disabled={!gatewayOnline}>
            <Plus size={18} /> 添加任务
          </button>
        </div>
      </div>

      {!gatewayOnline && (
        <div className="gateway-warning">
          <AlertCircle size={16} />
          <span>Gateway 未运行，请先在仪表盘启动服务</span>
        </div>
      )}

      {error && (
        <div className="error-message">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {showAdd && (
        <div className="card add-form">
          <h3>添加新任务</h3>
          <div className="form-group">
            <label>任务名称</label>
            <input 
              value={newJob.name}
              onChange={e => setNewJob({...newJob, name: e.target.value})}
              placeholder="如: daily-report"
            />
          </div>
          <div className="form-group">
            <label>Cron 表达式</label>
            <input 
              value={newJob.cron}
              onChange={e => setNewJob({...newJob, cron: e.target.value})}
              placeholder="如: 0 9 * * * (每天9点)"
            />
            <small>分 时 日 月 周</small>
          </div>
          <div className="form-group">
            <label>执行内容</label>
            <textarea 
              value={newJob.message}
              onChange={e => setNewJob({...newJob, message: e.target.value})}
              placeholder="AI 要执行的任务描述..."
              rows={3}
            />
          </div>
          <div className="form-actions">
            <button className="secondary" onClick={() => setShowAdd(false)}>取消</button>
            <button className="primary" onClick={addJob} disabled={loading}>
              {loading ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      <div className="jobs-list">
        {jobs.length === 0 && !error ? (
          <div className="empty">{gatewayOnline ? '暂无定时任务' : '请先启动 Gateway'}</div>
        ) : jobs.length === 0 ? null : (
          jobs.map(job => (
            <div key={job.id} className={`job-card card ${!job.enabled ? 'disabled' : ''}`}>
              <div className="job-header">
                <span className="job-name">{job.name}</span>
                <span className="job-schedule">{job.schedule}</span>
              </div>
              <div className="job-message">{job.message}</div>
              <div className="job-footer">
                <span className="next-run">下次执行: {job.nextRun}</span>
                <div className="job-actions">
                  <button onClick={() => toggleJob(job.id, job.enabled)} title={job.enabled ? '禁用' : '启用'}>
                    {job.enabled ? <ToggleRight size={20} color="#4CAF50" /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => runJob(job.id, job.name)} title="立即执行">
                    <Play size={18} />
                  </button>
                  <button onClick={() => deleteJob(job.id, job.name)} title="删除" className="danger">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
