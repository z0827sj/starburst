# 🌟 StarBurst — GitHub 全站星星异常增长监控

实时监控 GitHub 全站仓库的 Star 增长，通过多窗口速度检测算法识别爆发式涨星，提供跨平台（npm / PyPI）信号聚合和开发者生态排名。

> [English Docs](README.md)

## 功能特性

**🔥 实时爆发检测**
- 多时间窗口（3/5/10/15/30 分钟）速度分析，自动找到最佳检测窗口
- Hot Score 衰减算法：`velocity / ((age_min/30)+1)^1.2` — 越新的爆发分数越高
- WebSocket 实时推送，爆发事件即时通知

**📊 仪表盘**
- 统计概览：总事件数、仓库数、今日爆发数、当前活跃数
- "Hot Right Now" 排行榜 — 按 Hot Score 排序的实时热度榜
- 每日统计图表 — 点击统计卡片查看历史趋势

**🏆 GitHub 星星排行**
- All Time / 本周 / 今日 三个时间维度
- 语言筛选 — 按编程语言过滤
- 实时 GitHub Search API 数据

**🌐 开发者生态排名**
- npm — 包下载量趋势（周/月）
- PyPI — Python 包下载统计
- GitHub — 仓库星数排行
- 跨平台信号聚合，一站式对比

**📈 仓库详情页**
- 星星增长曲线图、爆发时间线、仓库元数据展示、AI 归因摘要

**🔔 通知系统**
- Email 通知（nodemailer）、Webhook 集成、浏览器扩展（侧边栏实时监控）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite |
| 图表 | Recharts |
| 后端 | Express + TypeScript + WebSocket (ws) |
| 数据库 | SQLite (better-sqlite3) |
| 通知 | Nodemailer + Webhook |
| 扩展 | Chrome Extension (Manifest V3) |

## 项目结构

```
star-burst/
├── client/                  # React 前端
│   └── src/
│       ├── App.tsx          # 仪表盘主页
│       ├── Navbar.tsx       # 共享导航组件
│       ├── History.tsx      # GitHub 星星排行
│       ├── Ecosystem.tsx    # 开发者生态排名
│       └── RepoDetail.tsx   # 仓库详情页
├── server/                  # Express 后端
│   ├── src/
│   │   ├── index.ts         # 服务入口 + API 路由
│   │   ├── database.ts      # SQLite 数据库操作
│   │   ├── detector.ts      # 爆发检测算法
│   │   ├── poller.ts        # GitHub Events 轮询
│   │   ├── crossplatform.ts # npm/PyPI 跨平台数据
│   │   ├── attribution.ts   # 爆发归因
│   │   └── aiattribution.ts # AI 摘要生成
│   └── data/
│       └── languages.json   # 编程语言排行缓存
└── extension/               # 浏览器扩展
```

## 快速开始

**环境要求：** Node.js >= 18, npm >= 9

```bash
git clone https://github.com/z0827sj/starburst.git
cd starburst
npm run setup            # 一键安装所有依赖
cp .env.example .env     # 复制环境变量模板并编辑
npm run dev              # 启动开发环境
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

生产构建：`npm run build && npm start`

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 后端端口 | `3001` |
| `POLL_INTERVAL` | GitHub 轮询间隔（秒） | `12` |
| `SIMULATE` | 模拟模式（无 Token 时用） | `true` |
| `GITHUB_TOKEN` | GitHub Personal Access Token（可选） | — |
| `SMTP_HOST` | 邮件通知 SMTP（可选） | — |
| `WEBHOOK_URL` | Webhook 地址（可选） | — |

## API 端点

| 端点 | 说明 |
|---|---|
| `GET /api/stats` | 仪表盘统计数据 |
| `GET /api/bursts?limit=50` | 最近爆发事件 |
| `GET /api/bursts/leaderboard?limit=20` | 仓库爆发排行 |
| `GET /api/bursts/hourly?hours=24` | 按小时聚合 |
| `GET /api/github/ranking?limit=30&lang=&period=` | GitHub 星星排行 |
| `GET /api/github/repo/:owner/:name` | 仓库元数据 |
| `GET /api/repo/:owner/:name/bursts` | 仓库爆发历史 |
| `GET /api/repo/:owner/:name/growth` | 仓库增长数据 |
| `GET /api/ecosystem/:platform?limit=&sort=` | 生态排名 |
| `WS /ws` | WebSocket 实时推送 |

## 页面路由

| Hash 路由 | 页面 |
|---|---|
| `#/` | 仪表盘 |
| `#/history` | GitHub 星星排行 |
| `#/ecosystem` | 开发者生态排名 |
| `#/repo/:owner/:name` | 仓库详情 |

## 浏览器扩展

在 `chrome://extensions/` 开启开发者模式，加载 `extension/` 目录即可使用侧边栏实时监控。

## License

MIT
