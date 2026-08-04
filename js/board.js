/* ============================================================
 * 3D 战场棋盘：泥石大地、湿盘面、暗网格、楚河水面、军旗岩石
 * 坐标：col 0..8 → x = (col-4)；row 0..9 → z = (row-4.5)；地面 y=0
 * 保留原 API：pos / showHighlights / clearHighlights /
 *            updateHighlights / selectedRing / scene / group
 * 装饰物约束：y≤0.01 或落在棋盘脚印之外（|x|>4.9 或 |z|>5.4），
 *            绝不与高亮盒（y≈0.02）或棋子（y=0）相交
 * ============================================================ */
(function () {
  'use strict';

  var Board = {
    scene: null,
    group: null,
    highlights: [],
    _highlightPhase: 0,
    POS: null
  };

  var SPACING = 1.0;

  /* 交点 → 3D 坐标 */
  function pos(col, row) {
    return new THREE.Vector3((col - 4) * SPACING, 0, (row - 4.5) * SPACING);
  }

  /* 材质（PBR） */
  var M = (function () {
    var cache = {};
    return function (color, metal, rough) {
      var key = color + '|' + (metal || 0) + '|' + (rough || 0);
      if (!cache[key]) cache[key] = new THREE.MeshStandardMaterial({ color: color, metalness: metal || 0, roughness: rough === undefined ? 0.9 : rough });
      return cache[key];
    };
  })();

  function box(w, h, d, color, x, y, z, parent, rx, ry) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color));
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /* 泥地噪点贴图 */
  function mudTexture() {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#2c3036';
    ctx.fillRect(0, 0, 256, 256);
    var img = ctx.getImageData(0, 0, 256, 256);
    var d = img.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 34;
      d[p] += n; d[p + 1] += n; d[p + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(4, 4);
    return t;
  }

  /* 楚河水面贴图（暗色 + 淡字） */
  function waterTexture() {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#1d3636';
    ctx.fillRect(0, 0, 512, 128);
    ctx.font = 'bold 92px "Microsoft YaHei","SimHei",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(165,185,195,0.22)';
    ctx.fillText('楚 河 · 漢 界', 256, 64);
    return new THREE.CanvasTexture(cv);
  }

  /* 军旗（杆 + 旗面） */
  function banner(color, x, z) {
    var g = new THREE.Group();
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.035, 1.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.45 })
    );
    pole.position.y = 0.95;
    pole.castShadow = true;
    g.add(pole);
    var flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.58),
      new THREE.MeshStandardMaterial({ color: color, side: THREE.DoubleSide, roughness: 0.72 })
    );
    flag.position.set(0.5, 1.32, 0);
    flag.castShadow = true;
    g.add(flag);
    g.position.set(x, 0, z);
    return g;
  }

  function buildBoard(scene) {
    var g = new THREE.Group();

    /* 大泥地（顶面 y=0） */
    var mud = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.3, 22),
      new THREE.MeshStandardMaterial({ map: mudTexture(), color: 0xffffff, metalness: 0, roughness: 0.95 })
    );
    mud.position.y = -0.15;
    mud.receiveShadow = true;
    g.add(mud);

    /* 湿棋盘面（低粗糙度 → 雨水反光） */
    var face = new THREE.Mesh(
      new THREE.BoxGeometry(9.1, 0.02, 10.1),
      new THREE.MeshStandardMaterial({ color: 0x33363c, metalness: 0, roughness: 0.55, envMapIntensity: 1.1 })
    );
    face.position.y = 0.01;
    face.receiveShadow = true;
    g.add(face);

    /* 网格线（暗色沟壑），y≈0.02 */
    var lineH = 0.03, lineW = 0.035;
    for (var r = 0; r < 10; r++) {
      box(8.0, lineH, lineW, 0x15181d, 0, 0.02, r - 4.5, g);
    }
    for (var c = 0; c < 9; c++) {
      var x = c - 4;
      box(lineW, lineH, 4.0, 0x15181d, x, 0.02, -2.5, g);
      box(lineW, lineH, 4.0, 0x15181d, x, 0.02, 2.5, g);
    }

    /* 九宫斜线 */
    function diagonal(p1, p2) {
      var dx = p2.x - p1.x, dz = p2.z - p1.z;
      var len = Math.sqrt(dx * dx + dz * dz);
      var ang = -Math.atan2(dz, dx);
      var m = new THREE.Mesh(new THREE.BoxGeometry(len, lineH, lineW), M(0x15181d));
      m.position.set((p1.x + p2.x) / 2, 0.02, (p1.z + p2.z) / 2);
      m.rotation.y = ang;
      g.add(m);
    }
    diagonal(pos(3, 7), pos(5, 9));
    diagonal(pos(5, 7), pos(3, 9));
    diagonal(pos(3, 0), pos(5, 2));
    diagonal(pos(5, 0), pos(3, 2));

    /* 楚河水面（y=0.012，depthWrite:false 保证高亮/棋子可透过） */
    var water = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 1.0),
      new THREE.MeshStandardMaterial({
        map: waterTexture(), color: 0xffffff,
        metalness: 0, roughness: 0.05,
        transparent: true, opacity: 0.8, depthWrite: false, envMapIntensity: 1.3
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.012, 0);
    g.add(water);

    /* 四角暗石标记 */
    [[0, 0], [8, 0], [0, 9], [8, 9]].forEach(function (c) {
      var p = pos(c[0], c[1]);
      box(0.22, 0.05, 0.22, 0x3a3f46, p.x, 0.02, p.z, g);
    });

    /* 岩石（棋盘脚印之外） */
    var rockPos = [[-6.0, 2.2], [6.4, -1.6], [-6.4, -3.4], [5.6, 3.6], [-2.5, 6.2], [3.2, -6.4]];
    rockPos.forEach(function (rp) {
      var s = 0.28 + Math.random() * 0.3;
      var m = new THREE.Mesh(
        new THREE.DodecahedronGeometry(s, 0),
        M(0x3d434b, 0, 0.95)
      );
      m.position.set(rp[0], s * 0.55, rp[1]);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    });

    /* 水洼（湿反光，y≤0.01，棋盘之外） */
    var puddlePos = [[5.3, 2.8], [-5.6, -2.2], [1.8, 5.7], [-2.4, -5.8]];
    puddlePos.forEach(function (pp) {
      var m = new THREE.Mesh(
        new THREE.CircleGeometry(0.45 + Math.random() * 0.3, 22),
        new THREE.MeshStandardMaterial({ color: 0x1c2629, roughness: 0.08, transparent: true, opacity: 0.7, envMapIntensity: 1.5 })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(pp[0], 0.006, pp[1]);
      g.add(m);
    });

    /* 军旗（四角成框景） */
    g.add(banner(0x7a1f2a, 4.9, 5.6));    // 红旗（红方阵后）
    g.add(banner(0x7a1f2a, -4.9, 5.6));
    g.add(banner(0x2a3444, 4.9, -5.6));   // 黑旗（黑方阵后）
    g.add(banner(0x2a3444, -4.9, -5.6));

    scene.add(g);
    Board.group = g;
    Board.POS = pos;
  }

  /* ---------------- 可行走高亮 ---------------- */
  function clearHighlights() {
    Board.highlights.forEach(function (h) { Board.scene.remove(h); });
    Board.highlights = [];
  }

  /* list: [{col,row,capture}] */
  function showHighlights(list) {
    clearHighlights();
    list.forEach(function (t) {
      var p = pos(t.col, t.row);
      var color = t.capture ? 0xe8503a : 0x46d36b;
      var mat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.03, 0.68), mat);
      m.position.set(p.x, 0.02, p.z);
      m.userData.target = t;
      m.renderOrder = 2;
      Board.scene.add(m);
      Board.highlights.push(m);
    });
  }

  function updateHighlights(dt) {
    Board._highlightPhase += dt * 3.2;
    var pulse = 0.42 + Math.sin(Board._highlightPhase) * 0.14;
    Board.highlights.forEach(function (m) {
      m.material.opacity = pulse;
      var s = 1 + Math.sin(Board._highlightPhase) * 0.06;
      m.scale.set(s, 1, s);
    });
  }

  /* 选中格的小圆环标记 */
  function selectedRing() {
    var geo = new THREE.RingGeometry(0.34, 0.46, 32);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false
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
