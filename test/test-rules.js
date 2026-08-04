/* 规则引擎自测脚本：node test/test-rules.js
 * 坐标约定：col 0..8，row 0..9；board[row][col] */
const X = require('../js/rules.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ FAIL: ' + msg); }
}
function clear(state) { for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) state.board[r][c] = null; }
function place(state, c, r, type, side) { state.board[r][c] = { type, side }; }
function moves(state, c, r) {
  return X.legalMoves(state, c, r).map(m => m.col + ',' + m.row).sort().join(' ');
}

console.log('== 初始局面 ==');
let g = X.newGame();
ok(count(g) === 32, '共 32 枚棋子');
ok(g.turn === 'red', '红方先手');
ok(!X.inCheck(g, 'red') && !X.inCheck(g, 'black'), '初始不将军');
function count(s) { let n = 0; for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (s.board[r][c]) n++; return n; }

console.log('\n== 兵/卒 ==');
ok(moves(g, 0, 6) === '0,5', '红兵(0,6)未过河只能前进 → ' + moves(g, 0, 6));
ok(moves(g, 0, 3) === '0,4', '黑卒(0,3)未过河只能前进 → ' + moves(g, 0, 3));
// 红兵过河后可横走：清空棋盘，红兵在 (0,4)（边线不能向左出界）
let sg = X.newGame(); clear(sg); place(sg, 0, 4, 'S', 'red');
ok(moves(sg, 0, 4) === '0,3 1,4', '红兵(0,4)过河可前进+横走(边线无左) → ' + moves(sg, 0, 4));
// 黑卒过河后可横走（居中位置可双向）
let sg2 = X.newGame(); clear(sg2); place(sg2, 4, 5, 'S', 'black');
ok(moves(sg2, 4, 5) === '3,5 4,6 5,5', '黑卒(4,5)过河可前进+左右横走 → ' + moves(sg2, 4, 5));
// 兵不可后退
ok(moves(sg2, 4, 5).indexOf('4,4') === -1, '黑卒不可后退(4,4)');

console.log('\n== 马 / 蹩马腿 ==');
// 初始红马(1,9)：上跳(0,7)(2,7)；右跳(3,8)被相(2,9)蹩腿
ok(moves(g, 1, 9) === '0,7 2,7', '红马(1,9)初始走法 → ' + moves(g, 1, 9));
// 清空棋盘，红马(4,5) 可走 8 个日字
let mh = X.newGame(); clear(mh); place(mh, 4, 5, 'H', 'red');
ok(moves(mh, 4, 5) === '2,4 2,6 3,3 3,7 5,3 5,7 6,4 6,6', '红马(4,5)满日字 8 向 → ' + moves(mh, 4, 5));
// 在(4,4)放子蹩腿：挡住 (3,3)(5,3)
place(mh, 4, 4, 'S', 'red');
ok(moves(mh, 4, 5) === '2,4 2,6 3,7 5,7 6,4 6,6', '蹩(4,4)腿后 → ' + moves(mh, 4, 5));
// 在(3,5)放子蹩腿：挡住 (2,4)(2,6)
let mh2 = X.newGame(); clear(mh2); place(mh2, 4, 5, 'H', 'red'); place(mh2, 3, 5, 'S', 'red');
ok(moves(mh2, 4, 5) === '3,3 3,7 5,3 5,7 6,4 6,6', '蹩(3,5)腿后 → ' + moves(mh2, 4, 5));

console.log('\n== 相/象 ==');
ok(moves(g, 2, 9) === '0,7 4,7', '红相(2,9)初始走法 → ' + moves(g, 2, 9));
// 塞象眼(1,8)
let ei = X.newGame(); place(ei, 1, 8, 'S', 'red');
ok(moves(ei, 2, 9) === '4,7', '塞象眼(1,8)后 → ' + moves(ei, 2, 9));
// 不过河：黑象(2,5)只能回到(0,3)(4,3)
let el = X.newGame(); clear(el); place(el, 2, 5, 'E', 'black');
ok(moves(el, 2, 5) === '0,3 4,3', '黑象(2,5)不过河 → ' + moves(el, 2, 5));

console.log('\n== 车 ==');
let rk = X.newGame(); clear(rk); place(rk, 4, 5, 'R', 'red');
ok(moves(rk, 4, 5) === '0,5 1,5 2,5 3,5 4,0 4,1 4,2 4,3 4,4 4,6 4,7 4,8 4,9 5,5 6,5 7,5 8,5', '车(4,5)满盘滑行 → ' + moves(rk, 4, 5));
place(rk, 4, 2, 'G', 'black'); // 挡子
let rm = moves(rk, 4, 5);
ok(rm.indexOf('4,2') !== -1, '车可吃挡子(4,2)');
ok(rm.indexOf('4,1') === -1 && rm.indexOf('4,0') === -1, '车被挡不可越过(4,1)(4,0)');

console.log('\n== 炮 / 炮架 ==');
let cn = X.newGame(); clear(cn); place(cn, 4, 5, 'C', 'red');
ok(moves(cn, 4, 5) === '0,5 1,5 2,5 3,5 4,0 4,1 4,2 4,3 4,4 4,6 4,7 4,8 4,9 5,5 6,5 7,5 8,5', '炮(4,5)无子时可走空格（同车）→ ' + moves(cn, 4, 5));
place(cn, 4, 0, 'G', 'black'); // 无炮架不能隔空吃
let cm = moves(cn, 4, 5);
ok(cm.indexOf('4,0') === -1, '无炮架不能吃(4,0)');
ok(cm.indexOf('4,1') !== -1, '仍可走到(4,1)');
place(cn, 4, 2, 'S', 'black'); // 炮架
cm = moves(cn, 4, 5);
ok(cm.indexOf('4,0') !== -1, '隔炮架(4,2)后可吃(4,0)');
ok(cm.indexOf('4,1') === -1, '炮架后非目标格(4,1)不可停');
ok(cm.indexOf('4,3') !== -1, '炮架前空格(4,3)仍可走');

console.log('\n== 将帅 ==');
let gg = X.newGame(); clear(gg); place(gg, 4, 9, 'G', 'red');
ok(X.legalMoves(gg, 4, 9).every(m => m.col >= 3 && m.col <= 5 && m.row >= 7), '红帅只走九宫内');
// 双将照面
let gf = X.newGame(); clear(gf); place(gf, 4, 9, 'G', 'red'); place(gf, 4, 0, 'G', 'black');
ok(X.generalsFacing(gf), '同列无子 → 双将照面');
ok(moves(gf, 4, 9) === '3,9 5,9', '照面时红帅不能上(4,8) → ' + moves(gf, 4, 9));

console.log('\n== 将军判定 ==');
let chk = X.newGame(); clear(chk); place(chk, 4, 0, 'G', 'black'); place(chk, 4, 1, 'R', 'red');
ok(X.inCheck(chk, 'black'), '红车(4,1)将军黑将(4,0)');
ok(!X.inCheck(chk, 'red'), '红方未被将军');

console.log('\n== 吃子与胜负 ==');
let fin = X.newGame(); clear(fin);
place(fin, 4, 0, 'G', 'black'); place(fin, 4, 9, 'G', 'red'); place(fin, 4, 8, 'R', 'red');
fin.turn = 'red';
let cap = X.applyMove(fin, 4, 8, 4, 0);
ok(cap.captured && cap.captured.type === 'G', '红车吃黑将');
X.checkEnd(fin);
ok(fin.gameOver && fin.winner === 'red', '吃掉主将 → 红方胜');
ok(fin.reason === 'capture', '终局原因=capture');

console.log('\n== 无合法着法（困毙）判负 ==');
let sb = X.newGame(); clear(sb);
place(sb, 4, 0, 'G', 'black');
place(sb, 3, 0, 'R', 'red'); place(sb, 5, 0, 'R', 'red'); place(sb, 4, 2, 'R', 'red');
place(sb, 4, 9, 'G', 'red');
sb.turn = 'black';
ok(!X.hasAnyMove(sb, 'black'), '黑将四面受困无着法');
X.checkEnd(sb);
ok(sb.gameOver && sb.winner === 'red' && sb.reason === 'checkmate', '困毙/将死 → 红方胜');

console.log('\n== 不能吃/占己方棋子 ==');
let own = X.newGame(); clear(own);
place(own, 4, 5, 'H', 'red'); place(own, 6, 6, 'R', 'red'); // 己方车挡在马的目标
ok(moves(own, 4, 5).indexOf('6,6') === -1, '马不可跳上己方车(6,6)');
// 帅不能走到己方仕/士上
let ownG = X.newGame(); clear(ownG);
place(ownG, 4, 9, 'G', 'red'); place(ownG, 3, 8, 'A', 'red');
ok(moves(ownG, 4, 9).indexOf('3,8') === -1, '帅不可走到己方仕(3,8)');
ok(moves(ownG, 4, 9).indexOf('4,8') !== -1, '帅仍可走到空格(4,8)');
// 兵被己方子挡住不能前进
let ownS = X.newGame(); clear(ownS);
place(ownS, 0, 6, 'S', 'red'); place(ownS, 0, 5, 'C', 'red');
ok(moves(ownS, 0, 6).indexOf('0,5') === -1, '兵被己方炮挡住不能前进');
// 相被己方子占目标格
let ownE = X.newGame(); clear(ownE);
place(ownE, 2, 9, 'E', 'red'); place(ownE, 0, 7, 'H', 'red');
ok(moves(ownE, 2, 9).indexOf('0,7') === -1, '相不可走到己方马(0,7)');
ok(moves(ownE, 2, 9).indexOf('4,7') !== -1, '相仍可到另一角(4,7)');

console.log('\n== 自保过滤：不能走成送将 ==');
let sel = X.newGame(); clear(sel);
place(sel, 4, 9, 'G', 'red'); place(sel, 4, 0, 'G', 'black');
place(sel, 0, 0, 'R', 'red'); // 红车在(0,0)，黑将(4,0)同列
// 红车(0,0)沿第0列向上被黑将将军? 黑将在(4,0)。红车若走(4,0)吃将 → 直接赢
// 验证红车不能横走到会暴露帅的格子——构造：黑车(0,9)盯住红帅(4,9)同列
let sel2 = X.newGame(); clear(sel2);
place(sel2, 4, 9, 'G', 'red'); place(sel2, 4, 0, 'G', 'black');
place(sel2, 4, 1, 'R', 'black'); // 黑车正将红帅
ok(X.inCheck(sel2, 'red'), '黑车(4,1)将军红帅');
// 红车(0,1)可沿第1行走到(4,1)吃掉黑车解将
place(sel2, 0, 1, 'R', 'red');
let rookSel = moves(sel2, 0, 1);
ok(rookSel.indexOf('4,1') !== -1, '红车(0,1)可吃黑车(4,1)解将');
// 红车若横向走到 (8,1) 不垫将 → 非法（仍被将军）
ok(rookSel.indexOf('8,1') === -1, '红车(0,1)走到(8,1)不垫将 → 非法');
// 纵向走 (0,0) 不垫将 → 非法
ok(rookSel.indexOf('0,0') === -1, '红车(0,1)走到(0,0)不垫将 → 非法');

console.log('\n================');
console.log('通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
