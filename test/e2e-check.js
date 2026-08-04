/* 端到端验证（无头 Chrome + CDP）
 * 启动本地静态服务后运行：node test/e2e-check.js
 * 需要环境变量 CHROME 指向 chrome.exe（有默认值）
 */
const { spawn } = require('child_process');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.GAME_URL || 'http://127.0.0.1:8123/index.html';
// 若设置 CONNECT_PORT，则连接已在运行的无头 Chrome（如通过 bash 后台启动），否则自起一个
const CONNECT_PORT = process.env.CONNECT_PORT;
const PORT = CONNECT_PORT || 9333;

const chrome = CONNECT_PORT ? null : spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${__dirname}/.chrome-profile`,
  '--no-first-run', '--no-default-browser-check',
  URL
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let list = [];
  for (let i = 0; i < 60; i++) {
    try {
      list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      if (list.some((t) => t.type === 'page')) break;
    } catch (e) {}
    await sleep(250);
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到页面标签页');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  // 强制无缓存刷新，确保加载最新代码
  await send('Page.reload', { ignoreCache: true }).catch(() => {});
  await sleep(1200);

  let ready = false;
  for (let i = 0; i < 50; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof __chess !== "undefined"', returnByValue: true });
    if (r.result && r.result.value === true) { ready = true; break; }
    await sleep(300);
  }
  if (!ready) {
    console.log('FAIL: __chess 接口未就绪（页面可能报错）');
    printErrors(errors);
    cleanup();
    process.exit(1);
  }

  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result.value;
  }

  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

  console.log('== 初始化 ==');
  ok(await ev('typeof THREE !== "undefined"'), 'THREE 已加载');
  ok(await ev('__chess.pieceCount()') === 32, '棋子总数 = 32');
  ok(await ev('__chess.turn') === 'red', '初始红方走棋');
  ok(await ev('__chess.moveNum') === 1, '第 1 回合');

  console.log('\n== 选中与高亮 ==');
  ok(await ev('__chess.select(1,9)') === true, '选中红马(1,9)');
  let hl = await ev('__chess.highlights');
  ok(Array.isArray(hl) && hl.length > 0, '显示可行高亮 ' + hl.length + ' 格');
  ok(hl.some((t) => t.col === 0 && t.row === 7) && hl.some((t) => t.col === 2 && t.row === 7), '高亮含马步 (0,7)(2,7)');
  ok(await ev('__chess.state') === 'selected', '状态 = selected');

  console.log('\n== 行棋 + 切换回合 ==');
  ok(await ev('__chess.moveSelected(0,7)') === true, '红马走到(0,7)');
  ok(await ev('__chess.state') === 'idle', '动画后恢复 idle');
  ok(await ev('__chess.turn') === 'black', '轮到黑方');
  ok(await ev('__chess.pieceCount()') === 32, '未吃子 → 仍 32 枚');

  console.log('\n== 黑方行棋 ==');
  ok(await ev('__chess.move(0,3,0,4)') === true, '黑卒(0,3)前进到(0,4)');
  ok(await ev('__chess.turn') === 'red', '回到红方');
  ok(await ev('__chess.moveNum') === 2, '第 2 回合');

  console.log('\n== 吃子（红兵过河吃黑卒）==');
  // 当前：红马(0,7)、黑卒(0,4)、红方走。红兵(0,6)先推进到(0,5)
  ok(await ev('__chess.move(0,6,0,5)') === true, '红兵(0,6)推进到(0,5)');
  ok(await ev('__chess.turn') === 'black', '黑方应手');
  ok(await ev('__chess.move(7,2,7,3)') === true, '黑炮(7,2)走(7,3)（闲棋）');
  // 红兵过河吃黑卒
  ok(await ev('__chess.select(0,5)') === true, '选中红兵(0,5)');
  hl = await ev('__chess.highlights');
  ok(hl.some((t) => t.col === 0 && t.row === 4 && t.capture === true), '高亮含吃黑卒格 (0,4,吃子)');
  ok(await ev('__chess.moveSelected(0,4)') === true, '红兵(0,5)吃黑卒(0,4)');
  ok(await ev('__chess.pieceCount()') === 31, '黑卒被吃 → 31 枚');
  ok(await ev('__chess.turn') === 'black', '吃子后轮到黑方');

  console.log('\n== 非法操作防护 ==');
  ok(await ev('__chess.move(4,9,4,8)') === false, '黑方回合点红帅 → 拒绝');
  ok(await ev('__chess.pieceCount()') === 31, '非法操作不改变局面');

  console.log('\n== 重开 ==');
  await ev('__chess.reset()');
  ok(await ev('__chess.pieceCount()') === 32, '重开后 32 枚');
  ok(await ev('__chess.turn') === 'red', '重开后红方先手');

  console.log('\n== 真实鼠标点击（raycast + pointerdown 全链路）==');
  async function clickScreen(col, row) {
    const pt = await ev(`__chess.screenPos(${col},${row})`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(180);
  }
  await ev('__chess.reset()');
  // 点红马 (1,9)
  await clickScreen(1, 9);
  ok(await ev('__chess.state') === 'selected', '点击红马后进入 selected');
  const hl2 = await ev('__chess.highlights');
  ok(hl2.some((t) => t.col === 0 && t.row === 7) && hl2.some((t) => t.col === 2 && t.row === 7), '点击后出现马步高亮');
  // 点目标 (2,7) 行棋
  await clickScreen(2, 7);
  await sleep(200);
  ok(await ev('__chess.state') === 'idle', '点击高亮后恢复 idle');
  ok(await ev('__chess.turn') === 'black', '真实点击走棋后轮到黑方');
  const moved = await ev('__chess.pieces().some(p=>p.type==="H"&&p.side==="red"&&p.col===2&&p.row===7)');
  ok(moved === true, '红马真实点击后位于 (2,7)');
  // 点对手棋子（黑方回合点红炮）→ 不应选中，且提示
  await clickScreen(1, 7);
  ok(await ev('__chess.state') === 'idle', '黑方回合点红炮不会选中');

  console.log('\n================');
  console.log('通过 ' + pass + '，失败 ' + fail);
  if (errors.length) {
    console.log('\n页面 JS 报错：');
    errors.forEach((e) => console.log('  - ' + e));
    fail++;
  }
  cleanup();
  process.exit(fail ? 1 : 0);
}

function printErrors(errors) {
  if (errors.length) { console.log('页面 JS 报错：'); errors.forEach((e) => console.log('  - ' + e)); }
}
function cleanup() { try { if (chrome) chrome.kill(); } catch (e) {} }

main().catch((e) => { console.error('脚本错误:', e); cleanup(); process.exit(1); });
