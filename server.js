/* ============================================================
 * 3D 中国象棋 · 在线对战服务器
 * 单个 Node 服务：托管静态文件 + WebSocket（/ws）房间系统
 * 服务端权威：用 js/rules.js 校验每一步，广播增量给对手与观战者
 * 运行：node server.js   （Railway 用 process.env.PORT，默认 3000）
 * 导出 startServer 供 test/test-server.js 集成测试使用
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Xiangqi = require('./js/rules.js');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

/* ---------------- 静态文件服务 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.includes('..')) { res.writeHead(403).end('Forbidden'); return; }
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || st.isDirectory()) { res.writeHead(404).end('Not Found'); return; }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- 房间系统 ---------------- */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混 I/O/0/1

const rooms = new Map(); // code -> room

function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* 连接已断 */ }
  }
}

function broadcastTo(conns, msg) {
  const s = JSON.stringify(msg);
  conns.forEach((c) => { if (c && c.readyState === c.OPEN) { try { c.send(s); } catch (e) {} } });
}

/* 房间内除 exclude 外的所有连接（对手 + 观战者） */
function broadcastToRoom(room, msg, exclude) {
  const list = [];
  if (room.red && room.red !== exclude) list.push(room.red);
  if (room.black && room.black !== exclude) list.push(room.black);
  room.specs.forEach((s) => { if (s !== exclude) list.push(s); });
  broadcastTo(list, msg);
}

/* 仅两名玩家（观战人数变化通知用） */
function broadcastPlayers(room, msg) {
  const list = [];
  if (room.red) list.push(room.red);
  if (room.black) list.push(room.black);
  broadcastTo(list, msg);
}

function sendError(ws, code, message) {
  send(ws, { type: 'error', code, message });
}

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(ws) {
  const code = genCode();
  const room = {
    code,
    state: Xiangqi.newGame(),
    red: ws, black: null,
    specs: new Set(),
    phase: 'waiting',       // waiting | playing | over
    rematch: { red: false, black: false }
  };
  rooms.set(code, room);
  ws.room = code;
  ws.role = 'red';
  send(ws, {
    type: 'created', code, side: 'red',
    state: snapshot(room.state), phase: room.phase,
    redSeated: true, blackSeated: false, specCount: 0
  });
}

function joinRoom(ws, code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const room = rooms.get(code);
  if (!room) return sendError(ws, 'ROOM_NOT_FOUND', '房间不存在，请检查房间码');

  if (ws.room && ws.role) leaveRoom(ws);

  /* 满员（红黑都在）→ 观战 */
  if (room.red && room.black) {
    room.specs.add(ws);
    ws.room = code;
    ws.role = 'spec';
    send(ws, {
      type: 'joined', code, side: 'spec',
      state: snapshot(room.state), phase: room.phase,
      redSeated: true, blackSeated: true, specCount: room.specs.size
    });
    broadcastPlayers(room, { type: 'spec_count', n: room.specs.size });
    return;
  }

  const wasPlaying = room.phase === 'playing';
  const side = room.red ? 'black' : 'red';
  if (side === 'red') room.red = ws; else room.black = ws;
  ws.room = code;
  ws.role = side;

  room.rematch = { red: false, black: false };

  /* 房间已终局、新玩家接替座位 → 直接开新局，避免落入死局 */
  const resetOver = room.state.gameOver;
  if (resetOver) {
    room.state = Xiangqi.newGame();
    room.phase = 'playing';
  } else if (room.red && room.black) {
    room.phase = 'playing';
  }

  send(ws, {
    type: 'joined', code, side,
    state: snapshot(room.state), phase: room.phase,
    redSeated: !!room.red, blackSeated: !!room.black, specCount: room.specs.size
  });

  /* 通知已在房内的对手 */
  const other = side === 'red' ? room.black : room.red;
  if (other) {
    send(other, { type: 'opponent_joined', side, phase: room.phase });
    if (!wasPlaying && room.phase === 'playing') {
      send(other, { type: 'game_start', state: snapshot(room.state), phase: 'playing' });
    }
  }
}

function handleMove(ws, msg) {
  const room = rooms.get(ws.room);
  if (!room) return sendError(ws, 'NOT_IN_ROOM', '你不在任何房间');
  if (room.phase !== 'playing') return sendError(ws, 'GAME_NOT_ACTIVE', '对局未开始或已结束');
  if (ws.role === 'spec') return sendError(ws, 'SPECTATOR_CANNOT_MOVE', '观战者不能走棋');
  if (room.state.gameOver) return sendError(ws, 'GAME_OVER', '对局已结束');
  if (room.state.turn !== ws.role) return sendError(ws, 'NOT_YOUR_TURN', '还没轮到你走棋');

  const from = msg.from, to = msg.to;
  if (!from || !to) return sendError(ws, 'BAD_MOVE', '无效着法');
  const fc = +from.col, fr = +from.row, tc = +to.col, tr = +to.row;
  if (![fc, fr, tc, tr].every((n) => Number.isInteger(n))) return sendError(ws, 'BAD_MOVE', '无效着法');
  if (!Xiangqi.inBoard(fc, fr) || !Xiangqi.inBoard(tc, tr)) return sendError(ws, 'ILLEGAL_MOVE', '越界');
  const piece = room.state.board[fr][fc];
  if (!piece || piece.side !== ws.role) return sendError(ws, 'NO_PIECE', '该处没有你的棋子');
  const legal = Xiangqi.legalMoves(room.state, fc, fr).some((m) => m.col === tc && m.row === tr);
  if (!legal) return sendError(ws, 'ILLEGAL_MOVE', '非法走法');

  Xiangqi.applyMove(room.state, fc, fr, tc, tr);
  Xiangqi.checkEnd(room.state);
  if (room.state.gameOver) room.phase = 'over';

  const mv = {
    type: 'move',
    from: { col: fc, row: fr }, to: { col: tc, row: tr }, side: ws.role,
    turn: room.state.turn, moveNum: room.state.moveNum,
    gameOver: room.state.gameOver, winner: room.state.winner, reason: room.state.reason
  };
  broadcastToRoom(room, mv, ws); // 转发给对手 + 观战者（不含走子者）
  send(ws, {
    type: 'move_ack', turn: room.state.turn, moveNum: room.state.moveNum,
    gameOver: room.state.gameOver, winner: room.state.winner, reason: room.state.reason
  });
}

function handleRematch(ws) {
  const room = rooms.get(ws.room);
  if (!room) return sendError(ws, 'NOT_IN_ROOM', '你不在任何房间');
  if (ws.role === 'spec') return sendError(ws, 'SPECTATOR_CANNOT_REMATCH', '观战者不能发起再来一局');
  if (room.phase !== 'over') return sendError(ws, 'GAME_NOT_OVER', '对局尚未结束');

  room.rematch[ws.role] = true;
  const other = ws.role === 'red' ? room.black : room.red;
  if (room.rematch.red && room.rematch.black && other) {
    room.state = Xiangqi.newGame();
    room.phase = 'playing';
    room.rematch = { red: false, black: false };
    broadcastToRoom(room, { type: 'rematch_started', state: snapshot(room.state), phase: 'playing' });
  } else if (other) {
    send(other, { type: 'rematch_offer', by: ws.role });
  }
}

function sendSync(ws) {
  const room = rooms.get(ws.room);
  if (!room) return sendError(ws, 'NOT_IN_ROOM', '你不在任何房间');
  send(ws, { type: 'sync_state', state: snapshot(room.state), phase: room.phase });
}

function leaveRoom(ws) {
  const code = ws.room;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) { ws.room = null; ws.role = null; return; }

  const role = ws.role;
  if (role === 'red') room.red = null;
  else if (role === 'black') room.black = null;
  else if (role === 'spec') room.specs.delete(ws);

  room.rematch = { red: false, black: false };

  if ((role === 'red' || role === 'black') && (room.red || room.black)) {
    room.phase = 'waiting';
    const others = [];
    if (room.red) others.push(room.red);
    if (room.black) others.push(room.black);
    room.specs.forEach((s) => others.push(s));
    broadcastTo(others, { type: 'opponent_left', side: role, phase: room.phase });
  }

  if (!room.red && !room.black) {
    rooms.delete(code);
    room.specs.forEach((s) => send(s, { type: 'room_closed' }));
    room.specs.clear();
  } else if (room.specs.size) {
    broadcastPlayers(room, { type: 'spec_count', n: room.specs.size });
  }

  ws.room = null;
  ws.role = null;
}

/* ---------------- 服务器装配 ---------------- */

function startServer(port) {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/healthz/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.room = null;
    ws.role = null;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return sendError(ws, 'BAD_MESSAGE', '消息格式错误'); }
      switch (msg && msg.type) {
        case 'create':  leaveRoom(ws); createRoom(ws); break;
        case 'join':    joinRoom(ws, msg.code); break;
        case 'move':    handleMove(ws, msg); break;
        case 'rematch': handleRematch(ws); break;
        case 'leave':   leaveRoom(ws); break;
        case 'sync':    sendSync(ws); break;
        default:        sendError(ws, 'BAD_MESSAGE', '未知消息类型');
      }
    });

    ws.on('error', () => { /* 吞掉，避免进程崩溃 */ });
    ws.on('close', () => leaveRoom(ws));
  });

  /* 30s ping 保活，防止代理把空闲 WebSocket 回收（Railway 边缘） */
  const pingTimer = setInterval(() => {
    wss.clients.forEach((c) => {
      if (c.isAlive === false) return c.terminate();
      c.isAlive = false;
      c.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(pingTimer));

  return new Promise((resolve) => {
    httpServer.listen(port, () => resolve({ httpServer, wss, rooms, Xiangqi }));
  });
}

if (require.main === module) {
  startServer(PORT).then(({ httpServer }) => {
    console.log('🀄 3D 中国象棋在线服务已启动：http://localhost:' + httpServer.address().port);
  });
}

module.exports = { startServer, rooms };
