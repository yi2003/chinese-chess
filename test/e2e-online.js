/* 在线对战端到端验证（双标签 + 观战，CDP）
 * 前置：node server 运行；headless Chrome 经 bash 后台启动指向该服务（勿用 node spawn）
 * 用法：
 *   PORT=3000 node server.js &
 *   chrome --headless=new --remote-debugging-port=9333 --user-data-dir=... http://localhost:3000 &
 *   CONNECT_PORT=9333 GAME_URL=http://localhost:3000 node test/e2e-online.js
 * 覆盖：A 建房得码 → B 输入码加入 → 回合控制 → A 行棋 → B 镜像同步 →
 *       观战者收到着法 → B 应手 → 双方与观战者同步
 * 注意：headless 下后台标签页 requestAnimationFrame 被节流，动画会卡住；
 *       每次等待对方动画前先 Page.bringToFront 该标签。
 */
'use strict';

const CHROME_PORT = process.env.CONNECT_PORT || 9333;
const GAME_URL = process.env.GAME_URL || 'http://localhost:3000/index.html';
const BASE = 'http://127.0.0.1:' + CHROME_PORT;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = async (method, params = {}) => {
    await opened;
    return new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 15000 });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr, timeout = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { const v = await ev(expr); if (v) return v; } catch (e) {}
      await sleep(200);
    }
    throw new Error('等待超时: ' + expr);
  };
  /* 前台化标签页，避免 headless 下 rAF 被节流导致动画 Promise 永不 resolve */
  const focus = async () => { await send('Page.enable'); await send('Page.bringToFront'); };
  return { ev, waitFor, send, ws, ready: opened, focus };
}

async function main() {
  const list = await fetch(BASE + '/json/list').then((r) => r.json());
  const first = list.find((t) => t.type === 'page');
  if (!first) throw new Error('找不到首个页面标签');

  const A = connectCDP(first.webSocketDebuggerUrl);
  await A.ready;
  await A.send('Runtime.enable');

  const target = await fetch(BASE + '/json/new?' + encodeURIComponent(GAME_URL), { method: 'PUT' }).then((r) => r.json());
  const B = connectCDP(target.webSocketDebuggerUrl);
  await B.ready;
  await B.send('Runtime.enable');

  await A.waitFor('typeof Net !== "undefined" && Net.isOnline()');
  await B.waitFor('typeof Net !== "undefined" && Net.isOnline()');
  console.log('== 双标签已连接服务器 ==');

  console.log('\n== 建房 / 加入 ==');
  await A.focus();
  await A.ev('Net.createRoom()');
  const code = await A.waitFor('Net.roomCode');
  ok(/^[A-Z2-9]{5}$/.test(code), 'A 创建房间得码 → ' + code);
  ok(await A.ev('Net.side') === 'red', 'A 为红方');

  await B.focus();
  await B.ev('Net.joinRoom("' + code + '")');
  await B.waitFor('Net.side === "black"');
  ok(true, 'B 加入房间成为黑方');
  ok(await B.ev('typeof __chess !== "undefined" && __chess.pieceCount()') === 32, 'B 拿到完整局面（32 子）');
  await A.waitFor('__chess.turn === "red"');
  ok(true, 'A 收到 game_start，红方先手');

  console.log('\n== 回合控制：未轮到的走子被拒 ==');
  await B.focus();
  ok(await B.ev('__chess.move(0,3,0,4)') === false, '红方回合，B(黑)走子被拒');

  console.log('\n== A 行棋 → B 镜像同步 ==');
  await A.focus();
  ok(await A.ev('__chess.move(0,6,0,5)') === true, 'A 走兵(0,6)→(0,5) 成功');
  await B.focus();
  await B.waitFor('__chess.turn === "black"');
  ok(true, 'B 镜像推进到黑方回合');
  ok(await B.ev('__chess.pieces().some(p => p.type === "S" && p.side === "red" && p.col === 0 && p.row === 5)') === true, 'B 棋盘上红兵已到 (0,5)');
  ok(await A.ev('__chess.turn') === 'black', 'A 本地回合也推进到黑方（无双播）');
  ok(await A.ev('__chess.pieceCount()') === 32, 'A 未吃子仍 32 子');
  await A.focus();
  ok(await A.ev('__chess.move(1,9,0,7)') === false, '黑方回合，A(红)走马被拒');

  console.log('\n== 观战者 ==');
  const targetC = await fetch(BASE + '/json/new?' + encodeURIComponent(GAME_URL), { method: 'PUT' }).then((r) => r.json());
  const C = connectCDP(targetC.webSocketDebuggerUrl);
  await C.ready;
  await C.send('Runtime.enable');
  await C.waitFor('typeof Net !== "undefined" && Net.isOnline()');
  await C.ev('Net.joinRoom("' + code + '")');
  await C.waitFor('Net.side === "spec"');
  ok(true, 'C 以观战者身份加入');
  ok(await C.ev('typeof __chess !== "undefined" && __chess.pieceCount()') === 32, '观战者拿到当前局面');
  ok(await C.ev('__chess.turn') === 'black', '观战者镜像已同步（黑方回合）');

  console.log('\n== B 应手 → 双方与观战者同步 ==');
  await B.focus();
  ok(await B.ev('__chess.move(0,3,0,4)') === true, 'B 走卒(0,3)→(0,4) 成功');
  await A.focus();
  await A.waitFor('__chess.turn === "red" && __chess.pieceCount() === 32');
  ok(true, 'A 收到 B 应手，回到红方');
  await C.focus();
  await C.waitFor('__chess.turn === "red"');
  ok(true, '观战者收到 B 应手');
  ok(await C.ev('__chess.pieces().some(p => p.type === "S" && p.side === "black" && p.col === 0 && p.row === 4)') === true, '观战者棋盘黑卒已到 (0,4)');

  console.log('\n================');
  console.log('通过 ' + pass + '，失败 ' + fail);
  [A, B, C].forEach((c) => c.ws.close());
  process.exit(fail ? 1 : 0);
}

Promise.race([
  main(),
  new Promise((_, rej) => setTimeout(() => rej(new Error('整体超时（60s）')), 60000))
]).catch((e) => { console.error('脚本错误:', e); process.exit(1); });
