/* ============================================================
 * 中国象棋规则引擎（纯逻辑，无 Three.js 依赖）
 * 坐标约定：col 0..8（左→右），row 0..9（上=黑方 → 下=红方）
 * 黑方在上（row 0..4 为黑半场），红方在下（row 5..9 为红半场），
 * 楚河汉界在 row 4 与 row 5 之间。
 * 棋子类型：
 *   G=帥/將  A=仕/士  E=相/象  H=馬  R=車  C=砲/炮  S=兵/卒
 * ============================================================ */
(function (global) {
  'use strict';

  var CHAR = {
    red:   { G: '帥', A: '仕', E: '相', H: '馬', R: '車', C: '砲', S: '兵' },
    black: { G: '將', A: '士', E: '象', H: '馬', R: '車', C: '炮', S: '卒' }
  };

  var BACK_RANK = ['R', 'H', 'E', 'A', 'G', 'A', 'E', 'H', 'R'];

  function newGame() {
    var board = [];
    for (var r = 0; r < 10; r++) board.push(new Array(9).fill(null));
    for (var c = 0; c < 9; c++) {
      board[0][c] = { type: BACK_RANK[c], side: 'black' };
      board[9][c] = { type: BACK_RANK[c], side: 'red' };
    }
    board[2][1] = { type: 'C', side: 'black' };
    board[2][7] = { type: 'C', side: 'black' };
    board[7][1] = { type: 'C', side: 'red' };
    board[7][7] = { type: 'C', side: 'red' };
    [0, 2, 4, 6, 8].forEach(function (c) {
      board[3][c] = { type: 'S', side: 'black' };
      board[6][c] = { type: 'S', side: 'red' };
    });
    return { board: board, turn: 'red', moveNum: 1, gameOver: false, winner: null, reason: null };
  }

  function inBoard(c, r) { return c >= 0 && c <= 8 && r >= 0 && r <= 9; }

  function at(state, c, r) { return state.board[r][c]; }

  /* 九宫 */
  function inPalace(side, c, r) {
    if (c < 3 || c > 5) return false;
    return side === 'red' ? (r >= 7 && r <= 9) : (r >= 0 && r <= 2);
  }

  /* 是否已过河（进入对方半场） */
  function crossedRiver(side, r) {
    return side === 'red' ? r <= 4 : r >= 5;
  }

  /* 前进方向（row 增量）：红方朝上(-1)，黑方朝下(+1) */
  function fwd(side) { return side === 'red' ? -1 : 1; }

  function opponent(side) { return side === 'red' ? 'black' : 'red'; }

  /* 将帅位置 */
  function generalPos(state, side) {
    for (var r = 0; r < 10; r++)
      for (var c = 0; c < 9; c++) {
        var p = state.board[r][c];
        if (p && p.side === side && p.type === 'G') return { col: c, row: r };
      }
    return null;
  }

  /* 双将是否照面（同一列且中间无子） */
  function generalsFacing(state) {
    var rg = generalPos(state, 'red'), bg = generalPos(state, 'black');
    if (!rg || !bg || rg.col !== bg.col) return false;
    var min = Math.min(rg.row, bg.row), max = Math.max(rg.row, bg.row);
    for (var r = min + 1; r < max; r++)
      if (state.board[r][rg.col]) return false;
    return true;
  }

  /* 某一棋子的「原始着法」（不排除将军暴露，供攻击判定用） */
  function rawMoves(state, c, r) {
    var p = state.board[r][c];
    if (!p) return [];
    var out = [];
    var add = function (tc, tr) {
      if (!inBoard(tc, tr)) return;
      var cur = state.board[tr][tc];
      if (cur && cur.side === p.side) return; // 不能吃/占己方棋子
      out.push({ col: tc, row: tr });
    };

    /* 车/直线滑行：走空格，遇子即停，可吃第一枚敌方棋子 */
    var rookSlide = function (dc, dr) {
      var tc = c + dc, tr = r + dr;
      while (inBoard(tc, tr) && !state.board[tr][tc]) { add(tc, tr); tc += dc; tr += dr; }
      if (inBoard(tc, tr) && state.board[tr][tc].side !== p.side) add(tc, tr);
    };

    /* 炮/滑行：走空格不需炮架；吃子须隔恰好一枚炮架（敌我皆可）再吃第一枚敌子 */
    var cannonSlide = function (dc, dr) {
      var tc = c + dc, tr = r + dr;
      while (inBoard(tc, tr) && !state.board[tr][tc]) { add(tc, tr); tc += dc; tr += dr; }
      if (!inBoard(tc, tr)) return;              // 前方无子，不能隔空吃
      tc += dc; tr += dr;                         // 跳过炮架
      while (inBoard(tc, tr) && !state.board[tr][tc]) { tc += dc; tr += dr; }
      if (inBoard(tc, tr) && state.board[tr][tc].side !== p.side) add(tc, tr);
    };

    switch (p.type) {
      case 'G': {
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) {
          if (inPalace(p.side, c + d[0], r + d[1])) add(c + d[0], r + d[1]);
        });
        break;
      }
      case 'A': {
        [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(function (d) {
          if (inPalace(p.side, c + d[0], r + d[1])) add(c + d[0], r + d[1]);
        });
        break;
      }
      case 'E': {
        [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(function (d) {
          var tc = c + d[0], tr = r + d[1];
          if (!inBoard(tc, tr)) return;
          if (state.board[r + d[1] / 2][c + d[0] / 2]) return; // 塞象眼
          var stay = p.side === 'red' ? tr >= 5 : tr <= 4;
          if (stay) add(tc, tr);
        });
        break;
      }
      case 'H': {
        [[1,2],[1,-2],[-1,2],[-1,-2],[2,1],[2,-1],[-2,1],[-2,-1]].forEach(function (d) {
          var tc = c + d[0], tr = r + d[1];
          if (!inBoard(tc, tr)) return;
          var legCol = c + (Math.abs(d[0]) === 2 ? d[0] / 2 : 0);
          var legRow = r + (Math.abs(d[1]) === 2 ? d[1] / 2 : 0);
          if (state.board[legRow][legCol]) return; // 蹩马腿
          add(tc, tr);
        });
        break;
      }
      case 'R': {
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) { rookSlide(d[0], d[1]); });
        break;
      }
      case 'C': {
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) { cannonSlide(d[0], d[1]); });
        break;
      }
      case 'S': {
        var fr = r + fwd(p.side);
        if (inBoard(c, fr)) add(c, fr);
        if (crossedRiver(p.side, r)) {
          add(c + 1, r);
          add(c - 1, r);
        }
        break;
      }
    }
    return out;
  }

  /* 该方主将是否处于被将军（含双将照面） */
  function inCheck(state, side) {
    var g = generalPos(state, side);
    if (!g) return false;
    if (generalsFacing(state)) return true;
    var foe = opponent(side);
    for (var r = 0; r < 10; r++)
      for (var c = 0; c < 9; c++) {
        var p = state.board[r][c];
        if (!p || p.side !== foe) continue;
        var ms = rawMoves(state, c, r);
        for (var i = 0; i < ms.length; i++)
          if (ms[i].col === g.col && ms[i].row === g.row) return true;
      }
    return false;
  }

  /* 模拟走一步，返回新棋盘（浅拷贝 2D 数组） */
  function simulateBoard(board, fc, fr, tc, tr) {
    var nb = board.map(function (row) { return row.slice(); });
    nb[tr][tc] = nb[fr][fc];
    nb[fr][fc] = null;
    return nb;
  }

  /* 合法着法（已排除走子后己方主将暴露 / 照面） */
  function legalMoves(state, c, r) {
    var p = state.board[r][c];
    if (!p) return [];
    var raw = rawMoves(state, c, r);
    return raw.filter(function (m) {
      var nb = simulateBoard(state.board, c, r, m.col, m.row);
      var tmp = { board: nb };
      return !inCheck(tmp, p.side);
    });
  }

  /* 当前走子方的全部合法着法 */
  function allLegalMoves(state) {
    var out = [];
    for (var r = 0; r < 10; r++)
      for (var c = 0; c < 9; c++) {
        var p = state.board[r][c];
        if (!p || p.side !== state.turn) continue;
        var ms = legalMoves(state, c, r);
        if (ms.length) out.push({ from: { col: c, row: r }, moves: ms });
      }
    return out;
  }

  /* 落子。若吃子返回被吃棋子信息。 */
  function applyMove(state, fc, fr, tc, tr) {
    var moved = state.board[fr][fc];
    var captured = state.board[tr][tc];
    state.board[tr][tc] = moved;
    state.board[fr][fc] = null;
    state.moveNum = state.turn === 'black' ? state.moveNum + 1 : state.moveNum;
    state.turn = opponent(state.turn);
    return { moved: moved, captured: captured };
  }

  /* 无子可动（将死 / 困毙），走子方判负 */
  function hasAnyMove(state, side) {
    for (var r = 0; r < 10; r++)
      for (var c = 0; c < 9; c++) {
        var p = state.board[r][c];
        if (p && p.side === side && legalMoves(state, c, r).length) return true;
      }
    return false;
  }

  /* 检查终局：无合法着法 → 走子方输 */
  function checkEnd(state) {
    if (state.gameOver) return state;
    var side = state.turn;
    var gen = generalPos(state, side);
    if (!gen) { // 主将不存在（被吃）→ 判负
      state.gameOver = true;
      state.winner = opponent(side);
      state.reason = 'capture';
      return state;
    }
    if (!hasAnyMove(state, side)) {
      state.gameOver = true;
      state.winner = opponent(side);
      state.reason = inCheck(state, side) ? 'checkmate' : 'stalemate';
      return state;
    }
    return state;
  }

  function displayName(piece) {
    return piece ? CHAR[piece.side][piece.type] : '';
  }

  var Xiangqi = {
    CHAR: CHAR,
    newGame: newGame,
    at: at,
    inBoard: inBoard,
    inPalace: inPalace,
    crossedRiver: crossedRiver,
    opponent: opponent,
    generalPos: generalPos,
    generalsFacing: generalsFacing,
    rawMoves: rawMoves,
    inCheck: inCheck,
    legalMoves: legalMoves,
    allLegalMoves: allLegalMoves,
    applyMove: applyMove,
    hasAnyMove: hasAnyMove,
    checkEnd: checkEnd,
    displayName: displayName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Xiangqi;
  else global.Xiangqi = Xiangqi;
})(typeof window !== 'undefined' ? window : globalThis);
