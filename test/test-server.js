/* 服务器协议集成测试（不启动浏览器，用 Node 全局 WebSocket）
 * 运行：node test/test-server.js
 * 覆盖：创建房间/加入/观战/服务端校验链/合法转发（无双播）/move_ack/
 *       掉线座位接替/观战人数/rematch 守卫/房间清理
 * 说明：完整 rematch（双方确认→rematch_started）需对局终局，靠手动 E2E 验证；
 *       此处验证其非法时机守卫（GAME_NOT_OVER）。
 */
'use strict';

const { startServer } = require('../server.js');
const X = require('../js/rules.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}
async function test(name, fn) {
  console.log('\n== ' + name + ' ==');
  try { await fn(); } catch (e) { fail++; console.log('  ✗ 异常: ' + e.stack); }
}

/* ---------------- 轻量 WS 客户端 ---------------- */
class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this._q = [];
    this._waiters = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { msg = { type: '_parse_error', data: String(ev.data) }; }
      this._push(msg);
    };
    this.ws.onclose = () => this._push({ type: '_close' });
  }
  _push(msg) {
    const i = this._waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) {
      const w = this._waiters.splice(i, 1)[0];
      clearTimeout(w.t);
      w.res(msg);
    } else {
      this._q.push(msg);
    }
  }
  async open() { await this.ready; return this; }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { try { this.ws.close(); } catch (e) {} }
  waitFor(pred, timeout = 4000) {
    const i = this._q.findIndex(pred);
    if (i >= 0) return Promise.resolve(this._q.splice(i, 1)[0]);
    return new Promise((res, rej) => {
      const w = { pred, res };
      w.t = setTimeout(() => {
        const j = this._waiters.indexOf(w);
        if (j >= 0) this._waiters.splice(j, 1);
        rej(new Error('等待消息超时'));
      }, timeout);
      this._waiters.push(w);
    });
  }
  has(pred) { return this._q.some(pred); }
}

/* 局面镜像：只记录已确认（服务器 accept）的着法，用于算对手合法应手 */
function makeMirror() { return X.newGame(); }

async function main() {
  const { httpServer } = await startServer(0, { graceMs: 150 }); // 短宽限期便于测试
  const port = httpServer.address().port;
  const url = 'ws://127.0.0.1:' + port + '/ws';
  console.log('服务器已启动 :' + port);

  await test('创建房间（红方）', async () => {
    const a = await new Client(url).open();
    a.send({ type: 'create' });
    const msg = await a.waitFor((m) => m.type === 'created');
    ok(msg.side === 'red', '房主 = 红方');
    ok(/^[A-Z2-9]{5}$/.test(msg.code), '房间码为 5 位字母数字 → ' + msg.code);
    ok(msg.phase === 'waiting', 'phase = waiting（等待对手）');
    ok(msg.state && msg.state.board.length === 10 && msg.state.board[0].length === 9, '返回完整局面');
    ok(msg.state.turn === 'red', '红方先手');
    a.roomCode = msg.code;
    a.close();
  });

  let code = null;
  await test('第二人加入（黑方）→ 开战', async () => {
    const red = await new Client(url).open();
    const black = await new Client(url).open();
    red.send({ type: 'create' });
    const created = await red.waitFor((m) => m.type === 'created');
    code = created.code;

    black.send({ type: 'join', code });
    const joined = await black.waitFor((m) => m.type === 'joined');
    ok(joined.side === 'black', '加入者为黑方');
    ok(joined.phase === 'playing', 'phase = playing');
    ok(joined.redSeated && joined.blackSeated, '红黑均已就座');
    ok(await red.waitFor((m) => m.type === 'opponent_joined').then((m) => m.side === 'black'), '红方收到 opponent_joined(black)');
    ok(await red.waitFor((m) => m.type === 'game_start').then((m) => m.phase === 'playing'), '红方收到 game_start');

    red.black = black;
    black.red = red;
    red._ctx = { black, mirror: makeMirror() };
    black._ctx = { red, mirror: makeMirror() };
    global.__red = red; global.__black = black;
  });

  await test('等待阶段走子被拒（GAME_NOT_ACTIVE）', async () => {
    const r = await new Client(url).open();
    r.send({ type: 'create' });
    await r.waitFor((m) => m.type === 'created');
    r.send({ type: 'move', from: { col: 0, row: 6 }, to: { col: 0, row: 5 } });
    const err = await r.waitFor((m) => m.type === 'error');
    ok(err.code === 'GAME_NOT_ACTIVE', '无人对手时走子 → GAME_NOT_ACTIVE');
    r.close();
  });

  await test('回合与合法性校验', async () => {
    const red = global.__red, black = global.__black;
    // 黑方在自己回合前走子 → 拒绝
    black.send({ type: 'move', from: { col: 0, row: 3 }, to: { col: 0, row: 4 } });
    let err = await black.waitFor((m) => m.type === 'error');
    ok(err.code === 'NOT_YOUR_TURN', '黑方抢走 → NOT_YOUR_TURN');
    // 非法走法（马蹩腿处移动）
    red.send({ type: 'move', from: { col: 1, row: 9 }, to: { col: 3, row: 8 } });
    err = await red.waitFor((m) => m.type === 'error');
    ok(err.code === 'ILLEGAL_MOVE', '蹩马腿 → ILLEGAL_MOVE');
    // 越界
    red.send({ type: 'move', from: { col: 0, row: 6 }, to: { col: -1, row: 5 } });
    err = await red.waitFor((m) => m.type === 'error');
    ok(err.code === 'ILLEGAL_MOVE', '越界 → ILLEGAL_MOVE');
    // 无棋子格
    red.send({ type: 'move', from: { col: 4, row: 5 }, to: { col: 4, row: 6 } });
    err = await red.waitFor((m) => m.type === 'error');
    ok(err.code === 'NO_PIECE', '空格走子 → NO_PIECE');
  });

  await test('合法着法：转发给对手与观战者，无双播', async () => {
    const red = global.__red, black = global.__black;
    const spec = await new Client(url).open();
    spec.send({ type: 'join', code });
    const sj = await spec.waitFor((m) => m.type === 'joined');
    ok(sj.side === 'spec', '第三人加入 → 观战');
    ok(sj.phase === 'playing', '观战 phase = playing');
    ok(await red.waitFor((m) => m.type === 'spec_count').then((m) => m.n === 1), '玩家收到 spec_count=1');

    // 红兵(0,6)→(0,5)
    red.send({ type: 'move', from: { col: 0, row: 6 }, to: { col: 0, row: 5 } });
    const ack = await red.waitFor((m) => m.type === 'move_ack');
    ok(ack.turn === 'black', 'move_ack：轮到黑方');
    ok(ack.moveNum === 1, 'move_ack：第 1 回合');
    ok(ack.gameOver === false, 'move_ack：未终局');
    ok(!red.has((m) => m.type === 'move'), '走子者未收到 move（无双播）');
    const bmv = await black.waitFor((m) => m.type === 'move');
    ok(bmv.from.col === 0 && bmv.from.row === 6 && bmv.to.col === 0 && bmv.to.row === 5, '黑方收到该着法');
    ok(bmv.side === 'red' && bmv.turn === 'black', 'move 携带 side 与 turn');
    ok(await spec.waitFor((m) => m.type === 'move').then((m) => m.to.col === 0), '观战者收到该着法');

    // 黑方合法应手（镜像算第一个合法着法）
    X.applyMove(black._ctx.mirror, 0, 6, 0, 5);
    const legal = X.allLegalMoves(black._ctx.mirror);
    const fm = legal[0].from, mv = legal[0].moves[0];
    black.send({ type: 'move', from: fm, to: mv });
    const bak = await black.waitFor((m) => m.type === 'move_ack');
    ok(bak.turn === 'red', '黑方 move_ack：回到红方');
    ok(await red.waitFor((m) => m.type === 'move').then((m) => m.side === 'black'), '红方收到黑方着法');
    ok(await spec.waitFor((m) => m.type === 'move'), '观战者收到黑方着法');

    spec.close();
  });

  await test('观战者不能走棋', async () => {
    const red = global.__red, black = global.__black;
    const spec = await new Client(url).open();
    spec.send({ type: 'join', code });
    await spec.waitFor((m) => m.type === 'joined');
    spec.send({ type: 'move', from: { col: 0, row: 6 }, to: { col: 0, row: 5 } });
    const err = await spec.waitFor((m) => m.type === 'error');
    ok(err.code === 'SPECTATOR_CANNOT_MOVE', '观战者走子 → SPECTATOR_CANNOT_MOVE');
    spec.close();
  });

  await test('加入不存在的房间', async () => {
    const c = await new Client(url).open();
    c.send({ type: 'join', code: 'ZZZZZ' });
    const err = await c.waitFor((m) => m.type === 'error');
    ok(err.code === 'ROOM_NOT_FOUND', '无效房间码 → ROOM_NOT_FOUND');
    c.close();
  });

  await test('rematch 非法时机守卫', async () => {
    const red = global.__red, black = global.__black;
    black.send({ type: 'rematch' });
    const err = await black.waitFor((m) => m.type === 'error');
    ok(err.code === 'GAME_NOT_OVER', '对局未结束发 rematch → GAME_NOT_OVER');
    red.send({ type: 'rematch' });
    const err2 = await red.waitFor((m) => m.type === 'error');
    ok(err2.code === 'GAME_NOT_OVER', '红方同理');
  });

  await test('红方掉线 → 黑方收到 opponent_left，新玩家接替', async () => {
    const red = global.__red, black = global.__black;
    red.close();
    const ol = await black.waitFor((m) => m.type === 'opponent_left');
    ok(ol.side === 'red', '黑方收到 opponent_left(red)');
    ok(ol.phase === 'waiting', 'phase = waiting');

    const newcomer = await new Client(url).open();
    newcomer.send({ type: 'join', code });
    const nj = await newcomer.waitFor((m) => m.type === 'joined');
    ok(nj.side === 'red', '新玩家接替红方');
    ok(nj.state.turn === 'red', '接替者拿到完整局面（轮到红方）');
    ok(await black.waitFor((m) => m.type === 'opponent_joined').then((m) => m.side === 'red'), '黑方收到 opponent_joined(red)');
    ok(await black.waitFor((m) => m.type === 'game_start').then((m) => m.phase === 'playing'), '黑方收到 game_start（新红方就座）');

    global.__red = newcomer; // 后续测试可继续
    black.close();
    newcomer.close();
  });

  await test('宽限期：房主离开后凭码仍可加入', async () => {
    const a = await new Client(url).open();
    a.send({ type: 'create' });
    const created = await a.waitFor((m) => m.type === 'created');
    a.close(); // 房主离开 → 房间进入宽限期
    await new Promise((r) => setTimeout(r, 50));
    const b = await new Client(url).open();
    b.send({ type: 'join', code: created.code });
    const joined = await b.waitFor((m) => m.type === 'joined');
    ok(joined.side === 'red', '宽限期内新玩家凭码加入成为红方');
    ok(joined.phase === 'waiting', '等待对手加入（phase=waiting）');
    b.close();
  });

  await test('双方都离开 → 宽限期后房间清理', async () => {
    const a = await new Client(url).open();
    a.send({ type: 'create' });
    const created = await a.waitFor((m) => m.type === 'created');
    a.close();
    await new Promise((r) => setTimeout(r, 500)); // 超过 150ms 宽限期
    const b = await new Client(url).open();
    b.send({ type: 'join', code: created.code });
    const err = await b.waitFor((m) => m.type === 'error');
    ok(err.code === 'ROOM_NOT_FOUND', '宽限期结束后房间已清理');
    b.close();
  });

  await test('垃圾消息', async () => {
    const c = await new Client(url).open();
    c.ws.send('{{{');
    const err = await c.waitFor((m) => m.type === 'error');
    ok(err.code === 'BAD_MESSAGE', '非 JSON → BAD_MESSAGE');
    c.ws.send(JSON.stringify({ type: 'whatever' }));
    const err2 = await c.waitFor((m) => m.type === 'error');
    ok(err2.code === 'BAD_MESSAGE', '未知类型 → BAD_MESSAGE');
    c.close();
  });

  httpServer.close();
  console.log('\n================');
  console.log('通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('脚本错误:', e); process.exit(1); });
