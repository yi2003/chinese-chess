# 🏯 3D 拟人化中国象棋 · 在线对战

唐代风格的 3D 中国象棋，支持 **多人在线对战（开房间）+ 观战**，也可本地双人同屏。

## 在线对战玩法

1. 打开游戏页面，大厅出现「创建房间」。
2. 创建后得到 **5 位房间码**（如 `F69NE`），把码发给朋友。
3. 朋友在另一台设备输入房间码即可加入对局（创建者=红方先手）。
4. 房间满 2 人后，再输入同一房间码的人自动成为**观战者**（可看动画、不能走棋）。
5. 终局后点「再来一局」，对方同意即开新局。

- 在线模式下只能操作自己的棋子，未轮到你时点击无效。
- 玩家中途掉线，座位保留，新玩家凭房间码可接替继续。
- 连接不到服务器时自动回退为「本地双人对弈」（同屏热座）。

## 本地运行

```bash
npm install
node server.js          # 默认 http://localhost:3000 （含静态服务 + WebSocket）
```

Windows 下也可直接双击 `启动游戏.bat`（优先 node 服务器，其次 python 静态服务）。

## 部署到 Railway

本项目是单个 Node 服务（`server.js` 同时托管静态文件与 `/ws` WebSocket），Railway 自动识别 `package.json` 并注入 `PORT`。

方式一（CLI，当前目录直接部署）：
```bash
railway up -y -d      # 创建项目 + 部署（返回后跑 railway domain 加公网域名）
```

方式二（GitHub 关联，推送即自动部署）：把仓库推到 GitHub，在 [railway.app](https://railway.app) 新建项目 → Deploy from GitHub repo → 选择本仓库。

## 测试

```bash
node test/test-rules.js     # 规则引擎单测（44 项）
node test/test-server.js    # 服务器协议集成测试（41 项）
npm test                    # 上面两者

# 端到端（需本地 node server + headless Chrome 经 bash 启动）
# 本地模式：
PORT=8123 node server.js &
chrome --headless=new --remote-debugging-port=9333 --user-data-dir=... http://127.0.0.1:8123/ &
CONNECT_PORT=9333 node test/e2e-check.js
# 在线模式：
CONNECT_PORT=9333 GAME_URL=http://localhost:3000 node test/e2e-online.js
```

## 技术结构

| 文件 | 说明 |
|---|---|
| `server.js` | Node 静态服务 + WebSocket 房间系统，服务端权威校验（复用 `js/rules.js`） |
| `js/net.js` | 客户端网络层 + 大厅遮罩，连接失败回退本地模式 |
| `js/main.js` | 3D 场景、回合状态机、`performMove`/`loadState`/`mySide` 门槛/远程着法队列 |
| `js/rules.js` | 中国象棋规则引擎（纯逻辑，浏览器与 Node 双端复用） |
| `js/board.js` `js/figures.js` `js/animations.js` `js/audio.js` | 3D 棋盘 / 拟人棋子 / 动画特效 / 音效 |
