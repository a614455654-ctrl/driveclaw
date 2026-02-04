import { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import Splash from './components/Splash'
import CommandPalette from './components/CommandPalette'
import Dashboard from './pages/Dashboard'
import Chat from './pages/Chat'
import CronManager from './pages/CronManager'
import Memory from './pages/Memory'
import Channels from './pages/Channels'
import Skills from './pages/Skills'
import Models from './pages/Models'
import Heartbeat from './pages/Heartbeat'
import Moltbook from './pages/Moltbook'
import Settings from './pages/Settings'
import './App.css'

type Page = 'dashboard' | 'chat' | 'cron' | 'memory' | 'channels' | 'skills' | 'models' | 'heartbeat' | 'Moltbook' | 'settings'
type Theme = 'dark' | 'light' | 'system'

const electronAPI = (window as any).electronAPI

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [showSplash, setShowSplash] = useState(true)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [theme, setTheme] = useState<Theme>('dark')

  const pages: Page[] = ['dashboard', 'chat', 'cron', 'memory', 'channels', 'skills', 'models', 'heartbeat', 'Moltbook', 'settings']

  const handleGatewayStart = useCallback(async () => {
    await electronAPI?.gateway.start()
    await electronAPI?.notify('Gateway 已启动', '')
  }, [])

  const handleGatewayStop = useCallback(async () => {
    await electronAPI?.gateway.stop()
    await electronAPI?.notify('Gateway 已停止', '')
  }, [])

  // 加载并应用主题
  const applyTheme = useCallback((t: Theme) => {
    let effectiveTheme = t
    if (t === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    setTheme(t)
  }, [])

  useEffect(() => {
    // 加载保存的主题设置
    const loadTheme = async () => {
      try {
        const settings = await electronAPI?.settings.get()
        if (settings?.theme) {
          applyTheme(settings.theme)
        }
      } catch {}
    }
    loadTheme()

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system')
      }
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [applyTheme, theme])

  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K 打开命令面板
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
        return
      }

      // Ctrl+1-8 切换页面
      if (e.ctrlKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault()
        const index = parseInt(e.key) - 1
        if (pages[index]) {
          setCurrentPage(pages[index])
        }
        return
      }

      // Ctrl+G 启动 Gateway
      if (e.ctrlKey && e.key === 'g') {
        e.preventDefault()
        handleGatewayStart()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleGatewayStart, pages])

  if (showSplash) {
    return <Splash onComplete={() => setShowSplash(false)} />
  }

  const getPageTitle = () => {
    const titles: Record<Page, string> = {
      dashboard: '仪表盘',
      chat: '对话',
      cron: '定时任务',
      memory: '记忆',
      channels: '渠道',
      skills: '技能',
      models: '模型',
      heartbeat: '心跳',
      Moltbook: 'Moltbook',
      settings: '设置',
    }
    return titles[currentPage]
  }

  // 页面组件样式 - 使用 CSS 控制显示/隐藏，避免组件卸载
  const pageStyle = (page: Page): React.CSSProperties => ({
    display: currentPage === page ? 'flex' : 'none',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    overflow: 'auto'
  })

  return (
    <div className="app">
      <TitleBar title={getPageTitle()} />
      <div className="app-body">
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
        <main className="main-content">
          {/* 所有页面保持挂载，用 CSS 切换显示 */}
          <div style={pageStyle('dashboard')}><Dashboard /></div>
          <div style={pageStyle('chat')}><Chat /></div>
          <div style={pageStyle('cron')}><CronManager /></div>
          <div style={pageStyle('memory')}><Memory /></div>
          <div style={pageStyle('channels')}><Channels /></div>
          <div style={pageStyle('skills')}><Skills /></div>
          <div style={pageStyle('models')}><Models /></div>
          <div style={pageStyle('heartbeat')}><Heartbeat /></div>
          <div style={pageStyle('Moltbook')}><Moltbook /></div>
          <div style={pageStyle('settings')}><Settings /></div>
        </main>
      </div>
      
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNavigate={(page) => setCurrentPage(page as Page)}
        onGatewayStart={handleGatewayStart}
        onGatewayStop={handleGatewayStop}
      />
    </div>
  )
}

export default App
