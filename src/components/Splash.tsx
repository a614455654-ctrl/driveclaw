import { useState, useEffect } from 'react'
import './Splash.css'

interface SplashProps {
  onComplete: () => void
}

export default function Splash({ onComplete }: SplashProps) {
  const [status, setStatus] = useState('初始化...')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const steps = [
      { text: '加载配置...', duration: 300 },
      { text: '检测 moltBOT...', duration: 400 },
      { text: '检查 Gateway 状态...', duration: 500 },
      { text: '准备就绪', duration: 300 },
    ]

    let currentStep = 0
    const runStep = () => {
      if (currentStep < steps.length) {
        setStatus(steps[currentStep].text)
        setProgress(((currentStep + 1) / steps.length) * 100)
        setTimeout(() => {
          currentStep++
          runStep()
        }, steps[currentStep].duration)
      } else {
        setTimeout(onComplete, 200)
      }
    }

    runStep()
  }, [onComplete])

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <div className="splash-logo">🦞</div>
        <h1 className="splash-title">DriveClaw</h1>
        <p className="splash-subtitle">moltBOT 控制面板</p>
        
        <div className="splash-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-text">{status}</div>
        </div>
        
        <div className="splash-version">v1.0.0</div>
      </div>
    </div>
  )
}
