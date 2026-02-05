# Driveclaw

<p align="center">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite">
</p>

**Driveclaw** 是 [moltBOT/OpenClaw](https://github.com/anthropics/claude-code) 的桌面控制面板，提供可视化界面来管理和监控你的 AI 助手。

![Dashboard Preview](docs/screenshot.png)

## ✨ 特性

### 🎮 核心功能
- **Gateway 管理** - 一键启动/停止 WebSocket Gateway，实时监控运行状态
- **实时对话** - 支持流式输出的聊天界面，查看 AI 思考过程
- **多渠道会话** - 管理来自 Telegram/Discord/WhatsApp 等渠道的会话
- **定时任务** - 可视化管理 Cron 任务，支持 CRON 表达式和简单间隔

### 🛠️ 扩展能力
- **技能市场** - 集成 ClawHub，一键安装扩展技能
- **MCP 服务器** - 集成 Smithery，浏览和安装 MCP 服务器
- **记忆搜索** - 搜索 AI 的长期记忆
- **模型管理** - 支持多个 API 提供商（OpenAI, Anthropic, DeepSeek, OpenRouter, NVIDIA）

### 📊 监控与运维
- **仪表盘** - 系统状态、资源使用、实时监控
- **心跳系统** - 配置和监控 AI 心跳，编辑 HEARTBEAT.md
- **Moltbook** - 自主 Agent 管理，让 AI 自动浏览和互动

### 🎨 用户体验
- **系统托盘** - 最小化到托盘，后台运行
- **主题切换** - 支持深色/浅色/跟随系统
- **命令面板** - `Ctrl+K` 快速执行命令
- **快捷键** - `Ctrl+1-8` 切换页面，`Ctrl+G` 启动 Gateway

## 🚀 快速开始

### 环境要求
- Node.js 18+
- moltBOT/OpenClaw 已安装并配置

### 安装

```bash
# 克隆仓库
git clone https://github.com/a614455654-ctrl/Driveclaw.git
cd Driveclaw

# 安装依赖
npm install

# 开发模式
npm run electron:dev

# 构建生产版本
npm run electron:build
```

### 配置

首次运行时，请在设置页配置：
1. **工作目录** - 指向你的 moltBOT 工作目录（包含 skills, memory 等）
2. **API 密钥** - 配置你的 LLM API 密钥

## 📸 截图

| 仪表盘 | 对话 | 技能市场 |
|---------|------|----------|
| 系统状态一览 | 流式 AI 对话 | 浏览安装技能 |

## 🛠️ 技术栈

- **框架**: Electron 33 + React 18
- **语言**: TypeScript 5
- **构建**: Vite 6
- **通信**: WebSocket (ws)
- **UI**: Lucide React Icons
- **路由**: React Router DOM

## 📁 项目结构

```
Driveclaw/
├── electron/          # Electron 主进程
│   ├── main.ts        # 主进程入口
│   └── preload.ts     # 预加载脚本
├── src/               # React 前端
│   ├── components/    # 通用组件
│   ├── pages/         # 页面组件
│   ├── App.tsx        # 应用入口
│   └── main.tsx       # React 入口
├── docs/              # 文档
└── resources/         # 应用资源
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+K` | 打开命令面板 |
| `Ctrl+G` | 启动 Gateway |
| `Ctrl+1-8` | 切换页面 |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT License - 详见 [LICENSE](LICENSE) 文件
