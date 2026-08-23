/* ============================================================
 * 主程序：场景搭建、点击拾取、回合状态机、HUD 与胜利判定
 * 回合状态机：idle → selected（选中+高亮）→ busy（行棋动画）→ idle
 * ============================================================ */
(function () {
  'use strict';

  var renderer, scene, camera, controls, clock;
  var game;
  var pieceMap = {};   // "col,row" → piece3D
  var pieces = [];     // 全部 piece3D
  var selected = null; // 当前选中的棋子
  var selectedRingMesh = null;
  var moveTargets = []; // 当前高亮的目标格 [{col,row,capture}]
  var state = 'idle';  // idle | selected | busy
  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();
  var msgTimer = null;
  var mySide = null;      // 在线模式：'red' | 'black' | 'spec'；null = 本地热座
  var pendingMoves = [];  // 本地动画期间到达的远程着法队列（FIFO）
  var camPinned = false;  // __chess.setCamera 后钉死镜头（测试/调试用）
  var camBase = new THREE.Vector3(0, 0, 0);   // 本局固定观察点（按 mySide）

  var $ = function (id) { return document.getElementById(id); };

  function init() {
    var canvas = $('game');
    renderer = new THREE.WebGLRenderer({ antialias: false, canvas: canvas }); // 关 MSAA，移动端省大量填充
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // 控 DPR，减少移动端填充量
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // 普通 PCF 比 PCFSoft 便宜
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c1410);
    scene.fog = new THREE.Fog(0x1c1410, 14, 34);

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 9.5, 12.5);

    /* 灯光（暖色室内光） */
    scene.add(new THREE.HemisphereLight(0xf7e9cf, 0x4a3626, 0.75));
    var dir = new THREE.DirectionalLight(0xfff1dc, 1.05);
    dir.position.set(8, 12, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(512, 512); // 512 阴影贴图，显著降低阴影 pass 开销
    dir.shadow.camera.left = -8; dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8; dir.shadow.camera.bottom = -8;
    dir.shadow.camera.near = 1; dir.shadow.camera.far = 35;
    dir.shadow.camera.updateProjectionMatrix();
    scene.add(dir);
    var rim = new THREE.DirectionalLight(0xd9c2a0, 0.3); // 暖色补光
    rim.position.set(-6, 8, -7);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x77624d, 0.32));

    /* 程序化环境反射贴图：让金属/丝绸呈现真实反光 */
    (function setupEnv() {
      var pmrem = new THREE.PMREMGenerator(renderer);
      var envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x1c1410);
      function panel(color, x, y, z, w) {
        var m = new THREE.Mesh(
          new THREE.PlaneGeometry(w || 5, w ? w * 0.6 : 3),
          new THREE.MeshBasicMaterial({ color: color })
        );
        m.position.set(x, y, z);
        m.lookAt(0, 0, 0);
        envScene.add(m);
      }
      panel(0xe8d3ae, 6, 4, 6);      // 主光（冷蓝）
      panel(0xb09a78, -7, 3, -6, 4); // 冷补光
      panel(0xf2e2c4, 0, 9, 0);      // 顶光
      panel(0x2b2018, 0, -5, 0, 9);  // 地光
      var rt = pmrem.fromScene(envScene, 0.18);
      scene.environment = rt.texture;
    })();

    /* 视角控制 */
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enableRotate = false; // 视角固定，玩家不旋转
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 22;
    controls.maxPolarAngle = 1.42;
    controls.target.set(0, 0, 0);

    Board.scene = scene;
    Anim.scene = scene;
    Board.buildBoard(scene);

    /* 事件 */
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onResize);
    $('btn-restart').addEventListener('click', resetGame);
    $('btn-play-again').addEventListener('click', requestRematch);
    $('btn-sound').addEventListener('click', function () {
      Audio.ensure();
      var on = Audio.toggle();
      this.textContent = on ? '🔊 音效：开' : '🔇 音效：关';
    });

    /* 在线模式：网络层回调接入 */
    Net.handlers = {
      /* WS 连接失败 → 本地热座 */
      onLocal: function () {
        mySide = null;
        updateButtons();
      },
      /* 创建/加入房间（含座位接替） */
      onEnterRoom: function (msg) {
        mySide = msg.side;
        loadState(msg.state);
        updateButtons();
      },
      /* 第二人就座，对局开始 */
      onGameStart: function (msg) {
        loadState(msg.state);
      },
      onMove: applyRemoteMove,
      onMoveAck: function (msg) {
        if (game.turn !== msg.turn) Net.requestSync();
      },
      onOpponentJoined: function () {
        setMsg('对手已加入');
        updateButtons();
      },
      onOpponentLeft: function () {
        deselect();
      },
      /* 对手请求再来一局 → 接受按钮 */
      onRematchOffer: function () {
        var b = $('btn-play-again');
        b.textContent = '接受再来一局';
        b.disabled = false;
      },
      onRematchStart: function (msg) {
        loadState(msg.state);
      },
      onSyncState: function (msg) {
        loadState(msg.state);
      },
      onSpecCount: function () {},
      onRoomClosed: function () {
        mySide = null;
        setMsg('房间已关闭');
      },
      onError: function (msg) {
        setMsg('⚠ ' + (msg.message || '操作失败'));
      },
      onLeave: function () {
        mySide = null;
        deselect();
        updateButtons();
      }
    };
    updateButtons();

    resetGame();
    clock = new THREE.Clock();
    animate();
  }

  /* ---------------- 建局 / 摆子 ---------------- */
  /* 视角固定，不可旋转；玩家俯视自己的阵营（红=看红方阵、黑=看黑方阵、观战/本地=看全盘） */
  function applyDefaultCamera() {
    camPinned = false;
    controls.enableRotate = false;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 5;
    controls.maxDistance = 22;
    controls.maxPolarAngle = 1.42;
    if (Net.isOnline() && (mySide === 'red' || mySide === 'black')) {
      var dirZ = mySide === 'red' ? 6.5 : -6.5;
      camera.position.set(0, 11, dirZ); // 抬高拉远：全盘入画，己方阵营仍占下部
      camBase.set(0, 0, 0);
    } else {
      camera.position.set(0, 12, 0); // 观战/本地：正上俯视全盘
      camBase.set(0, 0, 0);
    }
    controls.target.copy(camBase);
    controls.update();
  }

  /* 按指定局面重建棋盘（本地开局用 Xiangqi.newGame()，在线用服务端局面） */
  function loadState(st) {
    pieces.forEach(function (p) { scene.remove(p.group); });
    game = JSON.parse(JSON.stringify(st));
    pieceMap = {};
    pieces = [];
    selected = null;
    moveTargets = [];
    pendingMoves = [];
    state = 'idle';
    Board.clearHighlights();
    if (selectedRingMesh) { scene.remove(selectedRingMesh); selectedRingMesh = null; }

    for (var r = 0; r < 10; r++)
      for (var c = 0; c < 9; c++) {
        var p = game.board[r][c];
        if (p) createPiece(p.type, p.side, c, r);
      }

    hideBanner();
    resetPlayAgainBtn();
    setMsg('');
    updateHUD();
    applyDefaultCamera();
    if (game.gameOver) showWin(); // 中途加入/接替时若已终局则直接显示结果
  }

  function resetGame() { loadState(Xiangqi.newGame()); }

  /* 本地/我方是否可操作棋子（在线：非我方回合或观战不可操作） */
  function canMoveLocally() {
    if (!Net.isOnline()) return true;
    if (mySide === 'spec' || !mySide) return false;
    return game.turn === mySide;
  }

  function createPiece(type, side, col, row) {
    var fig = Figures.buildFigure(type, side);
    var piece = {
      group: fig.group, anchors: fig.anchors, type: type, side: side,
      col: col, row: row, baseY: 0,
      phase: Math.random() * Math.PI * 2,
      selected: false, busy: false
    };
    fig.group.traverse(function (o) { if (o.isMesh) o.userData.root = fig.group; });
    fig.group.userData.piece = piece;
    var p = Board.pos(col, row);
    fig.group.position.set(p.x, 0, p.z);
    scene.add(fig.group);
    pieces.push(piece);
    pieceMap[col + ',' + row] = piece;
    return piece;
  }

  /* ---------------- 点击交互 ---------------- */
  function onPointerDown(e) {
    Audio.ensure();
    if (e.button !== 0) return;            // 仅左键
    if (!canMoveLocally()) return;         // 在线：非我方回合 / 观战不可操作
    if (state === 'busy' || game.gameOver) return;

    var rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    // 1) 先判高亮目标格
    if (state === 'selected') {
      var hg = raycaster.intersectObjects(Board.highlights, false);
      if (hg.length) {
        var t = hg[0].object.userData.target;
        doMove(selected, t);
        return;
      }
    }
    // 2) 再判棋子
    var pm = raycaster.intersectObjects(pieces.map(function (p) { return p.group; }), true);
    if (pm.length) {
      var root = pm[0].object;
      while (root && !root.userData.piece) root = root.parent;
      if (root && root.userData.piece) {
        handlePieceClick(root.userData.piece);
        return;
      }
    }
    // 3) 点空处 → 取消选中
    if (state === 'selected') deselect();
  }

  function handlePieceClick(piece) {
    if (piece.side !== game.turn) {
      deselect();
      Audio.illegal();
      setMsg('轮到 ' + (game.turn === 'red' ? '红方' : '黑方') + ' 走棋');
      return;
    }
    if (selected === piece) { deselect(); return; }
    deselect();
    select(piece);
    /* 点兵战鼓（仅真实点击路径，测试走 __chess.select 不受影响） */
    Audio.drum();
  }

  function select(piece) {
    selected = piece;
    piece.selected = true;
    state = 'selected';
    var legal = Xiangqi.legalMoves(game, piece.col, piece.row);
    moveTargets = legal.map(function (m) {
      return { col: m.col, row: m.row, capture: !!game.board[m.row][m.col] };
    });
    Board.showHighlights(moveTargets);
    if (selectedRingMesh) scene.remove(selectedRingMesh);
    selectedRingMesh = Board.selectedRing();
    var p = Board.pos(piece.col, piece.row);
    selectedRingMesh.position.set(p.x, 0, p.z);
    scene.add(selectedRingMesh);
    Audio.select();
  }

  function deselect() {
    if (!selected) return;
    selected.selected = false;
    selected = null;
    moveTargets = [];
    state = 'idle';
    Board.clearHighlights();
    if (selectedRingMesh) { scene.remove(selectedRingMesh); selectedRingMesh = null; }
  }

  /* ---------------- 调试/测试接口 ---------------- */
  window.__chess = {
    reset: resetGame,
    loadState: loadState,
    get turn() { return game.turn; },
    get moveNum() { return game.moveNum; },
    get gameOver() { return game.gameOver; },
    get winner() { return game.winner; },
    get state() { return state; },
    get selected() { return selected ? { col: selected.col, row: selected.row } : null; },
    get highlights() { return moveTargets.slice(); },
    pieceCount: function () { return pieces.length; },
    pieces: function () { return pieces.map(function (p) { return { col: p.col, row: p.row, type: p.type, side: p.side }; }); },
    select: function (col, row) {
      var p = pieceMap[col + ',' + row];
      if (!p) return false;
      if (selected) deselect();
      select(p);
      return true;
    },
    deselect: deselect,
    moveSelected: function (col, row) {
      if (!canMoveLocally()) return false;
      if (state !== 'selected' || !selected) return false;
      var t = moveTargets.filter(function (m) { return m.col === col && m.row === row; })[0];
      if (!t) return false;
      return doMove(selected, t).then(function () { return true; });
    },
    /* 3D 点 → 屏幕像素（测试用） */
    project: function (x, y, z) {
      var v = new THREE.Vector3(x, y, z).project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
        y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight
      };
    },

    /* 相机调试：定位视角（钉死镜头，停用贴近/震动，供测试稳定点击） */
    setCamera: function (x, y, z, tx, ty, tz) {
      camera.position.set(x, y, z);
      controls.target.set(tx, ty, tz);
      camPinned = true;
      controls.update();
    },

    /* 棋盘交点 → 屏幕 CSS 像素坐标（供测试模拟点击） */
    screenPos: function (col, row) {
      var p = Board.pos(col, row);
      var v = new THREE.Vector3(p.x, 0.2, p.z).project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
        y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight
      };
    },

    /* 测试钩子：对指定棋子类型跑完整吃子动画（冲锋→攻击→被吃倒地），返回 Promise<boolean> */
    testCapture: function (type) {
      var figA = Figures.buildFigure(type, 'red');
      var figV = Figures.buildFigure('S', 'black');
      figA.group.position.set(-4, 0, -1);
      figV.group.position.set(4, 0, 0);
      scene.add(figA.group); scene.add(figV.group);
      var attacker = { group: figA.group, anchors: figA.anchors, type: type, side: 'red', busy: true, col: 0, row: 4 };
      var victim = { group: figV.group, anchors: figV.anchors, type: 'S', side: 'black', busy: true, col: 8, row: 4 };
      var from = { col: 0, row: 4 }, to = { col: 8, row: 4 };
      return Anim.move(attacker, from, to, true)
        .then(function () { return Anim.attack(attacker, victim); })
        .then(function () { return Anim.removeVictim(victim); })
        .then(function () { scene.remove(figA.group); return true; })
        .catch(function (e) {
          console.error('testCapture fail ' + type, e);
          scene.remove(figA.group); scene.remove(figV.group);
          return false;
        });
    },

    /* 选子并走棋（若合法），返回 Promise<boolean> */
    move: function (fc, fr, tc, tr) {
      if (!canMoveLocally()) return Promise.resolve(false);
      var p = pieceMap[fc + ',' + fr];
      if (!p || p.side !== game.turn) return Promise.resolve(false);
      if (selected) deselect();
      var legal = Xiangqi.legalMoves(game, fc, fr).some(function (m) { return m.col === tc && m.row === tr; });
      if (!legal) return Promise.resolve(false);
      select(p);
      return doMove(p, { col: tc, row: tr, capture: !!game.board[tr][tc] }).then(function () { return true; });
    }
  };

  /* ---------------- 行棋流程 ---------------- */
  /* opts: { send: 是否发送到服务器(默认 true), expectTurn: 服务器走棋后的回合(失步检测) } */
  async function performMove(piece, to, opts) {
    opts = opts || {};
    var from = { col: piece.col, row: piece.row };
    var victim = to.capture ? pieceMap[to.col + ',' + to.row] : null;
    deselect();
    state = 'busy'; // 动画期间锁定输入

    /* 下达冲锋命令 */
    Audio.charge();

    /* 乐观发送：动画前告知服务器，减少对手感知延迟 */
    if (opts.send !== false && Net.isOnline()) Net.sendMove(from, to);

    piece.busy = true;
    if (victim) victim.busy = true;
    try {
      await Anim.move(piece, from, to, !!victim);
      if (victim) {
        await Anim.attack(piece, victim);
        await Anim.removeVictim(victim);
      }
    } catch (err) { console.error(err); }
    piece.busy = false;
    // 火炮原地开火，动画后落位到目标格
    piece.group.position.copy(Board.pos(to.col, to.row));
    piece.group.position.y = 0;

    /* 更新规则 */
    Xiangqi.applyMove(game, from.col, from.row, to.col, to.row);
    delete pieceMap[from.col + ',' + from.row];
    piece.col = to.col;
    piece.row = to.row;
    pieceMap[to.col + ',' + to.row] = piece;
    if (victim) {
      scene.remove(victim.group);
      pieces = pieces.filter(function (x) { return x !== victim; });
    }

    /* 失步检测：与服务器权威结果比对，不一致则全量重同步 */
    if (opts.expectTurn && game.turn !== opts.expectTurn) Net.requestSync();

    Xiangqi.checkEnd(game);
    if (game.gameOver) {
      showWin();
    } else if (Xiangqi.inCheck(game, game.turn)) {
      setMsg('将军！');
      Audio.check();
    }
    updateHUD();
    state = 'idle';
    drainPending(); // 处理排队中的远程着法
  }

  /* 本地走棋（我方落子 / 本地热座）：乐观发送到服务器 */
  function doMove(piece, to) { return performMove(piece, to, { send: true }); }

  /* 远程着法（对手 / 观战收到）：本地镜像推进，不回发 */
  function applyRemoteMove(msg) {
    if (state === 'selected') deselect();
    if (state === 'busy' || pendingMoves.length) { pendingMoves.push(msg); return; }
    var piece = pieceMap[msg.from.col + ',' + msg.from.row];
    if (!piece) { Net.requestSync(); return; } // 状态漂移 → 全量重同步
    performMove(piece, {
      col: msg.to.col, row: msg.to.row,
      capture: !!game.board[msg.to.row][msg.to.col]
    }, { send: false, expectTurn: msg.turn });
  }

  function drainPending() {
    if (state !== 'idle') return;
    var m = pendingMoves.shift();
    if (m) applyRemoteMove(m);
  }

  /* ---------------- HUD ---------------- */
  function updateHUD() {
    var turnEl = $('turn');
    var sideName = game.turn === 'red' ? '红方' : '黑方';
    turnEl.textContent = (Net.isOnline() && mySide === 'spec' ? '观战 · ' : '') + sideName + '行棋';
    turnEl.className = 'turn ' + (game.turn === 'red' ? 'red' : 'black');
    $('moveinfo').textContent = '第 ' + game.moveNum + ' 回合';
  }

  function setMsg(text) {
    var m = $('msg');
    m.textContent = text;
    if (text) {
      m.classList.add('show');
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { m.classList.remove('show'); }, 1600);
    } else {
      m.classList.remove('show');
    }
  }

  function showWin() {
    var winner = game.winner === 'red' ? '红方' : '黑方';
    var reason = game.reason === 'checkmate' ? '将死！' :
      game.reason === 'stalemate' ? '困毙！' :
      game.reason === 'capture' ? '擒王！' : '';
    $('banner-title').textContent = '🏆 ' + winner + '获胜';
    $('banner-sub').textContent = reason;
    $('banner').classList.remove('hidden');
    Audio.win();
  }

  function hideBanner() { $('banner').classList.add('hidden'); }

  function resetPlayAgainBtn() {
    var b = $('btn-play-again');
    b.textContent = '再来一局';
    b.disabled = false;
  }

  /* 在线对局中隐藏"重新开始"，避免本地重开导致与服务端失步 */
  function updateButtons() {
    $('btn-restart').style.display = (Net.isOnline() && Net.inRoom()) ? 'none' : '';
  }

  /* "再来一局"：在线=发起/接受 rematch，本地=直接重开 */
  function requestRematch() {
    if (Net.isOnline() && Net.inRoom()) {
      if (mySide === 'spec') return;
      Net.sendRematch();
      var b = $('btn-play-again');
      b.textContent = '等待对方同意…';
      b.disabled = true;
    } else {
      resetGame();
    }
  }

  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  /* ---------------- 主循环 ---------------- */
  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    var t = clock.elapsedTime;
    controls.update();

    /* 经典样式：棋子静置，仅选中的棋子轻轻抬起 */
    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i];
      if (pc.busy) continue;
      pc.group.position.y = pc.baseY + (pc.selected ? 0.16 : 0);
    }

    Board.updateHighlights(dt);
    Anim.updateEffects(dt);
    renderer.render(scene, camera);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
