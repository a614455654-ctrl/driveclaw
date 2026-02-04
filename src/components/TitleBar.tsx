import { Minus, Square, X } from 'lucide-react'
import './TitleBar.css'

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
      }
      moltBOT: any
      gateway: any
    }
  }
}

interface TitleBarProps {
  title: string
}

export default function TitleBar({ title }: TitleBarProps) {
  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-logo">🦞</span>
        <span className="titlebar-title">Drivemolt</span>
        <span className="titlebar-separator">|</span>
        <span className="titlebar-page">{title}</span>
      </div>
      <div className="titlebar-controls">
        <button onClick={() => window.electronAPI?.window.minimize()} className="control-btn">
          <Minus size={16} />
        </button>
        <button onClick={() => window.electronAPI?.window.maximize()} className="control-btn">
          <Square size={14} />
        </button>
        <button onClick={() => window.electronAPI?.window.close()} className="control-btn close">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
