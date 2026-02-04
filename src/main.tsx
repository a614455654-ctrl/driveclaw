import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 暂时禁用 StrictMode 以解决开发模式下的双重挂载问题
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
