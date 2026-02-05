import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Save, RefreshCw, FolderOpen, Key, Globe, MessageSquare, Zap, Moon, Sun, Monitor, Plus, Trash2, Check, Edit2, Download, Loader, Chrome, ExternalLink } from 'lucide-react'
import './Settings.css'

const APP_VERSION = '1.0.0'

interface Config {
  moltBOTPath: string
  gatewayPort: string
  model: string
  systemPrompt: string
  proxyUrl: string
  apiKey: string
}

interface AppSettings {
  autoStartGateway: boolean
  theme: 'dark' | 'light' | 'system'
  minimizeToTray: boolean
  showNotifications: boolean
  closeAction: 'ask' | 'minimize' | 'quit'
}

// API 配置档案
interface ApiProfile {
  id: string
  name: string
  provider: string  // nvidia, anthropic, openai, openrouter, custom
  model: string
  apiKey: string
  baseUrl?: string  // 自定义 API 端点
  isActive?: boolean
}

// 本地存储 key
const CONFIG_STORAGE_KEY = 'Driveclaw-settings-config'
const API_PROFILES_KEY = 'Driveclaw-api-profiles'
const moltBOT_UPDATE_STATE_KEY = 'Driveclaw-moltBOT-update-state'

// 加载本地配置
const loadLocalConfig = (): Partial<Config> => {
  try {
    const saved = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return {}
}

// 保存本地配置
const saveLocalConfig = (config: Config) => {
  try {
    // 不保存敏感信息到 localStorage
    const toSave = { ...config, apiKey: '' }
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(toSave))
  } catch {}
}

// 加载 API 配置档案
const loadApiProfiles = (): ApiProfile[] => {
  try {
    const saved = localStorage.getItem(API_PROFILES_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return []
}

// 保存 API 配置档案
const saveApiProfiles = (profiles: ApiProfile[]) => {
  try {
    localStorage.setItem(API_PROFILES_KEY, JSON.stringify(profiles))
  } catch {}
}

// Provider 配置
const PROVIDERS = [
  { id: 'nvidia', name: 'NVIDIA', prefix: 'nvidia/', placeholder: 'nvapi-xxx' },
  { id: 'anthropic', name: 'Anthropic', prefix: 'anthropic/', placeholder: 'sk-ant-xxx' },
  { id: 'openai', name: 'OpenAI', prefix: 'openai/', placeholder: 'sk-xxx' },
  { id: 'openrouter', name: 'OpenRouter', prefix: 'openrouter/', placeholder: 'sk-or-xxx' },
  { id: 'custom', name: '自定义', prefix: '', placeholder: 'your-api-key' },
]

export default function Settings() {
  const localConfig = loadLocalConfig()
  const [config, setConfig] = useState<Config>({
    moltBOTPath: 'D:\\项目\\moltBOT',
    gatewayPort: localConfig.gatewayPort || '18789',
    model: localConfig.model || '',
    systemPrompt: localConfig.systemPrompt || '',
    proxyUrl: localConfig.proxyUrl || 'http://127.0.0.1:7897',
    apiKey: ''
  })
  const [appSettings, setAppSettings] = useState<AppSettings>({
    autoStartGateway: false,
    theme: 'dark',
    minimizeToTray: true,
    showNotifications: true,
    closeAction: 'ask'
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)  // 指示是否已配置 API Key
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)
  const [confirmAction, setConfirmAction] = useState<{message: string, action: () => void} | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  
  // API 配置档案状态
  const [apiProfiles, setApiProfiles] = useState<ApiProfile[]>(loadApiProfiles)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ApiProfile | null>(null)
  const [newProfile, setNewProfile] = useState<Partial<ApiProfile>>({
    name: '',
    provider: 'nvidia',
    model: '',
    apiKey: '',
    baseUrl: ''
  })
  
  // moltBOT 部署状态
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployPath, setDeployPath] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [deployProgress, setDeployProgress] = useState('')
  const [deployLogs, setDeployLogs] = useState<string[]>([])
  
  // 版本检查
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; latestVersion?: string; releaseUrl?: string } | null>(null)
  
  // moltBOT 版本检查 - 从缓存加载状态
  const loadmoltBOTUpdateState = () => {
    try {
      const saved = localStorage.getItem(moltBOT_UPDATE_STATE_KEY)
      if (saved) {
        const state = JSON.parse(saved)
        // 检查是否过期（5分钟）
        if (state.timestamp && Date.now() - state.timestamp < 5 * 60 * 1000) {
          return state
        }
      }
    } catch {}
    return null
  }
  
  const cachedState = loadmoltBOTUpdateState()
  const [moltBOTVersion, setmoltBOTVersion] = useState<string>(cachedState?.version || '')
  const [checkingmoltBOTUpdate, setCheckingmoltBOTUpdate] = useState(false)
  const [moltBOTUpdateInfo, setmoltBOTUpdateInfo] = useState<{ hasUpdate: boolean; currentVersion?: string; latestVersion?: string; releaseUrl?: string } | null>(cachedState?.updateInfo || null)
  const [updatingmoltBOT, setUpdatingmoltBOT] = useState(cachedState?.updating || false)
  const [moltBOTUpdateLogs, setmoltBOTUpdateLogs] = useState<string[]>(cachedState?.logs || [])
  
  // 浏览器扩展状态
  const [extensionPath, setExtensionPath] = useState('')
  const [extensionExists, setExtensionExists] = useState(false)
  
  // moltBOT 路径配置
  const [moltBOTPath, setmoltBOTPath] = useState('')
  const [skillsPath, setSkillsPath] = useState('')
  const [searchedPaths, setSearchedPaths] = useState<string[]>([])
  const [searchingPaths, setSearchingPaths] = useState(false)
  const [showPathModal, setShowPathModal] = useState(false)
  
  // 保存 moltBOT 更新状态到缓存
  useEffect(() => {
    if (updatingmoltBOT || moltBOTUpdateInfo?.hasUpdate) {
      localStorage.setItem(moltBOT_UPDATE_STATE_KEY, JSON.stringify({
        version: moltBOTVersion,
        updateInfo: moltBOTUpdateInfo,
        updating: updatingmoltBOT,
        logs: moltBOTUpdateLogs,
        timestamp: Date.now()
      }))
    } else {
      // 更新完成后清除缓存
      localStorage.removeItem(moltBOT_UPDATE_STATE_KEY)
    }
  }, [moltBOTVersion, moltBOTUpdateInfo, updatingmoltBOT, moltBOTUpdateLogs])
  
  const electronAPI = (window as any).electronAPI

  const loadConfig = async () => {
    setLoading(true)
    try {
      // 从 moltBOT 配置文件读取实际值
      const moltBOTConfig = await electronAPI?.moltBOT.getConfig()
      
      if (moltBOTConfig) {
        // 获取当前主模型
        const primaryModel = moltBOTConfig.agents?.defaults?.model?.primary || ''
        // 获取 gateway 端口
        const gatewayPort = String(moltBOTConfig.gateway?.port || 18789)
        // 获取代理设置 (telegram channel 的 proxy)
        const proxyUrl = moltBOTConfig.channels?.telegram?.proxy || 'http://127.0.0.1:7897'
        // 获取系统提示词
        const systemPrompt = moltBOTConfig.agents?.defaults?.systemPrompt || ''

        // 检查是否已配置 API Key (根据模型判断 provider)
        let hasKey = false
        if (primaryModel.startsWith('nvidia/')) {
          hasKey = !!moltBOTConfig.models?.providers?.nvidia?.apiKey
        } else if (primaryModel.includes('anthropic') || primaryModel.includes('claude')) {
          hasKey = !!moltBOTConfig.models?.providers?.anthropic?.apiKey
        } else if (primaryModel.includes('openai') || primaryModel.includes('gpt')) {
          hasKey = !!moltBOTConfig.models?.providers?.openai?.apiKey
        } else {
          // 默认检查 nvidia
          hasKey = !!moltBOTConfig.models?.providers?.nvidia?.apiKey
        }
        setHasApiKey(hasKey)
        
        setConfig(prev => ({
          ...prev,
          model: primaryModel || prev.model,
          gatewayPort: gatewayPort,
          proxyUrl: proxyUrl,
          systemPrompt: systemPrompt || prev.systemPrompt,
        }))
      }
      
      // 加载应用设置
      const settings = await electronAPI?.settings.get()
      if (settings) setAppSettings(settings)
    } catch (error) {
      console.error('Failed to load config', error)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadConfig()
  }, [])
  
  // 配置变化时保存到 localStorage
  useEffect(() => {
    saveLocalConfig(config)
  }, [config])
  
  // 加载浏览器扩展路径
  useEffect(() => {
    const loadExtensionPath = async () => {
      const result = await electronAPI?.browserExtension?.getPath()
      if (result) {
        setExtensionPath(result.path)
        setExtensionExists(result.exists)
      }
    }
    loadExtensionPath()
  }, [])
  
  // 加载 moltBOT 路径
  useEffect(() => {
    const loadmoltBOTPath = async () => {
      const result = await electronAPI?.moltBOT.getPath()
      if (result?.success) {
        setmoltBOTPath(result.path)
        setSkillsPath(result.skillsPath)
      }
    }
    loadmoltBOTPath()
  }, [])
  
  // 自动搜索 moltBOT 路径
  const searchmoltBOTPaths = async () => {
    setSearchingPaths(true)
    try {
      const result = await electronAPI?.moltBOT.searchPaths()
      if (result?.success) {
        setSearchedPaths(result.paths || [])
      }
    } catch {}
    setSearchingPaths(false)
  }
  
  // 手动选择 moltBOT 路径
  const selectmoltBOTPath = async () => {
    const result = await electronAPI?.moltBOT.selectFolder()
    if (result?.path) {
      if (result.isValid) {
        await setNewmoltBOTPath(result.path)
      } else {
        // 询问是否仍然使用
        setConfirmAction({
          message: `该目录不包含 skills 或 memory 文件夹，确定要使用吗？\n\n路径: ${result.path}`,
          action: async () => {
            await setNewmoltBOTPath(result.path)
            setConfirmAction(null)
          }
        })
      }
    }
  }
  
  // 设置新的 moltBOT 路径
  const setNewmoltBOTPath = async (newPath: string) => {
    const result = await electronAPI?.moltBOT.setPath(newPath)
    if (result?.success) {
      setmoltBOTPath(result.path)
      setSkillsPath(result.skillsPath)
      showMessage('success', 'moltBOT 路径已更新')
      setShowPathModal(false)
    } else {
      showMessage('error', result?.error || '设置失败')
    }
  }
  
  // 打开扩展文件夹
  const openExtensionFolder = async () => {
    await electronAPI?.browserExtension?.openFolder()
  }
  
  // 打开 Chrome 扩展页面
  const openChromeExtensions = async () => {
    await electronAPI?.browserExtension?.openChromeExtensions()
  }
  
  const updateAppSetting = async (key: keyof AppSettings, value: any) => {
    try {
      const newSettings = await electronAPI?.settings.set(key, value)
      if (newSettings) setAppSettings(newSettings)
      
      // 如果是主题设置，立即应用
      if (key === 'theme') {
        let effectiveTheme = value
        if (value === 'system') {
          effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
        document.documentElement.setAttribute('data-theme', effectiveTheme)
      }
      
      showMessage('success', '设置已保存')
    } catch {
      showMessage('error', '保存失败')
    }
  }
  
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const saveConfig = async (key: string, value: string) => {
    setSaving(true)
    setMessage(null)
    try {
      // 映射简化 key 到实际配置路径
      let configPath = key
      let configValue: unknown = value
      
      switch (key) {
        case 'model':
          // 主模型路径
          configPath = 'agents.defaults.model.primary'
          break
        case 'apiKey':
          // API Key 需要保存到 provider - 根据当前模型判断
          // 如果模型以 nvidia/ 开头，保存到 nvidia provider
          if (config.model.startsWith('nvidia/')) {
            configPath = 'models.providers.nvidia.apiKey'
          } else if (config.model.includes('anthropic') || config.model.includes('claude')) {
            configPath = 'models.providers.anthropic.apiKey'
          } else if (config.model.includes('openai') || config.model.includes('gpt')) {
            configPath = 'models.providers.openai.apiKey'
          } else {
            // 默认保存到 nvidia
            configPath = 'models.providers.nvidia.apiKey'
          }
          break
        case 'gateway.port':
          configPath = 'gateway.port'
          configValue = parseInt(value) || 18789
          break
        case 'agent.proxy':
          configPath = 'channels.telegram.proxy'
          break
        case 'systemPrompt':
          configPath = 'agents.defaults.systemPrompt'
          break
        default:
          // 保持原样
          break
      }
      
      // 使用新的 updateConfig API
      const result = await electronAPI?.moltBOT.updateConfig({ [configPath]: configValue })
      
      if (result?.success) {
        showMessage('success', `${key} 已保存`)
      } else {
        showMessage('error', result?.error || '保存失败')
      }
    } catch (error) {
      showMessage('error', '保存失败')
    }
    setSaving(false)
  }

  const handleChange = (key: keyof Config, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const handleResetConfig = () => {
    setConfirmAction({
      message: '确定要重置所有配置吗？这将恢复默认设置。',
      action: async () => {
        setActionLoading(true)
        try {
          // 重置应用设置
          await electronAPI?.settings.save({
            autoStartGateway: false,
            theme: 'dark',
            minimizeToTray: true,
            showNotifications: true,
            closeAction: 'ask'
          })
          setAppSettings({
            autoStartGateway: false,
            theme: 'dark',
            minimizeToTray: true,
            showNotifications: true,
            closeAction: 'ask'
          })
          showMessage('success', '配置已重置')
          setConfirmAction(null)
        } catch {
          showMessage('error', '重置失败')
        }
        setActionLoading(false)
      }
    })
  }

  const handleClearMemory = () => {
    setConfirmAction({
      message: '确定要清除所有会话记录吗？这将删除所有历史对话。',
      action: async () => {
        setActionLoading(true)
        try {
          // 清除会话记录 - 删除 sessions 目录下的内容
          // 注意：这实际上是清除 sessions，memory 是向量索引需要通过 memory index --reindex 重建
          const result = await electronAPI?.runCommand('sessions', ['clear', '--confirm'])
          if (result?.success) {
            showMessage('success', '会话记录已清除')
          } else {
            // 如果没有 sessions clear 命令，尝试提示用户
            showMessage('error', '清除失败：会话清除命令不可用')
          }
          setConfirmAction(null)
        } catch {
          showMessage('error', '清除失败')
        }
        setActionLoading(false)
      }
    })
  }

  // ============ 检查更新 ============
  const checkForUpdates = async () => {
    setCheckingUpdate(true)
    try {
      // 模拟检查更新（实际应用中可以调用 GitHub API）
      // 暂时模拟已是最新版本
      await new Promise(resolve => setTimeout(resolve, 1000))
      setUpdateInfo({ hasUpdate: false })
      showMessage('success', '已是最新版本')
    } catch {
      showMessage('error', '检查更新失败')
    }
    setCheckingUpdate(false)
  }
  
  // ============ moltBOT 版本检查和更新 ============
  const loadmoltBOTVersion = async () => {
    try {
      const result = await electronAPI?.moltBOT.getVersion()
      if (result?.success && result.version) {
        const newVersion = result.version
        setmoltBOTVersion(newVersion)
        
        // 如果缓存显示正在更新，检查是否已完成
        if (cachedState?.updating && cachedState?.updateInfo?.latestVersion) {
          if (newVersion === cachedState.updateInfo.latestVersion) {
            // 版本已更新，清除更新状态
            setUpdatingmoltBOT(false)
            setmoltBOTUpdateInfo(null)
            setmoltBOTUpdateLogs([])
            showMessage('success', 'moltBOT 更新已完成')
          } else {
            // 更新可能失败或中断，重置状态
            setUpdatingmoltBOT(false)
            setmoltBOTUpdateLogs(prev => [...prev, '⚠️ 上次更新可能未完成，请重试'])
          }
        }
      }
    } catch {
      console.error('Failed to get moltBOT version')
    }
  }
  
  useEffect(() => {
    loadmoltBOTVersion()
  }, [])
  
  const checkmoltBOTUpdate = async () => {
    setCheckingmoltBOTUpdate(true)
    setmoltBOTUpdateInfo(null)
    try {
      const result = await electronAPI?.moltBOT.checkUpdate()
      if (result?.success) {
        setmoltBOTUpdateInfo({
          hasUpdate: result.hasUpdate,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          releaseUrl: result.releaseUrl
        })
        if (result.hasUpdate) {
          showMessage('success', `发现新版本 v${result.latestVersion}`)
        } else {
          showMessage('success', 'moltBOT 已是最新版本')
        }
      } else {
        showMessage('error', result?.error || '检查更新失败')
      }
    } catch {
      showMessage('error', '检查更新失败')
    }
    setCheckingmoltBOTUpdate(false)
  }
  
  const updatemoltBOT = async () => {
    setUpdatingmoltBOT(true)
    setmoltBOTUpdateLogs(['开始更新 moltBOT...'])
    try {
      const result = await electronAPI?.moltBOT.update()
      if (result?.success) {
        setmoltBOTUpdateLogs(prev => [...prev, '✅ 更新完成'])
        showMessage('success', 'moltBOT 更新成功')
        // 重新加载版本
        await loadmoltBOTVersion()
        setmoltBOTUpdateInfo(null)
      } else {
        setmoltBOTUpdateLogs(prev => [...prev, `❌ 更新失败: ${result?.error}`])
        showMessage('error', result?.error || '更新失败')
      }
    } catch (error) {
      setmoltBOTUpdateLogs(prev => [...prev, `❌ 更新失败: ${error}`])
      showMessage('error', '更新失败')
    }
    setUpdatingmoltBOT(false)
  }

  // ============ API 配置档案管理 ============
  
  // 保存档案到 localStorage
  useEffect(() => {
    saveApiProfiles(apiProfiles)
  }, [apiProfiles])
  
  // 打开新建档案弹窗
  const openNewProfileModal = () => {
    setEditingProfile(null)
    setNewProfile({
      name: '',
      provider: 'nvidia',
      model: '',
      apiKey: '',
      baseUrl: ''
    })
    setShowProfileModal(true)
  }
  
  // 打开编辑档案弹窗
  const openEditProfileModal = (profile: ApiProfile) => {
    setEditingProfile(profile)
    setNewProfile({ ...profile })
    setShowProfileModal(true)
  }
  
  // 保存档案
  const saveProfile = () => {
    if (!newProfile.name || !newProfile.model || !newProfile.apiKey) {
      showMessage('error', '请填写名称、模型和 API Key')
      return
    }
    
    if (editingProfile) {
      // 更新现有档案
      setApiProfiles(prev => prev.map(p => 
        p.id === editingProfile.id ? { ...p, ...newProfile } as ApiProfile : p
      ))
      showMessage('success', '档案已更新')
    } else {
      // 新建档案
      const profile: ApiProfile = {
        id: `profile-${Date.now()}`,
        name: newProfile.name!,
        provider: newProfile.provider || 'nvidia',
        model: newProfile.model!,
        apiKey: newProfile.apiKey!,
        baseUrl: newProfile.baseUrl,
        isActive: false
      }
      setApiProfiles(prev => [...prev, profile])
      showMessage('success', '档案已保存')
    }
    
    setShowProfileModal(false)
  }
  
  // 删除档案
  const deleteProfile = (id: string) => {
    setApiProfiles(prev => prev.filter(p => p.id !== id))
    showMessage('success', '档案已删除')
  }
  
  // 一键切换档案 - 核心功能
  const switchProfile = async (profile: ApiProfile) => {
    setSaving(true)
    try {
      // 构建完整的模型路径
      const provider = PROVIDERS.find(p => p.id === profile.provider)
      const fullModel = provider?.prefix ? `${provider.prefix}${profile.model}` : profile.model
      
      // 构建配置更新对象
      const updates: Record<string, unknown> = {
        'agents.defaults.model.primary': fullModel
      }
      
      // 根据 provider 设置 API Key
      if (profile.provider === 'nvidia') {
        updates['models.providers.nvidia.apiKey'] = profile.apiKey
      } else if (profile.provider === 'anthropic') {
        updates['models.providers.anthropic.apiKey'] = profile.apiKey
      } else if (profile.provider === 'openai') {
        updates['models.providers.openai.apiKey'] = profile.apiKey
      } else if (profile.provider === 'openrouter') {
        updates['models.providers.openrouter.apiKey'] = profile.apiKey
      } else if (profile.provider === 'custom' && profile.baseUrl) {
        // 自定义 provider
        updates['models.providers.custom.apiKey'] = profile.apiKey
        updates['models.providers.custom.baseUrl'] = profile.baseUrl
      }
      
      // 应用配置
      const result = await electronAPI?.moltBOT.updateConfig(updates)
      
      if (result?.success) {
        // 更新本地状态
        setApiProfiles(prev => prev.map(p => ({
          ...p,
          isActive: p.id === profile.id
        })))
        
        setConfig(prev => ({ ...prev, model: fullModel }))
        setHasApiKey(true)
        
        showMessage('success', `已切换到: ${profile.name}`)
        
        // 重新加载配置确认
        await loadConfig()
      } else {
        showMessage('error', result?.error || '切换失败')
      }
    } catch (error) {
      showMessage('error', '切换失败')
    }
    setSaving(false)
  }
  
  // 从当前配置创建档案
  const createProfileFromCurrent = () => {
    // 解析当前模型的 provider
    let provider = 'custom'
    let modelName = config.model
    
    for (const p of PROVIDERS) {
      if (p.prefix && config.model.startsWith(p.prefix)) {
        provider = p.id
        modelName = config.model.replace(p.prefix, '')
        break
      }
    }
    
    setEditingProfile(null)
    setNewProfile({
      name: `配置 ${apiProfiles.length + 1}`,
      provider,
      model: modelName,
      apiKey: '',  // 需要用户输入
      baseUrl: ''
    })
    setShowProfileModal(true)
  }
  
  // ============ moltBOT 一键部署 ============
  
  // 打开部署弹窗
  const openDeployModal = () => {
    setDeployPath('C:\\moltBOT')
    setDeploying(false)
    setDeployProgress('')
    setDeployLogs([])
    setShowDeployModal(true)
  }
  
  // 选择安装路径
  const selectDeployPath = async () => {
    try {
      const result = await electronAPI?.dialog?.selectFolder()
      if (result?.path) {
        setDeployPath(result.path)
      }
    } catch {}
  }
  
  // 执行部署
  const startDeploy = async () => {
    if (!deployPath) {
      showMessage('error', '请选择安装路径')
      return
    }
    
    setDeploying(true)
    setDeployLogs([])
    setDeployProgress('正在检查环境...')
    
    try {
      // 调用部署 API
      const result = await electronAPI?.moltBOT?.deploy(deployPath, (log: string) => {
        setDeployLogs(prev => [...prev, log])
        // 解析进度信息
        if (log.includes('[1/4]')) setDeployProgress('检查环境...')
        else if (log.includes('[2/4]')) setDeployProgress('下载 moltBOT...')
        else if (log.includes('[3/4]')) setDeployProgress('安装中...')
        else if (log.includes('[4/4]')) setDeployProgress('配置中...')
      })
      
      if (result?.success) {
        setDeployProgress('✅ 部署成功！')
        showMessage('success', 'moltBOT 部署成功！')
        // 更新配置中的路径
        setConfig(prev => ({ ...prev, moltBOTPath: deployPath }))
      } else {
        setDeployProgress(`❌ 部署失败: ${result?.error || '未知错误'}`)
        showMessage('error', result?.error || '部署失败')
      }
    } catch (e: any) {
      setDeployProgress(`❌ 部署失败: ${e.message}`)
      showMessage('error', e.message || '部署失败')
    }
    
    setDeploying(false)
  }

  return (
    <div className="page settings-page">
      <div className="page-header">
        <h2><SettingsIcon size={24} /> 设置</h2>
        <button className="btn-icon" onClick={loadConfig} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {message && (
        <div className={`message-toast ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="settings-section">
        <h3><Zap size={18} /> 应用设置</h3>
        <div className="card">
          <div className="setting-item toggle-item">
            <div className="setting-info">
              <label>自动启动 Gateway</label>
              <span className="hint">应用启动时自动启动 Gateway 服务</span>
            </div>
            <label className="toggle-switch">
              <input 
                type="checkbox" 
                checked={appSettings.autoStartGateway}
                onChange={e => updateAppSetting('autoStartGateway', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          <div className="setting-item toggle-item">
            <div className="setting-info">
              <label>切换模型时自动重启 Gateway</label>
              <span className="hint">切换模型后自动重启 Gateway 以应用新配置</span>
            </div>
            <label className="toggle-switch">
              <input 
                type="checkbox" 
                checked={localStorage.getItem('Driveclaw_auto_restart_gateway') !== 'false'}
                onChange={e => {
                  localStorage.setItem('Driveclaw_auto_restart_gateway', String(e.target.checked));
                  // 强制重新渲染
                  setAppSettings(prev => ({...prev}));
                }}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          <div className="setting-item toggle-item">
            <div className="setting-info">
              <label>显示通知</label>
              <span className="hint">显示系统通知提醒</span>
            </div>
            <label className="toggle-switch">
              <input 
                type="checkbox" 
                checked={appSettings.showNotifications}
                onChange={e => updateAppSetting('showNotifications', e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
          <div className="setting-item">
            <div className="setting-info">
              <label>关闭窗口时</label>
              <span className="hint">选择点击关闭按钮时的行为</span>
            </div>
            <div className="close-action-selector">
              <button 
                className={`close-btn ${appSettings.closeAction === 'ask' ? 'active' : ''}`}
                onClick={() => updateAppSetting('closeAction', 'ask')}
              >
                每次询问
              </button>
              <button 
                className={`close-btn ${appSettings.closeAction === 'minimize' ? 'active' : ''}`}
                onClick={() => updateAppSetting('closeAction', 'minimize')}
              >
                最小化到后台
              </button>
              <button 
                className={`close-btn ${appSettings.closeAction === 'quit' ? 'active' : ''}`}
                onClick={() => updateAppSetting('closeAction', 'quit')}
              >
                退出程序
              </button>
            </div>
          </div>
          <div className="setting-item">
            <label>界面主题</label>
            <div className="theme-selector">
              <button 
                className={`theme-btn ${appSettings.theme === 'dark' ? 'active' : ''}`}
                onClick={() => updateAppSetting('theme', 'dark')}
              >
                <Moon size={16} /> 深色
              </button>
              <button 
                className={`theme-btn ${appSettings.theme === 'light' ? 'active' : ''}`}
                onClick={() => updateAppSetting('theme', 'light')}
              >
                <Sun size={16} /> 浅色
              </button>
              <button 
                className={`theme-btn ${appSettings.theme === 'system' ? 'active' : ''}`}
                onClick={() => updateAppSetting('theme', 'system')}
              >
                <Monitor size={16} /> 跟随系统
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3><FolderOpen size={18} /> 基础配置</h3>
        <div className="card">
          <div className="setting-item path-setting">
            <div className="setting-info">
              <label>moltBOT 工作目录</label>
              <span className="hint">技能将安装到此目录下的 skills 文件夹</span>
            </div>
            <div className="path-display">
              <code className="current-path">{moltBOTPath || '未配置'}</code>
              <button className="btn-small btn-primary-small" onClick={() => setShowPathModal(true)}>
                <FolderOpen size={14} /> 配置路径
              </button>
            </div>
            {skillsPath && (
              <div className="skills-path-info">
                <span className="skills-label">技能目录:</span>
                <code>{skillsPath}</code>
              </div>
            )}
          </div>
          <div className="setting-item deploy-item">
            <div className="setting-info">
              <label>一键部署 moltBOT</label>
              <span className="hint">从 GitHub 下载并自动安装最新版 moltBOT</span>
            </div>
            <button className="btn-deploy" onClick={openDeployModal}>
              <Download size={16} /> 一键部署
            </button>
          </div>
          
          <div className="version-row">
            <div className="version-card">
              <label>Driveclaw 版本</label>
              <div className="version-number">v{APP_VERSION}</div>
              {updateInfo?.hasUpdate && (
                <span className="update-badge">新版本 v{updateInfo.latestVersion}</span>
              )}
              <button 
                className="btn-check-update" 
                onClick={checkForUpdates}
                disabled={checkingUpdate}
              >
                {checkingUpdate ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                检查更新
              </button>
            </div>
            
            <div className="version-card">
              <label>moltBOT 版本</label>
              <div className="version-number">{moltBOTVersion ? `v${moltBOTVersion}` : '未检测到'}</div>
              {moltBOTUpdateInfo?.hasUpdate && (
                <span className="update-badge">新版本 v{moltBOTUpdateInfo.latestVersion}</span>
              )}
              <div className="version-buttons">
                <button 
                  className="btn-check-update" 
                  onClick={checkmoltBOTUpdate}
                  disabled={checkingmoltBOTUpdate || updatingmoltBOT}
                >
                  {checkingmoltBOTUpdate ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                  检查更新
                </button>
                {moltBOTUpdateInfo?.hasUpdate && (
                  <button 
                    className="btn-update-moltBOT"
                    onClick={updatemoltBOT}
                    disabled={updatingmoltBOT}
                  >
                    {updatingmoltBOT ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
                    一键更新
                  </button>
                )}
              </div>
            </div>
          </div>
          
          {updatingmoltBOT && moltBOTUpdateLogs.length > 0 && (
            <div className="update-logs">
              {moltBOTUpdateLogs.map((log, i) => (
                <div key={i} className="update-log-line">{log}</div>
              ))}
            </div>
          )}
          <div className="setting-item">
            <label>Gateway 端口</label>
            <div className="setting-input">
              <input 
                type="text" 
                value={config.gatewayPort}
                onChange={e => handleChange('gatewayPort', e.target.value)}
              />
              <button 
                className="btn-save"
                onClick={() => saveConfig('gateway.port', config.gatewayPort)}
                disabled={saving}
              >
                <Save size={14} />
              </button>
            </div>
            <span className="hint">修改后需重启 Gateway 生效</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3><Globe size={18} /> 网络设置</h3>
        <div className="card">
          <div className="setting-item">
            <label>代理地址</label>
            <div className="setting-input">
              <input 
                type="text" 
                value={config.proxyUrl}
                onChange={e => handleChange('proxyUrl', e.target.value)}
                placeholder="http://127.0.0.1:7897"
              />
              <button 
                className="btn-save"
                onClick={() => saveConfig('agent.proxy', config.proxyUrl)}
                disabled={saving}
              >
                <Save size={14} />
              </button>
            </div>
            <span className="hint">用于访问外网 API（设置 agent.proxy）</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3><Chrome size={18} /> 浏览器扩展</h3>
        <div className="card">
          <div className="browser-extension-section">
            <div className="extension-info">
              <div className="extension-header">
                <span className="extension-title">moltBOT Browser Relay</span>
                {extensionExists ? (
                  <span className="status-badge ready">✓ 可用</span>
                ) : (
                  <span className="status-badge missing">未安装</span>
                )}
              </div>
              <p className="extension-desc">安装此扩展后，moltBOT 可以读取和控制浏览器标签页</p>
            </div>
            <div className="extension-actions">
              <button className="btn-extension" onClick={openExtensionFolder} disabled={!extensionExists}>
                <FolderOpen size={14} /> 打开扩展目录
              </button>
              <button className="btn-extension primary" onClick={openChromeExtensions}>
                <ExternalLink size={14} /> Chrome 扩展页面
              </button>
            </div>
          </div>
          <div className="extension-steps">
            <p className="steps-title">安装步骤：</p>
            <ol>
              <li>点击上方「Chrome 扩展页面」按钮</li>
              <li>开启右上角「开发者模式」</li>
              <li>点击「加载已解压的扩展程序」</li>
              <li>选择扩展目录：<code>{extensionPath || 'assets/chrome-extension'}</code></li>
              <li>在需要控制的网页上点击扩展图标连接</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3><Key size={18} /> API 配置</h3>
        
        {/* 当前配置状态 */}
        <div className="card current-api-card">
          <div className="current-api-header">
            <span className="current-label">当前使用</span>
            {hasApiKey && <span className="status-badge configured">✓ 已配置</span>}
          </div>
          <div className="current-api-model">{config.model || '未配置'}</div>
        </div>
        
        {/* API 配置档案列表 */}
        <div className="card">
          <div className="profile-header">
            <span className="profile-title">保存的配置档案</span>
            <div className="profile-actions">
              <button className="btn-small" onClick={createProfileFromCurrent} title="从当前配置创建">
                <Save size={14} /> 保存当前
              </button>
              <button className="btn-small btn-primary-small" onClick={openNewProfileModal}>
                <Plus size={14} /> 新建档案
              </button>
            </div>
          </div>
          
          {apiProfiles.length === 0 ? (
            <div className="empty-profiles">
              <p>暂无保存的配置档案</p>
              <span className="hint">点击"新建档案"添加 API 配置，方便快速切换</span>
            </div>
          ) : (
            <div className="profile-list">
              {apiProfiles.map(profile => (
                <div key={profile.id} className={`profile-item ${profile.isActive ? 'active' : ''}`}>
                  <div className="profile-info">
                    <div className="profile-name">
                      {profile.name}
                      {profile.isActive && <span className="active-badge">当前</span>}
                    </div>
                    <div className="profile-details">
                      <span className="provider-tag">{PROVIDERS.find(p => p.id === profile.provider)?.name || profile.provider}</span>
                      <span className="model-name">{profile.model}</span>
                    </div>
                  </div>
                  <div className="profile-buttons">
                    <button 
                      className="btn-switch"
                      onClick={() => switchProfile(profile)}
                      disabled={saving || profile.isActive}
                      title="切换到此配置"
                    >
                      <Check size={14} /> 切换
                    </button>
                    <button 
                      className="btn-icon-small"
                      onClick={() => openEditProfileModal(profile)}
                      title="编辑"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button 
                      className="btn-icon-small btn-danger-icon"
                      onClick={() => deleteProfile(profile.id)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 手动配置 */}
        <div className="card">
          <div className="setting-item">
            <label>手动设置模型</label>
            <div className="setting-input">
              <input 
                type="text" 
                value={config.model}
                onChange={e => handleChange('model', e.target.value)}
                placeholder="nvidia/deepseek-ai/deepseek-v3.2"
              />
              <button 
                className="btn-save"
                onClick={() => saveConfig('model', config.model)}
                disabled={saving}
              >
                <Save size={14} />
              </button>
            </div>
            <span className="hint">格式: provider/model-name，如 nvidia/meta/llama-3.3-70b-instruct</span>
          </div>
          <div className="setting-item">
            <label>API Key</label>
            <div className="setting-input">
              <input 
                type="password" 
                value={config.apiKey}
                onChange={e => handleChange('apiKey', e.target.value)}
                placeholder={hasApiKey ? '已配置，输入新密钥替换' : 'nvapi-xxxx 或 sk-xxxx'}
              />
              <button 
                className="btn-save"
                onClick={() => saveConfig('apiKey', config.apiKey)}
                disabled={saving || !config.apiKey}
              >
                <Save size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3><MessageSquare size={18} /> AI 设置</h3>
        <div className="card">
          <div className="setting-item">
            <label>系统提示词</label>
            <div className="setting-input full">
              <textarea 
                value={config.systemPrompt}
                onChange={e => handleChange('systemPrompt', e.target.value)}
                placeholder="你是一个智能助手..."
                rows={4}
              />
            </div>
            <button 
              className="btn-primary"
              onClick={() => saveConfig('systemPrompt', config.systemPrompt)}
              disabled={saving}
            >
              <Save size={14} /> 保存提示词
            </button>
          </div>
        </div>
      </div>

      <div className="card danger-zone">
        <h3>⚠️ 危险区域</h3>
        <div className="danger-actions">
          <button className="btn-danger" onClick={handleResetConfig}>重置所有配置</button>
          <button className="btn-danger" onClick={handleClearMemory}>清除记忆数据</button>
        </div>
        <p className="danger-hint">警告：这些操作不可撤销，请谨慎操作</p>
      </div>

      {/* 确认弹窗 */}
      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠️ 确认操作</h3>
              <button className="btn-icon" onClick={() => setConfirmAction(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="confirm-message">{confirmAction.message}</p>
              <p className="confirm-warning">此操作不可撤销！</p>
              <div className="confirm-actions">
                <button className="btn-secondary" onClick={() => setConfirmAction(null)}>取消</button>
                <button 
                  className="btn-danger" 
                  onClick={confirmAction.action}
                  disabled={actionLoading}
                >
                  {actionLoading ? '执行中...' : '确认执行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* moltBOT 部署弹窗 */}
      {showDeployModal && (
        <div className="modal-overlay" onClick={() => !deploying && setShowDeployModal(false)}>
          <div className="modal-content modal-deploy" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Download size={18} /> 一键部署 moltBOT</h3>
              {!deploying && (
                <button className="btn-icon" onClick={() => setShowDeployModal(false)}>✕</button>
              )}
            </div>
            <div className="modal-body">
              <p className="deploy-desc">
                将从 GitHub 下载最新版 moltBOT 并自动安装到指定目录。
              </p>
              
              <div className="form-group">
                <label>安装路径</label>
                <div className="path-input-group">
                  <input 
                    type="text"
                    value={deployPath}
                    onChange={e => setDeployPath(e.target.value)}
                    placeholder="C:\\moltBOT"
                    disabled={deploying}
                  />
                  <button 
                    className="btn-browse" 
                    onClick={selectDeployPath}
                    disabled={deploying}
                  >
                    <FolderOpen size={14} /> 浏览
                  </button>
                </div>
              </div>
              
              {deployProgress && (
                <div className={`deploy-status ${deployProgress.includes('✅') ? 'success' : deployProgress.includes('❌') ? 'error' : ''}`}>
                  {deploying && <Loader className="spin" size={16} />}
                  <span>{deployProgress}</span>
                </div>
              )}
              
              {deployLogs.length > 0 && (
                <div className="deploy-logs">
                  <div className="logs-header">部署日志</div>
                  <div className="logs-content">
                    {deployLogs.map((log, i) => (
                      <div key={i} className="log-line">{log}</div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="modal-actions">
                {!deploying ? (
                  <>
                    <button className="btn-secondary" onClick={() => setShowDeployModal(false)}>
                      取消
                    </button>
                    <button className="btn-primary" onClick={startDeploy}>
                      <Download size={14} /> 开始部署
                    </button>
                  </>
                ) : (
                  <button className="btn-secondary" disabled>
                    <Loader className="spin" size={14} /> 部署中...
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* API 档案编辑弹窗 */}
      {showProfileModal && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal-content modal-profile" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingProfile ? '编辑档案' : '新建 API 档案'}</h3>
              <button className="btn-icon" onClick={() => setShowProfileModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>档案名称</label>
                <input 
                  type="text"
                  value={newProfile.name || ''}
                  onChange={e => setNewProfile(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="例如: NVIDIA DeepSeek"
                />
              </div>
              
              <div className="form-group">
                <label>API 提供商</label>
                <div className="provider-selector">
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      className={`provider-btn ${newProfile.provider === p.id ? 'active' : ''}`}
                      onClick={() => setNewProfile(prev => ({ ...prev, provider: p.id }))}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="form-group">
                <label>模型名称</label>
                <input 
                  type="text"
                  value={newProfile.model || ''}
                  onChange={e => setNewProfile(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="例如: meta/llama-3.3-70b-instruct"
                />
                <span className="form-hint">
                  完整路径将为: {PROVIDERS.find(p => p.id === newProfile.provider)?.prefix || ''}{newProfile.model || 'model-name'}
                </span>
              </div>
              
              <div className="form-group">
                <label>API Key</label>
                <input 
                  type="password"
                  value={newProfile.apiKey || ''}
                  onChange={e => setNewProfile(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={PROVIDERS.find(p => p.id === newProfile.provider)?.placeholder || 'your-api-key'}
                />
              </div>
              
              {newProfile.provider === 'custom' && (
                <div className="form-group">
                  <label>Base URL (可选)</label>
                  <input 
                    type="text"
                    value={newProfile.baseUrl || ''}
                    onChange={e => setNewProfile(prev => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
              )}
              
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setShowProfileModal(false)}>取消</button>
                <button className="btn-primary" onClick={saveProfile}>
                  <Save size={14} /> {editingProfile ? '保存修改' : '创建档案'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* moltBOT 路径配置弹窗 */}
      {showPathModal && (
        <div className="modal-overlay" onClick={() => setShowPathModal(false)}>
          <div className="modal-content modal-path" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><FolderOpen size={18} /> 配置 moltBOT 路径</h3>
              <button className="btn-icon" onClick={() => setShowPathModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="current-path-section">
                <label>当前路径</label>
                <code className="path-code">{moltBOTPath || '未配置'}</code>
              </div>
              
              <div className="path-actions">
                <button 
                  className="btn-secondary"
                  onClick={() => {
                    searchmoltBOTPaths()
                  }}
                  disabled={searchingPaths}
                >
                  {searchingPaths ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                  自动搜索
                </button>
                <button className="btn-primary" onClick={selectmoltBOTPath}>
                  <FolderOpen size={14} /> 手动选择
                </button>
              </div>
              
              {searchedPaths.length > 0 && (
                <div className="searched-paths">
                  <label>发现的 moltBOT 目录</label>
                  <div className="path-list">
                    {searchedPaths.map((p, i) => (
                      <div 
                        key={i} 
                        className={`path-item ${p === moltBOTPath ? 'active' : ''}`}
                        onClick={() => setNewmoltBOTPath(p)}
                      >
                        <code>{p}</code>
                        {p === moltBOTPath && <span className="current-badge">当前</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="path-tips">
                <p><strong>💡 提示:</strong></p>
                <ul>
                  <li>选择包含 <code>skills</code> 和 <code>memory</code> 文件夹的目录</li>
                  <li>技能将安装到 <code>skills</code> 子目录中</li>
                  <li>修改后需要重启 Gateway 才能生效</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
