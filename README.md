# 🌟 StarBurst — GitHub Star Burst Monitor

Real-time GitHub star burst detection across all public repositories. Uses multi-window velocity analysis to identify explosive star growth, with cross-platform signal aggregation (npm / PyPI) and developer ecosystem rankings.

> [中文文档](README.zh-CN.md)

## Features

**🔥 Real-Time Burst Detection**
- Multi-window (3/5/10/15/30 min) velocity analysis with automatic optimal window selection
- Hot Score decay formula: `velocity / ((age_min/30)+1)^1.2` — fresher bursts score higher
- WebSocket push for instant burst notifications

**📊 Dashboard**
- Stats overview: total events, repos, bursts today, active now
- "Hot Right Now" leaderboard sorted by Hot Score
- Daily statistics with clickable stat cards for historical trends

**🏆 GitHub Star Ranking**
- Three time windows: All Time / This Week / Today
- Language filtering by programming language
- Live data from GitHub Search API

**🌐 Dev Ecosystem Rankings**
- npm — weekly/monthly download trends
- PyPI — Python package download statistics
- GitHub — repository star rankings
- Cross-platform signal aggregation in one place

**📈 Repo Detail Page**
- Star growth chart, burst timeline, repo metadata, AI attribution summary

**🔔 Notification System**
- Email alerts (nodemailer), Webhook integration, browser extension (sidebar monitoring)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Charts | Recharts |
| Backend | Express + TypeScript + WebSocket (ws) |
| Database | SQLite (better-sqlite3) |
| Notifications | Nodemailer + Webhook |
| Extension | Chrome Extension (Manifest V3) |

## Project Structure

```
star-burst/
├── client/                  # React frontend
│   └── src/
│       ├── App.tsx          # Dashboard
│       ├── Navbar.tsx       # Shared nav component
│       ├── History.tsx      # GitHub star ranking
│       ├── Ecosystem.tsx    # Ecosystem rankings
│       └── RepoDetail.tsx   # Repo detail page
├── server/                  # Express backend
│   ├── src/
│   │   ├── index.ts         # Server entry + API routes
│   │   ├── database.ts      # SQLite operations
│   │   ├── detector.ts      # Burst detection algorithm
│   │   ├── poller.ts        # GitHub Events polling
│   │   ├── crossplatform.ts # npm/PyPI cross-platform
│   │   ├── attribution.ts   # Burst attribution
│   │   └── aiattribution.ts # AI summary generation
│   └── data/
│       └── languages.json   # Language ranking cache
└── extension/               # Browser extension
```

## Quick Start

**Prerequisites:** Node.js >= 18, npm >= 9

```bash
git clone https://github.com/z0827sj/starburst.git
cd starburst
npm run setup            # Install all dependencies
cp .env.example .env     # Copy and edit environment config
npm run dev              # Start development servers
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

Production: `npm run build && npm start`

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Backend port | `3001` |
| `POLL_INTERVAL` | GitHub poll interval (seconds) | `12` |
| `SIMULATE` | Simulation mode (use without token) | `true` |
| `GITHUB_TOKEN` | GitHub Personal Access Token (optional) | — |
| `SMTP_HOST` | Email notification SMTP (optional) | — |
| `WEBHOOK_URL` | Webhook URL (optional) | — |

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/stats` | Dashboard statistics |
| `GET /api/bursts?limit=50` | Recent burst events |
| `GET /api/bursts/leaderboard?limit=20` | Repo burst leaderboard |
| `GET /api/bursts/hourly?hours=24` | Hourly aggregation |
| `GET /api/github/ranking?limit=30&lang=&period=` | GitHub star ranking |
| `GET /api/github/repo/:owner/:name` | Repo metadata |
| `GET /api/repo/:owner/:name/bursts` | Repo burst history |
| `GET /api/repo/:owner/:name/growth` | Repo growth data |
| `GET /api/ecosystem/:platform?limit=&sort=` | Ecosystem rankings |
| `WS /ws` | Real-time WebSocket push |

## Page Routes

| Hash Route | Page |
|---|---|
| `#/` | Dashboard |
| `#/history` | GitHub Star Ranking |
| `#/ecosystem` | Dev Ecosystem Rankings |
| `#/repo/:owner/:name` | Repo Detail |

## Browser Extension

Load the `extension/` directory via `chrome://extensions/` (Developer mode on) for real-time sidebar monitoring.

## License

MIT
