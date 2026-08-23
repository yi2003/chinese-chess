/* ============================================================
 * 经典木质棋子：圆饼形木子，顶面刻环 + 楷体汉字
 *   红方 = 朱红字 · 黑方 = 墨黑字（传统双色素木棋子）
 *   同一块黄杨木色料，仅字色区分敌我 —— 老棋摊的标准样式
 * 返回 { group, anchors, height }（anchors 留空：经典样式无关节动画）
 * ============================================================ */
(function () {
  'use strict';

  var texCache = {};

  /* 兼容保留：旧代码可能引用 palette */
  function palette(side) {
    return side === 'red' ? {
      cloth: 0xb3342a, trim: 0xb3342a, accent: 0xb3342a,
      plume: 0xb3342a, dark: 0x6d1f16
    } : {
      cloth: 0x241c14, trim: 0x241c14, accent: 0x241c14,
      plume: 0x241c14, dark: 0x100c08
    };
  }

  /* 顶面贴图：木色底 + 双刻环 + 汉字 */
  function tokenTexture(type, side) {
    var key = type + '_' + side;
    if (texCache[key]) return texCache[key];
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var ctx = cv.getContext('2d');

    /* 黄杨木底色（径向渐变模拟受光） */
    var grd = ctx.createRadialGradient(112, 104, 30, 128, 128, 140);
    grd.addColorStop(0, '#ecd39e');
    grd.addColorStop(0.75, '#dfc28a');
    grd.addColorStop(1, '#c9a76b');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);

    /* 细木纹 */
    for (var i = 0; i < 26; i++) {
      var y0 = Math.random() * 256;
      ctx.strokeStyle = 'rgba(150,110,60,' + (0.05 + Math.random() * 0.06).toFixed(3) + ')';
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(85, y0 + (Math.random() - 0.5) * 14, 170, y0 + (Math.random() - 0.5) * 14, 256, y0);
      ctx.stroke();
    }

    var ink = side === 'red' ? '#b3342a' : '#26201a';

    /* 外刻环（粗）+ 内刻环（细）—— 传统棋子双线圈 */
    ctx.strokeStyle = ink;
    ctx.lineWidth = 11;
    ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(128, 128, 94, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;

    /* 楷体汉字 */
    ctx.font = 'bold 132px "KaiTi","STKaiti","BiauKai","Microsoft YaHei","SimHei",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* 轻微压痕阴影再叠主字 → 有“刻”的厚度感 */
    ctx.fillStyle = 'rgba(255,244,214,0.5)';
    ctx.fillText(Xiangqi.CHAR[side][type], 129, 141);
    ctx.fillStyle = ink;
    ctx.fillText(Xiangqi.CHAR[side][type], 127, 137);

    var t = new THREE.CanvasTexture(cv);
    texCache[key] = t;
    return t;
  }

  /* 侧面木纹色（比顶面略深） */
  function sideMaterial(side) {
    return new THREE.MeshStandardMaterial({
      color: side === 'red' ? 0xd9b476 : 0xd3ac6e,
      roughness: 0.62,
      metalness: 0
    });
  }

  /* 一枚圆饼木子 */
  function buildToken(type, side) {
    var g = new THREE.Group();

    var topMat = new THREE.MeshStandardMaterial({
      map: tokenTexture(type, side), roughness: 0.58, metalness: 0
    });
    var sideMat = sideMaterial(side);

    /* 底缘倒角：下宽上略收的传统木墩形 */
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.485, 0.07, 36),
      sideMat
    );
    base.position.y = 0.035;

    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.455, 0.15, 36),
      [sideMat, topMat, sideMat]   /* 侧 / 顶 / 底 */
    );
    body.position.y = 0.145;

    /* 顶部微凸边缘高光圈（几何倒角） */
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.435, 0.012, 10, 40),
      sideMat
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.22;

    [base, body, rim].forEach(function (m) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    });

    return g;
  }

  function buildFigure(type, side) {
    var g = new THREE.Group();
    g.add(buildToken(type, side));
    return { group: g, anchors: {}, height: 0.22 };
  }

  window.Figures = { buildFigure: buildFigure, palette: palette };
})();
