import { useState, useEffect, useRef } from 'react'
import {
  LayoutDashboard, MessageSquare, Clock, Brain,
  Radio, Puzzle, Cpu, Settings, Power, Play, RefreshCw,
  X, Command
} from 'lucide-react'
import './CommandPalette.css'

interface CommandItem {
  id: string
  name: string
  icon: React.ReactNode
  shortcut?: string
  action: () => void
  category: 'navigation' | 'action' | 'gateway'
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (page: string) => void
  onGatewayStart: () => void
  onGatewayStop: () => void
}

export default function CommandPalette({ 
  isOpen, 
  onClose, 
  onNavigate,
  onGatewayStart,
  onGatewayStop
}: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands: CommandItem[] = [
    // 导航
    { id: 'dashboard', name: '仪表盘', icon: <LayoutDashboard size={16} />, shortcut: 'Ctrl+1', action: () => onNavigate('dashboard'), category: 'navigation' },
    { id: 'chat', name: '对话', icon: <MessageSquare size={16} />, shortcut: 'Ctrl+2', action: () => onNavigate('chat'), category: 'navigation' },
    { id: 'cron', name: '定时任务', icon: <Clock size={16} />, shortcut: 'Ctrl+3', action: () => onNavigate('cron'), category: 'navigation' },
    { id: 'memory', name: '记忆', icon: <Brain size={16} />, shortcut: 'Ctrl+4', action: () => onNavigate('memory'), category: 'navigation' },
    { id: 'channels', name: '渠道', icon: <Radio size={16} />, shortcut: 'Ctrl+5', action: () => onNavigate('channels'), category: 'navigation' },
    { id: 'skills', name: '技能', icon: <Puzzle size={16} />, shortcut: 'Ctrl+6', action: () => onNavigate('skills'), category: 'navigation' },
    { id: 'models', name: '模型', icon: <Cpu size={16} />, shortcut: 'Ctrl+7', action: () => onNavigate('models'), category: 'navigation' },
    { id: 'settings', name: '设置', icon: <Settings size={16} />, shortcut: 'Ctrl+8', action: () => onNavigate('settings'), category: 'navigation' },
    // Gateway
    { id: 'gateway-start', name: '启动 Gateway', icon: <Power size={16} />, shortcut: 'Ctrl+G', action: onGatewayStart, category: 'gateway' },
    { id: 'gateway-stop', name: '停止 Gateway', icon: <Power size={16} />, action: onGatewayStop, category: 'gateway' },
    // 操作
    { id: 'run-morning', name: '执行早报任务', icon: <Play size={16} />, action: () => {
      (window as any).electronAPI?.moltBOT.cronRun('morning-report')
    }, category: 'action' },
    { id: 'refresh', name: '刷新状态', icon: <RefreshCw size={16} />, shortcut: 'Ctrl+R', action: () => window.location.reload(), category: 'action' },
  ]

  const filteredCommands = commands.filter(cmd => 
    cmd.name.toLowerCase().includes(search.toLowerCase()) ||
    cmd.id.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  useEffect(() => {
    // 滚动到选中项
    if (listRef.current) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action()
          onClose()
        }
        break
      case 'Escape':
        onClose()
        break
    }
  }

  const executeCommand = (cmd: CommandItem) => {
    cmd.action()
    onClose()
  }

  const getCategoryName = (cat: string) => {
    switch (cat) {
      case 'navigation': return '导航'
      case 'gateway': return 'Gateway'
      case 'action': return '操作'
      default: return cat
    }
  }

  if (!isOpen) return null

  // 按类别分组
  const groupedCommands: Record<string, CommandItem[]> = {}
  filteredCommands.forEach(cmd => {
    if (!groupedCommands[cmd.category]) {
      groupedCommands[cmd.category] = []
    }
    groupedCommands[cmd.category].push(cmd)
  })

  let flatIndex = 0

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-search">
          <Command size={18} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令..."
          />
          <button className="close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        
        <div className="command-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="no-results">没有匹配的命令</div>
          ) : (
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="command-group">
                <div className="group-label">{getCategoryName(category)}</div>
                {cmds.map(cmd => {
                  const index = flatIndex++
                  return (
                    <div
                      key={cmd.id}
                      className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <span className="command-icon">{cmd.icon}</span>
                      <span className="command-name">{cmd.name}</span>
                      {cmd.shortcut && (
                        <span className="command-shortcut">{cmd.shortcut}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
        
        <div className="command-footer">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
