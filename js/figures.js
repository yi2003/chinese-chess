/* ============================================================
 * 拟人化棋子（唐代风格）：7 类造型 × 2 色
 *   帥/將 明光甲主帅佩剑令旗   仕/士 圆领袍幞头文官
 *   相/象 战象（顶盖驮轿持笏小吏）  馬 唐骑兵披挂战马持横刀
 *   車 唐式青铜战车持戈武士   砲/炮 抛石机投石臂石弹
 *   兵/卒 明光甲顿项盔重甲步兵
 * 配色取唐三彩调：绛红 / 石青、赭石、象牙、古金（叠加风化做旧）
 * 返回 { group, anchors, height }
 * ============================================================ */
(function () {
  'use strict';

  var texCache = {};
  var spriteCache = {};

  function palette(side) {
    return side === 'red' ? {
      cloth: 0x9e2940,   // 绛红
      armor: 0x7a1f30,
      trim: 0xd4a94f,    // 古金
      accent: 0xe4c068,
      plume: 0xc02030,   // 红缨
      dark: 0x4a1020,
      jade: 0x4f8a6a     // 玉
    } : {
      cloth: 0x36404f,   // 石青/墨蓝
      armor: 0x252d3a,
      trim: 0xa8994a,
      accent: 0xcbb45e,
      plume: 0xa8994a,
      dark: 0x0e1218,
      jade: 0x4f6a8a
    };
  }

  /* 风化/做旧噪点贴图 */
  var weath = {};
  function weatheredMap(color) {
    if (weath[color]) return weath[color];
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.fillRect(0, 0, 128, 128);
    var img = ctx.getImageData(0, 0, 128, 128);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() * 30) - 15; // 轻微做旧，保持材质本色
      d[i]   = Math.max(4, Math.min(255, d[i]   + n));
      d[i+1] = Math.max(4, Math.min(255, d[i+1] + n));
      d[i+2] = Math.max(4, Math.min(255, d[i+2] + n));
    }
    for (var b = 0; b < 10; b++) {
      var bx = (Math.random() * 128) | 0, by = (Math.random() * 128) | 0;
      var br = 6 + Math.random() * 20;
      for (var y = Math.max(0, by - br); y < Math.min(128, by + br); y++) {
        for (var x = Math.max(0, bx - br); x < Math.min(128, bx + br); x++) {
          var dx = x - bx, dy = y - by;
          if (dx * dx + dy * dy > br * br) continue;
          var idx = (y * 128 + x) * 4;
          d[idx] *= 0.9; d[idx+1] *= 0.92; d[idx+2] *= 0.94;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(cv);
    weath[color] = t;
    return t;
  }

  /* 材质工厂：PBR 物理材质（金属度/粗糙度），配合环境贴图呈现真实反光 */
  var M = (function () {
    var cache = {};
    return function (color, metal, rough) {
      var key = color + '|' + (metal || 0) + '|' + (rough || 0);
      if (!cache[key]) {
        cache[key] = new THREE.MeshStandardMaterial({
          color: color,
          map: weatheredMap(color),
          metalness: metal || 0,
          roughness: rough === undefined ? 0.85 : rough
        });
      }
      return cache[key];
    };
  })();
  var steel = function (c) { return M(c || 0xa6adb4, 0.85, 0.32); };   // 抛光钢
  var dsteel = function (c) { return M(c || 0x51575e, 0.8, 0.5); };
  var bronze = function (c) { return M(c || 0x7f5731, 0.9, 0.42); };
  var gold = function (c) { return M(c || 0xcfa34a, 1.0, 0.28); };
  var cloth = function (c) { return M(c, 0, 0.92); };
  var silk = function (c) { return M(c, 0, 0.55); };
  var skin = M(0xc9a082, 0, 0.72);
  var wood = function (c) { return M(c || 0x543821, 0, 0.86); };
  var ink = function (c) { return M(c || 0x1c1c24, 0, 0.8); };  // 幞头乌色

  /* 接受材质或颜色数字 */
  function toMat(x) {
    if (x && x.isMaterial) return x;
    return M(x, 0, 0.85);
  }

  /* 人脸：眼睛、眉毛、鼻、嘴，武将可加胡须 */
  function humanFace(parent, x, y, z, fz, opts) {
    opts = opts || {};
    var dark = M(0x241c14, 0, 0.55);
    var eL = sph(0.034, dark, x - 0.05, y + 0.02, z + fz * 0.15, parent);
    eL.scale.set(1, 0.65, 0.5);
    var eR = sph(0.034, dark, x + 0.05, y + 0.02, z + fz * 0.15, parent);
    eR.scale.set(1, 0.65, 0.5);
    box(0.052, 0.014, 0.02, dark, x - 0.05, y + 0.078, z + fz * 0.14, parent, fz * 0.15, 0, 0);
    box(0.052, 0.014, 0.02, dark, x + 0.05, y + 0.078, z + fz * 0.14, parent, -fz * 0.15, 0, 0);
    cone(0.016, 0.055, M(0xac8666, 0, 0.7), x, y - 0.045, z + fz * 0.18, parent);
    box(0.04, 0.013, 0.02, M(0x7a4030, 0, 0.6), x, y - 0.095, z + fz * 0.16, parent);
    if (opts.beard) {
      var bd = sph(0.06, M(0x2a2018, 0, 0.7), x, y - 0.1, z + fz * 0.13, parent);
      bd.scale.set(1, 0.85, 0.7);
    }
  }
  function box(w, h, d, mat, x, y, z, parent, rx, ry, rz) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toMat(mat));
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(rT, rB, h, mat, x, y, z, parent, rx, rz) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, 18), toMat(mat));
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function sph(r, mat, x, y, z, parent) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), toMat(mat));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function cone(r, h, mat, x, y, z, parent, rx) {
    var m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 18), toMat(mat));
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /* 底座汉字贴图 */
  function tokenTexture(type, side) {
    var key = type + '_' + side;
    if (texCache[key]) return texCache[key];
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var ctx = cv.getContext('2d');
    var grd = ctx.createRadialGradient(128, 128, 24, 128, 128, 130);
    grd.addColorStop(0, '#c2955a');
    grd.addColorStop(1, '#7a4c20');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = side === 'red' ? '#8a2233' : '#232c3a';
    ctx.lineWidth = 20;
    ctx.beginPath(); ctx.arc(128, 128, 102, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#c9a03e';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(128, 128, 94, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 148px "Microsoft YaHei","SimHei",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = side === 'red' ? '#5c0d18' : '#0a0f18';
    ctx.fillText(Xiangqi.CHAR[side][type], 128, 140);
    var t = new THREE.CanvasTexture(cv);
    texCache[key] = t;
    return t;
  }

  /* 底座 */
  function baseToken(side, type) {
    var g = new THREE.Group();
    var topMat = new THREE.MeshStandardMaterial({ map: tokenTexture(type, side), metalness: 0, roughness: 0.72 });
    var sideMat = M(side === 'red' ? 0x8a2233 : 0x232c3a, 0, 0.8);
    var token = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.54, 0.16, 28),
      [sideMat, topMat, sideMat]
    );
    token.position.y = 0.08;
    token.castShadow = true;
    token.receiveShadow = true;
    g.add(token);
    return g;
  }

  /* 浮空汉字标签 */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function labelSprite(type, side) {
    var key = type + '_' + side;
    if (spriteCache[key]) return spriteCache[key];
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(8,7,6,0.72)';
    roundRect(ctx, 12, 12, 104, 104, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(198,160,74,0.85)';
    ctx.lineWidth = 5;
    roundRect(ctx, 12, 12, 104, 104, 22);
    ctx.stroke();
    ctx.font = 'bold 70px "Microsoft YaHei","SimHei",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e3d0a2';
    ctx.fillText(Xiangqi.CHAR[side][type], 64, 72);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false
    }));
    sp.scale.set(0.85, 0.85, 1);
    spriteCache[key] = sp;
    return sp;
  }

  /* ---------------- 唐式组件 ---------------- */
  /* 幞头（黑色软脚幞头） */
  function futou(parent, y, fz) {
    var bl = ink();
    var cap = sph(0.13, bl, 0, y, 0, parent);
    cap.scale.y = 0.8;
    sph(0.06, bl, 0, y + 0.1, 0, parent); // 顶髻
    box(0.02, 0.02, 0.26, bl, -0.07, y - 0.02, -fz * 0.12, parent, 0, 0, 0.2); // 展脚
    box(0.02, 0.02, 0.26, bl, 0.07, y - 0.02, -fz * 0.12, parent, 0, 0, -0.2);
  }

  /* 顿项盔（唐盔 + 护颈 + 红缨） */
  function tangHelmet(parent, y, plume) {
    var st = steel(), ds = dsteel();
    sph(0.15, skin, 0, y - 0.08, 0, parent); // 面
    var dome = sph(0.17, st, 0, y, 0, parent);
    dome.scale.y = 0.82;
    cyl(0.2, 0.24, 0.08, ds, 0, y - 0.14, 0, parent); // 顿项（护颈，在面部下方）
    cone(0.04, 0.18, st, 0, y + 0.13, 0, parent); // 盔顶缨管
    cone(0.05, 0.3, plume, 0, y + 0.18, 0, parent, -0.3); // 缨
    box(0.04, 0.05, 0.15, st, 0, y, -0.13, parent); // 护鼻
  }

  /* 圆领袍 */
  function roundRobe(parent, y, color, rTop, rBot, h, trim) {
    var body = cyl(rTop, rBot, h, cloth(color), 0, y, 0, parent);
    cyl(rTop + 0.02, rTop + 0.02, 0.07, gold(trim || 0xc9a03e), 0, y + h / 2 - 0.03, 0, parent); // 圆领
    return body;
  }

  /* 明光甲（胸口两片抛光镜甲 + 甲裙） */
  function mingguang(parent, y) {
    var st = steel(), ds = dsteel();
    var pl = sph(0.09, st, -0.09, y + 0.08, 0.06, parent); pl.scale.set(1, 1.2, 0.5);
    var pr = sph(0.09, st, 0.09, y + 0.08, 0.06, parent); pr.scale.set(1, 1.2, 0.5);
    cyl(0.19, 0.31, 0.26, ds, 0, y - 0.15, 0, parent); // 甲裙
    return pl;
  }

  /* ---------------- 兵/卒：明光甲顿项盔重甲步兵 ---------------- */
  function buildSoldier(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var st = steel(), ds = dsteel();
    // 腿甲 + 靴
    cyl(0.085, 0.1, 0.28, ds, -0.1, 0.3, 0, g);
    cyl(0.085, 0.1, 0.28, ds, 0.1, 0.3, 0, g);
    box(0.11, 0.09, 0.24, wood(0x33220f), -0.1, 0.13, 0, g);
    box(0.11, 0.09, 0.24, wood(0x33220f), 0.1, 0.13, 0, g);
    // 披膊（肩甲）
    sph(0.14, ds, -0.2, 0.82, 0, g);
    sph(0.14, ds, 0.2, 0.82, 0, g);
    // 上身 + 明光甲
    cyl(0.19, 0.17, 0.3, ds, 0, 0.68, 0, g);
    mingguang(g, 0.68);
    cyl(0.2, 0.2, 0.05, p.trim, 0, 0.6, 0, g); // 腰带
    // 护臂
    cyl(0.05, 0.06, 0.24, ds, -0.3, 0.72, 0, g);
    cyl(0.05, 0.06, 0.24, ds, 0.3, 0.72, 0, g);
    // 顿项盔
    tangHelmet(g, 1.04, p.plume);
    humanFace(g, 0, 0.96, 0, fz, {});
    // 方盾
    var shield = new THREE.Group();
    shield.position.set(-0.42, 0.74, fz * 0.04);
    box(0.07, 0.52, 0.38, p.cloth, 0, 0, 0, shield);
    box(0.09, 0.44, 0.18, ds, -fz * 0.05, 0, 0, shield);
    box(0.1, 0.1, 0.1, p.trim, 0, 0.22, 0, shield); // 盾徽
    shield.rotation.y = fz * 0.35;
    shield.rotation.z = -0.18;
    g.add(shield);
    // 唐横刀（武器）
    var weapon = new THREE.Group();
    weapon.position.set(fz * 0.42, 0.86, fz * 0.35);
    weapon.rotation.x = fz * 0.4;
    cyl(0.025, 0.025, 0.18, wood(0x4a2c14), 0, -0.06, 0, weapon); // 柄
    box(0.05, 0.06, 0.14, p.trim, 0, 0.02, 0, weapon); // 护手
    box(0.07, 0.14, 0.85, M(0xc9cdd2, 0, 0.85), 0, 0.06, 0, weapon); // 横刀身
    cone(0.035, 0.16, M(0xc9cdd2, 0, 0.85), 0, 0.02, 0.43, weapon); // 刀尖
    g.add(weapon);
    A.body = null; A.weapon = weapon; A.head = null;
    return { anchors: A, height: 1.32 };
  }

  /* ---------------- 仕/士：圆领袍幞头文官 ---------------- */
  function buildAdvisor(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var cl = silk(p.cloth);
    var robe = roundRobe(g, 0.54, p.cloth, 0.17, 0.34, 0.62, p.trim);
    // 宽袖
    var sl = new THREE.Group(); sl.position.set(-0.24, 0.68, 0); sl.rotation.z = 0.32;
    box(0.32, 0.1, 0.26, cl, -0.11, 0, 0, sl); g.add(sl);
    var sr = new THREE.Group(); sr.position.set(0.24, 0.68, 0); sr.rotation.z = -0.32;
    box(0.32, 0.1, 0.26, cl, 0.11, 0, 0, sr); g.add(sr);
    cyl(0.2, 0.21, 0.06, gold(), 0, 0.48, 0, g); // 腰带
    box(0.05, 0.22, 0.03, M(p.jade, 0, 0.6), 0, 0.6, fz * 0.15, g); // 玉佩
    // 头 + 幞头
    sph(0.15, skin, 0, 0.98, 0, g);
    humanFace(g, 0, 0.98, 0, fz, {});
    futou(g, 1.0, fz);
    // 笏（武器）
    var weapon = new THREE.Group();
    weapon.position.set(fz * 0.3, 0.74, 0);
    box(0.12, 0.5, 0.04, M(0xd8cdab, 0, 0.85), 0, 0, 0, weapon);
    g.add(weapon);
    A.body = robe; A.weapon = weapon; A.head = null;
    return { anchors: A, height: 1.35 };
  }

  /* ---------------- 相/象：战象（顶盖驮轿） ---------------- */
  function buildElephant(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var hide = M(0x7d7062, 0, 0.85);
    var hide2 = M(0x8b7e6f, 0, 0.85);
    var ivory = M(0xd8cfae, 0, 0.85);
    var st = steel();
    [[-0.22, -0.28], [0.22, -0.28], [-0.22, 0.28], [0.22, 0.28]].forEach(function (o) {
      cyl(0.12, 0.15, 0.52, hide, o[0], 0.26, o[1], g);
      box(0.16, 0.07, 0.24, hide2, o[0], 0.05, o[1], g);
    });
    var body = sph(0.52, hide, 0, 0.64, fz * 0.06, g);
    body.scale.set(0.95, 0.82, 1.5);
    var head = sph(0.3, hide, 0, 0.84, fz * 0.74, g);
    head.scale.set(1, 0.9, 1.05);
    var eL = sph(0.2, hide2, -0.3, 0.88, fz * 0.55, g); eL.scale.set(0.26, 0.55, 0.12);
    var eR = sph(0.2, hide2, 0.3, 0.88, fz * 0.55, g); eR.scale.set(0.26, 0.55, 0.12);
    var trunk = new THREE.Group();
    trunk.position.set(0, 0.72, fz * 0.98);
    for (var i = 0; i < 5; i++) {
      var seg = new THREE.Mesh(new THREE.CylinderGeometry(0.1 - i * 0.013, 0.1 - (i + 1) * 0.013, 0.18, 10), hide);
      seg.position.y = -0.09 - i * 0.15;
      seg.rotation.x = fz * (0.12 + i * 0.33);
      trunk.add(seg);
    }
    g.add(trunk);
    cone(0.05, 0.34, ivory, -0.12, 0.66, fz * 1.05, g, fz * 1.5);
    cone(0.05, 0.34, ivory, 0.12, 0.66, fz * 1.05, g, fz * 1.5);
    cyl(0.022, 0.015, 0.32, hide, 0, 0.6, fz * -0.82, g, fz * 0.55);
    // 唐式战鞍（披布 + 金穗）
    box(0.62, 0.08, 0.9, p.cloth, 0, 0.9, 0, g);
    box(0.66, 0.05, 0.94, p.trim, 0, 0.95, 0, g);
    cone(0.02, 0.09, p.plume, 0.2, 0.86, 0, g);
    cone(0.02, 0.09, p.plume, -0.2, 0.86, 0, g);
    // 头甲 + 缨
    var plate = sph(0.33, st, 0, 0.98, fz * 0.72, g);
    plate.scale.set(1, 0.72, 1);
    cone(0.09, 0.44, p.plume, 0, 1.12, fz * 0.72, g, -fz * 0.15);
    // 驮轿（顶盖） + 持笏小吏
    var howdah = new THREE.Group();
    howdah.position.set(0, 1.02, 0);
    box(0.42, 0.3, 0.46, wood(0x6b4424), 0, 0, 0, howdah);
    box(0.44, 0.06, 0.48, p.trim, 0, 0.18, 0, howdah);
    cyl(0.08, 0.1, 0.26, p.cloth, 0, 0.36, 0, howdah);
    sph(0.085, skin, 0, 0.56, 0, howdah);
    humanFace(howdah, 0, 0.56, 0, fz, {});
    futou(howdah, 0.58, fz); // 小吏幞头
    cone(0.27, 0.12, silk(0x8a2233), 0, 0.72, 0, howdah); // 顶盖
    cone(0.06, 0.14, gold(), 0, 0.78, 0, howdah); // 顶珠
    var scepter = box(0.035, 0.24, 0.035, M(0xd8cdab, 0, 0.85), fz * 0.1, 0.44, 0, howdah);
    g.add(howdah);
    A.body = body; A.weapon = scepter; A.head = head;
    return { anchors: A, height: 1.62 };
  }

  /* ---------------- 馬：唐骑兵（披挂战马 + 明光甲骑手） ---------------- */
  function buildHorse(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var coat = M(side === 'red' ? 0x6e2a22 : 0x232c3a, 0, 0.8);
    var hoof = M(0x2c1f13, 0, 0.85);
    var st = steel();
    var legs = [];
    [[-0.11, -0.22], [0.11, -0.22], [-0.11, 0.22], [0.11, 0.22]].forEach(function (o) {
      var leg = new THREE.Group();
      leg.position.set(o[0], 0.46, o[1]);
      cyl(0.07, 0.08, 0.36, coat, 0, -0.15, 0, leg);
      box(0.1, 0.08, 0.13, hoof, 0, -0.33, 0, leg);
      g.add(leg);
      legs.push({ group: leg, dx: o[0], dz: o[1] });
    });
    var body = sph(0.35, coat, 0, 0.64, 0, g);
    body.scale.set(0.95, 0.9, 1.5);
    // 胸带 + 披挂
    box(0.42, 0.07, 0.22, p.trim, 0, 0.54, 0, g);
    box(0.3, 0.1, 0.52, p.cloth, 0, 0.8, 0, g);
    cone(0.02, 0.09, p.plume, 0.12, 0.72, 0, g); // 金穗
    cone(0.02, 0.09, p.plume, -0.12, 0.72, 0, g);
    var neck = sph(0.17, coat, 0, 0.94, fz * 0.42, g);
    neck.scale.set(0.9, 1.2, 1.15);
    var head = box(0.14, 0.15, 0.4, coat, 0, 1.02, fz * 0.68, g, fz * 0.12);
    box(0.1, 0.08, 0.14, coat, 0, 0.95, fz * 0.9, g, fz * 0.3);
    cone(0.045, 0.15, coat, fz * 0.05, 1.17, fz * 0.6, g);
    cone(0.045, 0.15, coat, -fz * 0.05, 1.17, fz * 0.6, g);
    box(0.06, 0.28, 0.32, M(0x1c1711, 0, 0.85), 0, 0.98, fz * 0.4, g, fz * 0.5); // 鬃
    cyl(0.035, 0.02, 0.32, M(0x1c1711, 0, 0.85), 0, 0.68, fz * -0.5, g, -fz * 0.4); // 尾
    // 骑手（明光甲 + 顿项盔）
    var rider = new THREE.Group();
    rider.position.set(0, 0.84, 0);
    g.add(rider);
    cyl(0.13, 0.16, 0.3, p.cloth, 0, 0.1, 0, rider);
    sph(0.17, st, 0, 0.34, 0, rider); // 肩甲
    sph(0.1, st, -0.07, 0.3, 0.06, rider); // 胸甲镜片
    sph(0.1, st, 0.07, 0.3, 0.06, rider);
    tangHelmet(rider, 0.42, p.plume);
    humanFace(rider, 0, 0.34, 0, fz, { beard: true });
    // 横刀（武器）
    var weapon = new THREE.Group();
    weapon.position.set(fz * 0.24, 0.42, 0);
    cyl(0.035, 0.035, 0.3, p.cloth, 0, 0.04, 0, weapon, fz * Math.PI / 2); // 手臂
    cyl(0.028, 0.028, 0.18, wood(0x4a2c14), 0, -0.08, 0, weapon); // 柄
    box(0.03, 0.06, 0.16, p.trim, 0, -0.04, 0, weapon); // 护手
    box(0.14, 0.16, 0.72, M(0xc9cdd2, 0, 0.85), 0, 0.04, fz * 0.36, weapon, fz * -0.28, 0, 0); // 刀身
    cone(0.06, 0.2, M(0xc9cdd2, 0, 0.85), 0, 0.04, fz * 0.72, weapon, fz * -0.28); // 刀尖
    rider.add(weapon);
    A.body = body; A.weapon = weapon; A.legs = legs; A.rider = rider; A.head = head;
    return { anchors: A, height: 1.38 };
  }

  /* ---------------- 車：唐式战车 ---------------- */
  function buildChariot(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var br = bronze(), st = steel();
    box(0.6, 0.14, 1.0, wood(0x6b4424), 0, 0.3, 0, g);
    function wheel(x) {
      var wg = new THREE.Group();
      wg.position.set(x, 0.3, 0);
      cyl(0.26, 0.26, 0.08, br, 0, 0, 0, wg, 0, Math.PI / 2);
      for (var i = 0; i < 6; i++) {
        var ang = i * Math.PI / 3;
        box(0.04, 0.42, 0.04, wood(0x4a3018), 0, Math.sin(ang) * 0.17, Math.cos(ang) * 0.17, wg, ang, 0, 0);
      }
      g.add(wg);
    }
    wheel(-0.32); wheel(0.32);
    cyl(0.06, 0.06, 0.74, wood(0x3a2a1a), 0, 0.3, 0, g);
    box(0.6, 0.28, 0.08, br, 0, 0.52, fz * 0.44, g);
    box(0.6, 0.28, 0.08, br, 0, 0.52, fz * -0.44, g);
    box(0.07, 0.28, 0.76, br, -0.27, 0.52, 0, g);
    box(0.07, 0.28, 0.76, br, 0.27, 0.52, 0, g);
    // 甲士
    cyl(0.13, 0.17, 0.4, p.cloth, 0, 0.74, fz * -0.06, g);
    sph(0.15, st, 0, 1.0, fz * -0.06, g);
    sph(0.1, st, -0.06, 0.98, fz * -0.02, g);
    sph(0.1, st, 0.06, 0.98, fz * -0.02, g);
    tangHelmet(g, 1.1, p.plume);
    humanFace(g, 0, 1.02, fz * -0.06, fz, { beard: true });
    var weapon = new THREE.Group();
    weapon.position.set(fz * 0.3, 1.06, fz * -0.06);
    weapon.rotation.x = fz * 0.3;
    cyl(0.022, 0.022, 1.42, wood(0x7a4a26), 0, 0, 0, weapon);
    var blade = box(0.42, 0.12, 0.03, st, 0, 0.62, 0.06, weapon, 0, 0, fz * 0.4);
    g.add(weapon);
    A.body = null; A.weapon = weapon; A.head = null;
    return { anchors: A, height: 1.42 };
  }

  /* ---------------- 砲/炮：抛石机 ---------------- */
  function buildCatapult(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var wd = wood(), iron = M(0x4a4f55, 0, 0.85);
    // 底座 + 轮
    box(0.7, 0.14, 0.92, wd, 0, 0.18, 0, g);
    cyl(0.15, 0.15, 0.08, iron, -0.34, 0.18, 0, g, 0, Math.PI / 2);
    cyl(0.15, 0.15, 0.08, iron, 0.34, 0.18, 0, g, 0, Math.PI / 2);
    // 两侧 A 形支架
    box(0.08, 0.52, 0.08, wd, -0.18, 0.46, 0, g, 0, 0, 0.38);
    box(0.08, 0.52, 0.08, wd, 0.18, 0.46, 0, g, 0, 0, -0.38);
    box(0.5, 0.07, 0.08, wd, 0, 0.68, 0, g); // 顶横梁
    // 投石臂（可摆动）
    var arm = new THREE.Group();
    arm.position.set(0, 0.68, 0);
    box(0.05, 0.05, 1.35, wd, 0, 0, fz * 0.2, arm);
    sph(0.09, iron, 0, 0.02, fz * 0.88, arm); // 前勺装石
    box(0.12, 0.12, 0.18, iron, 0, 0.02, fz * -0.55, arm); // 后配重
    g.add(arm);
    // 石弹堆
    sph(0.11, iron, -0.28, 0.22, fz * 0.3, g);
    sph(0.11, iron, -0.12, 0.28, fz * 0.34, g);
    // 操作手
    cyl(0.08, 0.1, 0.3, p.cloth, 0, 0.42, fz * -0.44, g);
    sph(0.085, skin, 0, 0.62, fz * -0.44, g);
    humanFace(g, 0, 0.62, fz * -0.44, fz, {});
    cone(0.1, 0.14, iron, 0, 0.68, fz * -0.44, g);
    A.body = null; A.weapon = arm; A.head = null;
    return { anchors: A, height: 1.05 };
  }

  /* ---------------- 帥/將：明光甲主帅 ---------------- */
  function buildGeneral(g, side) {
    var p = palette(side), fz = side === 'red' ? -1 : 1, A = {};
    var st = steel(), gd = gold();
    var cl = silk(p.cloth);
    box(0.8, 0.1, 0.8, wood(0x7a5230), 0, 0.07, 0, g);
    box(0.6, 0.08, 0.6, gd, 0, 0.15, 0, g);
    // 大氅（披风）
    var cape = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.52, 0.72, 18, 1, true), cl);
    cape.position.set(0, 0.56, fz * -0.12);
    g.add(cape);
    // 圆领袍 + 明光甲
    cyl(0.2, 0.26, 0.46, cl, 0, 0.64, 0, g);
    box(0.34, 0.34, 0.13, st, 0, 0.7, fz * 0.06, g); // 胸甲板
    sph(0.1, st, -0.09, 0.76, fz * 0.1, g); sph(0.1, st, 0.09, 0.76, fz * 0.1, g); // 明光镜
    box(0.36, 0.05, 0.15, gd, 0, 0.62, fz * 0.08, g); // 腰带
    sph(0.18, gd, -0.23, 0.86, 0, g); // 金肩甲
    sph(0.18, gd, 0.23, 0.86, 0, g);
    // 头 + 盔
    sph(0.16, skin, 0, 1.08, 0, g);
    humanFace(g, 0, 1.08, 0, fz, { beard: true });
    var dome = sph(0.2, st, 0, 1.17, 0, g); dome.scale.y = 0.85;
    cyl(0.23, 0.26, 0.07, gd, 0, 1.12, 0, g); // 顿项
    cone(0.05, 0.5, p.plume, 0, 1.42, 0, g, -0.4); // 长缨
    // 令旗（后背）
    var flag = new THREE.Group();
    flag.position.set(0, 1.05, fz * -0.34);
    cyl(0.022, 0.022, 1.25, wood(0x7a4a26), 0, 0.3, 0, flag);
    box(0.03, 0.52, 0.32, p.plume, 0, 0.62, 0, flag);
    box(0.035, 0.52, 0.34, gd, 0, 0.62, 0, flag);
    g.add(flag);
    // 剑（横刀）
    var weapon = new THREE.Group();
    weapon.position.set(fz * 0.3, 0.88, 0);
    cyl(0.03, 0.03, 0.2, wood(0x3a2a1a), 0, -0.17, 0, weapon);
    box(0.08, 0.07, 0.2, gd, 0, -0.05, 0, weapon);
    box(0.05, 0.68, 0.02, M(0xc9cdd2, 0, 0.85), 0, 0.33, 0, weapon);
    g.add(weapon);
    A.body = null; A.weapon = weapon; A.head = dome;
    return { anchors: A, height: 1.62 };
  }

  var BUILDERS = {
    S: buildSoldier, A: buildAdvisor, E: buildElephant,
    H: buildHorse, R: buildChariot, C: buildCatapult, G: buildGeneral
  };

  var FIGURE_SCALE = 0.7; // 棋子整体缩放：交点间距为 1，缩放后棋子间留出明显间隙
  function buildFigure(type, side) {
    var g = new THREE.Group();
    var body = new THREE.Group();
    body.add(baseToken(side, type));
    var res = BUILDERS[type](body, side);
    body.scale.setScalar(FIGURE_SCALE);
    g.add(body);
    var label = labelSprite(type, side);
    label.position.y = res.height * FIGURE_SCALE + 0.42;
    label.scale.setScalar(0.8);
    g.add(label);
    return { group: g, anchors: res.anchors, height: res.height * FIGURE_SCALE };
  }

  window.Figures = { buildFigure: buildFigure, palette: palette };
})();
