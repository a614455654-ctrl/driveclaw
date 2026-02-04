import { Home, MessageSquare, Clock, Brain, Radio, Wrench, Bot, Heart, Globe, Settings } from 'lucide-react'
import './Sidebar.css'

type Page = 'dashboard' | 'chat' | 'cron' | 'memory' | 'channels' | 'skills' | 'models' | 'heartbeat' | 'Moltbook' | 'settings'

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

const menuItems: { id: Page; icon: any; label: string }[] = [
  { id: 'dashboard', icon: Home, label: '仪表盘' },
  { id: 'chat', icon: MessageSquare, label: '对话' },
  { id: 'cron', icon: Clock, label: '定时任务' },
  { id: 'memory', icon: Brain, label: '记忆' },
  { id: 'channels', icon: Radio, label: '渠道' },
  { id: 'skills', icon: Wrench, label: '技能' },
  { id: 'models', icon: Bot, label: '模型' },
  { id: 'heartbeat', icon: Heart, label: '心跳' },
  { id: 'Moltbook', icon: Globe, label: 'Moltbook' },
  { id: 'settings', icon: Settings, label: '设置' },
]

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {menuItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="version">v1.0.0</div>
      </div>
    </aside>
  )
}
