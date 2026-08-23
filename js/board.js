/* ============================================================
 * 经典木质棋盘：浅色木盘面、深褐网格线、楚河汉界、炮/兵位标记
 * 坐标：col 0..8 → x = (col-4)；row 0..9 → z = (row-4.5)；盘面顶 y=0
 * 保留原 API：pos / showHighlights / clearHighlights /
 *            updateHighlights / selectedRing / scene / group / POS
 * ============================================================ */
(function () {
  'use strict';

  var Board = {
    scene: null,
    group: null,
    highlights: [],
    POS: null
  };

  var SPACING = 1.0;

  /* 交点 → 3D 坐标 */
  function pos(col, row) {
    return new THREE.Vector3((col - 4) * SPACING, 0, (row - 4.5) * SPACING);
  }

  /* 材质缓存 */
  var M = (function () {
    var cache = {};
    return function (color, metal, rough) {
      var key = color + '|' + (metal || 0) + '|' + (rough || 0);
      if (!cache[key]) cache[key] = new THREE.MeshStandardMaterial({ color: color, metalness: metal || 0, roughness: rough === undefined ? 0.9 : rough });
      return cache[key];
    };
  })();

  function box(w, h, d, color, x, y, z, parent) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /* 浅木纹贴图（盘面）：米黄底色 + 细密纵向木纹 */
  function woodFaceTexture() {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 512;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#d9b981';
    ctx.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 90; i++) {
      var x = Math.random() * 512;
      var w = 1 + Math.random() * 2.2;
      var a = 0.04 + Math.random() * 0.07;
      ctx.strokeStyle = 'rgba(120,80,38,' + a.toFixed(3) + ')';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (Math.random() - 0.5) * 26, 170, x + (Math.random() - 0.5) * 26, 340, x + (Math.random() - 0.5) * 18, 512);
      ctx.stroke();
    }
    for (var k = 0; k < 5; k++) { /* 少量较深年轮线 */
      var gx = Math.random() * 512;
      ctx.strokeStyle = 'rgba(96,62,28,0.16)';
      ctx.lineWidth = 3 + Math.random() * 4;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx + (Math.random() - 0.5) * 40, 180, gx + (Math.random() - 0.5) * 40, 360, gx, 512);
      ctx.stroke();
    }
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* 深胡桃木纹（桌沿 / 桌面） */
  function darkWoodTexture() {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#4a3526';
    ctx.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 60; i++) {
      var x = Math.random() * 256;
      ctx.strokeStyle = 'rgba(24,14,8,' + (0.05 + Math.random() * 0.08).toFixed(3) + ')';
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 12, 256);
      ctx.stroke();
    }
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }

  /* 楚河汉界文字贴图（透明底，平铺在河面） */
  function riverTextTexture() {
    var cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 1024, 128);
    ctx.font = 'bold 84px "KaiTi","STKaiti","Microsoft YaHei","SimHei",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(58,36,18,0.85)';
    /* 左半：楚 河　右半：漢 界 */
    ctx.fillText('楚', 190, 66);
    ctx.fillText('河', 350, 66);
    ctx.fillText('漢', 674, 66);
    ctx.fillText('界', 834, 66);
    return new THREE.CanvasTexture(cv);
  }

  /* 炮位/兵位小十字标记（四角短折线；边路省略朝外一侧） */
  function positionMark(x, z, skipLeft, skipRight, parent) {
    var L = 0.13;           /* 臂长 */
    var off = 0.09;         /* 距交点偏移 */
    var t = 0.022, y = 0.021;
    /* [w, d, cx, cz] × 左上/右上/左下/右下 */
    var segs = [
      [-off - L / 2, -off, L, t], [-off, -off - L / 2, t, L],
      [ off + L / 2, -off, L, t], [ off, -off - L / 2, t, L],
      [-off - L / 2,  off, L, t], [-off,  off + L / 2, t, L],
      [ off + L / 2,  off, L, t], [ off,  off + L / 2, t, L]
    ];
    var flags = [
      !skipLeft, !skipLeft,
      !skipRight, !skipRight,
      !skipLeft, !skipLeft,
      !skipRight, !skipRight
    ];
    segs.forEach(function (s, i) {
      if (!flags[i]) return;
      box(s[2], 0.004, s[3], 0x3a2414, x + s[0], y, z + s[1], parent);
    });
  }

  function buildBoard(scene) {
    var g = new THREE.Group();

    /* 木桌（深胡桃木，顶面 y=-0.06） */
    var table = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.5, 20),
      new THREE.MeshStandardMaterial({ map: darkWoodTexture(), color: 0xffffff, roughness: 0.82 })
    );
    table.position.y = -0.31;
    table.receiveShadow = true;
    g.add(table);

    /* 棋盘外框：四条边框梁围成凸起外沿（中间镂空，露出盘面与网格线） */
    var frameMat = new THREE.MeshStandardMaterial({ map: darkWoodTexture(), color: 0xffffff, roughness: 0.7 });
    function frameBar(w, d, x, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.26, d), frameMat);
      m.position.set(x, -0.06, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    }
    var BW = 0.4;                                   /* 边框宽 */
    frameBar(10.6, BW, 0, -(5.8 - BW / 2));         /* 上沿 */
    frameBar(10.6, BW, 0,  (5.8 - BW / 2));         /* 下沿 */
    frameBar(BW, 11.6 - 2 * BW, -(5.3 - BW / 2), 0);/* 左沿 */
    frameBar(BW, 11.6 - 2 * BW,  (5.3 - BW / 2), 0);/* 右沿 */

    /* 浅木盘面：顶面与框沿同高，棋子落在框内凹槽底（y=0），
       盘面本体从 y=-0.04 到 y=0.06，中间挖槽视觉由线层+暗色底呈现 */
    var face = new THREE.Mesh(
      new THREE.BoxGeometry(9.8, 0.2, 10.8),
      new THREE.MeshStandardMaterial({ map: woodFaceTexture(), color: 0xffffff, roughness: 0.6 })
    );
    face.position.y = -0.09;   /* 顶面 y=0.01 */
    face.receiveShadow = true;
    g.add(face);

    /* 网格线（深褐色），y≈0.02 —— 与旧版一致，棋子底面 y=0 不穿模 */
    var lineH = 0.036, lineW = 0.05, LC = 0x2e1c0e;

    /* 10 条横线 */
    for (var r = 0; r < 10; r++) {
      box(8.0 + lineW, lineH, lineW, LC, 0, 0.02, r - 4.5, g);
    }
    /* 9 组竖线：中间河流断开（仅两侧边线贯通） */
    for (var c = 0; c < 9; c++) {
      var x = c - 4;
      if (c === 0 || c === 8) {
        box(lineW, lineH, 8.0 + lineW, LC, x, 0.02, 0, g);
      } else {
        box(lineW, lineH, 4.0, LC, x, 0.02, -2.5, g);
        box(lineW, lineH, 4.0, LC, x, 0.02, 2.5, g);
      }
    }

    /* 九宫斜线 */
    function diagonal(p1, p2) {
      var dx = p2.x - p1.x, dz = p2.z - p1.z;
      var len = Math.sqrt(dx * dx + dz * dz);
      var ang = -Math.atan2(dz, dx);
      var m = new THREE.Mesh(new THREE.BoxGeometry(len, lineH, lineW), M(LC));
      m.position.set((p1.x + p2.x) / 2, 0.02, (p1.z + p2.z) / 2);
      m.rotation.y = ang;
      m.receiveShadow = true;
      g.add(m);
    }
    diagonal(pos(3, 7), pos(5, 9));
    diagonal(pos(5, 7), pos(3, 9));
    diagonal(pos(3, 0), pos(5, 2));
    diagonal(pos(5, 0), pos(3, 2));

    /* 外围加粗边框线（上下两条传统上加粗） */
    box(8.0 + lineW * 2.4, 0.008, lineW * 2.4, LC, 0, 0.028, -4.5, g);
    box(8.0 + lineW * 2.4, 0.008, lineW * 2.4, LC, 0, 0.028, 4.5, g);

    /* 楚河汉界文字（透明贴图，铺在河面） */
    var riverText = new THREE.Mesh(
      new THREE.PlaneGeometry(8.0, 1.0),
      new THREE.MeshBasicMaterial({ map: riverTextTexture(), transparent: true, depthWrite: false })
    );
    riverText.rotation.x = -Math.PI / 2;
    riverText.position.set(0, 0.03, 0);
    riverText.renderOrder = 1;
    g.add(riverText);

    /* 炮位 / 兵位标记 */
    [[1, 2], [7, 2], [1, 7], [7, 7]].forEach(function (p) {
      positionMark(p[0] - 4, p[1] - 4.5, false, false, g);
    });
    [[0, 3], [2, 3], [4, 3], [6, 3], [8, 3]].forEach(function (p) {
      positionMark(p[0] - 4, p[1] - 4.5, p[0] === 0, p[0] === 8, g);
    });
    [[0, 6], [2, 6], [4, 6], [6, 6], [8, 6]].forEach(function (p) {
      positionMark(p[0] - 4, p[1] - 4.5, p[0] === 0, p[0] === 8, g);
    });

    scene.add(g);
    Board.group = g;
    Board.POS = pos;
  }

  /* ---------------- 可行走高亮 ---------------- */
  function clearHighlights() {
    Board.highlights.forEach(function (h) { Board.scene.remove(h); });
    Board.highlights = [];
  }

  /* list: [{col,row,capture}] —— 空点=绿点，吃子=红环
     不透明实心材质：渲染稳定（不受透明排序/帧时序影响），更贴近经典棋类 UI */
  function showHighlights(list) {
    clearHighlights();
    list.forEach(function (t) {
      var p = pos(t.col, t.row);
      var m;
      if (t.capture) {
        m = new THREE.Mesh(
          new THREE.RingGeometry(0.30, 0.46, 32),
          new THREE.MeshBasicMaterial({ color: 0xd94a35, side: THREE.DoubleSide })
        );
        m.rotation.x = -Math.PI / 2;
      } else {
        m = new THREE.Mesh(
          new THREE.CircleGeometry(0.17, 28),
          new THREE.MeshBasicMaterial({ color: 0x2f9e57 })
        );
        m.rotation.x = -Math.PI / 2;
      }
      m.position.set(p.x, 0.04, p.z);
      m.userData.target = t;
      Board.scene.add(m);
      Board.highlights.push(m);

      /* 隐形命中区：覆盖整个交点格（半径 0.49）。
         点击敌方棋子身体或格内任意位置都能命中 —— 射线检测只针对
         Board.highlights 数组，不受棋子模型遮挡影响 */
      var hit = new THREE.Mesh(
        new THREE.CircleGeometry(0.49, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      hit.rotation.x = -Math.PI / 2;
      hit.position.set(p.x, 0.06, p.z);
      hit.userData.target = t;
      Board.scene.add(hit);
      Board.highlights.push(hit);
    });
  }

  function updateHighlights() {}

  /* 选中棋子的金色圆环标记 */
  function selectedRing() {
    var geo = new THREE.RingGeometry(0.40, 0.50, 36);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xe9b64f,
      side: THREE.DoubleSide
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    m.renderOrder = 2;
    return m;
  }

  Board.scene = null;
  Board.buildBoard = buildBoard;
  Board.pos = pos;
  Board.showHighlights = showHighlights;
  Board.clearHighlights = clearHighlights;
  Board.updateHighlights = updateHighlights;
  Board.selectedRing = selectedRing;

  window.Board = Board;
})();
