/* ============================================================
 * 3D 棋盘：木板、网格线、楚河汉界、九宫斜线、可行走高亮
 * 坐标：col 0..8 → x = (col-4)；row 0..9 → z = (row-4.5)；棋盘表面 y=0
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

  /* 画布文字贴图（楚河/漢界） */
  function riverTexture(text) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 512, 256);
    ctx.font = 'bold 170px "Microsoft YaHei","SimHei",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(212,188,148,0.88)';
    ctx.strokeStyle = 'rgba(70,44,20,0.6)';
    ctx.lineWidth = 8;
    ctx.strokeText(text, 256, 136);
    ctx.fillText(text, 256, 136);
    return new THREE.CanvasTexture(cv);
  }

  /* 唐代金饰边框纹样（回纹 + 菱格） */
  function tangBorder() {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#3f2814';
    ctx.fillRect(0, 0, 512, 64);
    ctx.strokeStyle = '#c9a03e';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 500, 52);
    for (var x = 20; x < 512; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x + 10, 26);
      ctx.lineTo(x, 40);
      ctx.lineTo(x - 10, 26);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 26, 26, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    return new THREE.CanvasTexture(cv);
  }

  /* 陈年木纹贴图 */
  function woodGrain() {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#7e5932';
    ctx.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 64; i++) {
      var y = Math.random() * 256;
      var h = 1 + Math.random() * 3;
      ctx.fillStyle = 'rgba(28,16,5,' + (0.06 + Math.random() * 0.17) + ')';
      ctx.fillRect(0, y, 256, h);
    }
    var img = ctx.getImageData(0, 0, 256, 256);
    var d = img.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 24;
      d[p] += n; d[p + 1] += n; d[p + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(cv);
  }

  function riverTextMesh(text, x, z) {
    var mat = new THREE.MeshBasicMaterial({
      map: riverTexture(text),
      transparent: true,
      depthWrite: false
    });
    var m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.035, z);
    return m;
  }

  function buildBoard(scene) {
    var g = new THREE.Group();

    /* 木板（深色陈年木） */
    var slab = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.75, 10.6), M(0x5d4024));
    slab.position.y = -0.375;
    slab.receiveShadow = true;
    g.add(slab);

    /* 面板（陈年木纹） */
    var face = new THREE.Mesh(
      new THREE.BoxGeometry(9.1, 0.02, 10.1),
      new THREE.MeshStandardMaterial({ map: woodGrain(), metalness: 0, roughness: 0.85 })
    );
    face.position.y = 0.01;
    face.receiveShadow = true;
    g.add(face);

    /* 边框（凸起的唐式金饰木框） */
    var frameH = 0.1, frameW = 0.12;
    var halfX = 4.82, halfZ = 5.32;
    var frameMat = new THREE.MeshStandardMaterial({ map: tangBorder(), metalness: 0.25, roughness: 0.7 });
    function frameBox(w, h, d, x, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      m.position.set(x, 0.05, z);
      m.receiveShadow = true;
      g.add(m);
    }
    frameBox(9.64, frameH, frameW, 0, -halfZ);
    frameBox(9.64, frameH, frameW, 0, halfZ);
    frameBox(frameW, frameH, 10.64, -halfX, 0);
    frameBox(frameW, frameH, 10.64, halfX, 0);

    /* 网格线（深色，微微浮于表面）；棋子落在交点 (col,row) 上 */
    var lineH = 0.045, lineW = 0.04;
    // 横线：10 条，每条正经过 row 0..9 的棋子交点行（z = row-4.5）
    for (var r = 0; r < 10; r++) {
      box(8.0, lineH, lineW, 0x33200e, 0, 0.03, r - 4.5, g);
    }
    // 竖线：9 列，楚河（row4 与 row5 之间）处断开成上下两段
    for (var c = 0; c < 9; c++) {
      var x = c - 4;
      box(lineW, lineH, 4.0, 0x33200e, x, 0.03, -2.5, g); // 上段 z:-4.5..-0.5
      box(lineW, lineH, 4.0, 0x33200e, x, 0.03, 2.5, g);  // 下段 z:0.5..4.5
    }

    /* 九宫斜线：连接宫角两交点。Box 长度沿 X，绕 Y 旋转 -atan2(dz,dx) 使其两端恰落 p1/p2 */
    function diagonal(p1, p2) {
      var dx = p2.x - p1.x, dz = p2.z - p1.z;
      var len = Math.sqrt(dx * dx + dz * dz);
      var ang = -Math.atan2(dz, dx);
      var m = new THREE.Mesh(new THREE.BoxGeometry(len, lineH, lineW), M(0x33200e));
      m.position.set((p1.x + p2.x) / 2, 0.03, (p1.z + p2.z) / 2);
      m.rotation.y = ang;
      g.add(m);
    }
    diagonal(pos(3, 7), pos(5, 9));
    diagonal(pos(5, 7), pos(3, 9));
    diagonal(pos(3, 0), pos(5, 2));
    diagonal(pos(5, 0), pos(3, 2));

    /* 楚河 漢界 */
    g.add(riverTextMesh('楚　河', -2.6, 0));
    g.add(riverTextMesh('漢　界', 2.6, 0));

    /* 四个角位标记点 */
    [[0, 0], [8, 0], [0, 9], [8, 9]].forEach(function (c) {
      var p = pos(c[0], c[1]);
      box(0.22, 0.05, 0.22, 0x4a2e16, p.x, 0.02, p.z, g);
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
