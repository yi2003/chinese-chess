/* ============================================================
 * 动画系统：行棋（马=骑兵奔跑 / 其余跳跃）、吃子挥砍、
 * 被吃倒地淡出、尘土/刀光/受击特效
 * 所有动画返回 Promise，主流程 await 串行播放。
 * ============================================================ */
(function () {
  'use strict';

  var Anim = {
    scene: null,
    effects: []
  };

  function easeIn(t) { return t * t * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function tween(dur, fn) {
    return new Promise(function (res) {
      var t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        fn(p, p);
        if (p < 1) requestAnimationFrame(step);
        else res();
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------------- 特效 ---------------- */
  function spawnEffect(eff) { Anim.effects.push(eff); }
  function updateEffects(dt) {
    for (var i = Anim.effects.length - 1; i >= 0; i--) {
      var e = Anim.effects[i];
      e.update(dt);
      if (e.dead) {
        Anim.effects.splice(i, 1);
        if (e.dispose) e.dispose();
      }
    }
  }

  function addDust(pos, n) {
    n = n || 8;
    for (var i = 0; i < n; i++) {
      var mat = new THREE.MeshBasicMaterial({
        color: 0x7b8087, transparent: true, opacity: 0.75, depthWrite: false
      });
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 6, 5), mat);
      m.position.set(
        pos.x + (Math.random() - 0.5) * 0.5,
        0.08 + Math.random() * 0.05,
        pos.z + (Math.random() - 0.5) * 0.5
      );
      var vx = (Math.random() - 0.5) * 0.9, vy = Math.random() * 1.0 + 0.3, vz = (Math.random() - 0.5) * 0.9;
      var life = 0.55 + Math.random() * 0.2, t = 0;
      Anim.scene.add(m);
      spawnEffect({
        update: function (dt) {
          t += dt;
          m.position.x += vx * dt; m.position.y += vy * dt; m.position.z += vz * dt;
          m.material.opacity = 0.75 * (1 - t / life);
          var s = 1 + dt * 1.8; m.scale.multiplyScalar(s);
          if (t >= life) this.dead = true;
        },
        dispose: function () { Anim.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      });
    }
  }

  /* 刀光：竖直的月牙弧 */
  function addSlash(pos, rotY) {
    var shape = new THREE.Shape();
    shape.absarc(0, 0, 0.85, -0.65, 0.65, false);
    shape.absarc(0, 0, 0.5, 0.65, -0.65, true);
    var geo = new THREE.ShapeGeometry(shape);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xfff7d8, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, 0.55, pos.z);
    m.rotation.y = rotY;
    m.scale.set(0.45, 0.45, 1);
    Anim.scene.add(m);
    var t = 0, dur = 0.4;
    spawnEffect({
      update: function (dt) {
        t += dt;
        var e = Math.min(1, t / dur);
        var s = 0.45 + e * 1.55;
        m.scale.set(s, s, 1);
        m.material.opacity = 0.95 * (1 - e);
        if (t >= dur) this.dead = true;
      },
      dispose: function () { Anim.scene.remove(m); geo.dispose(); mat.dispose(); }
    });
  }

  /* 受击闪光（扩散红环 + 红球 + 地面冲击环） */
  function addHit(pos) {
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.42, 26),
      new THREE.MeshBasicMaterial({
        color: 0xff5a3a, transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.06, pos.z);
    Anim.scene.add(ring);
    var shock = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.22, 32),
      new THREE.MeshBasicMaterial({
        color: 0xcfd8e6, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    shock.rotation.x = -Math.PI / 2;
    shock.position.set(pos.x, 0.03, pos.z);
    Anim.scene.add(shock);
    var ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 12, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff6a45, transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    ball.position.set(pos.x, 0.75, pos.z);
    Anim.scene.add(ball);
    var t = 0, dur = 0.42;
    spawnEffect({
      update: function (dt) {
        t += dt;
        var e = Math.min(1, t / dur);
        ring.scale.set(1 + e * 2.4, 1 + e * 2.4, 1);
        ring.material.opacity = 0.95 * (1 - e);
        shock.scale.set(1 + e * 5.5, 1 + e * 5.5, 1);
        shock.material.opacity = 0.5 * (1 - e);
        ball.scale.multiplyScalar(1 + dt * 2.5);
        ball.material.opacity = 0.85 * (1 - e);
        if (t >= dur) this.dead = true;
      },
      dispose: function () {
        Anim.scene.remove(ring); Anim.scene.remove(ball); Anim.scene.remove(shock);
        ring.geometry.dispose(); ring.material.dispose();
        ball.geometry.dispose(); ball.material.dispose();
        shock.geometry.dispose(); shock.material.dispose();
      }
    });
  }

  /* 落地水花：水珠上抛后重力回落 */
  function addSplash(pos) {
    if (window.Audio) Audio.splash();
    var n = 6 + Math.floor(Math.random() * 5);
    for (var i = 0; i < n; i++) {
      var mat = new THREE.MeshBasicMaterial({
        color: 0x7a8791, transparent: true, opacity: 0.8, depthWrite: false
      });
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.03, 6, 5), mat);
      m.position.set(
        pos.x + (Math.random() - 0.5) * 0.5,
        0.05 + Math.random() * 0.05,
        pos.z + (Math.random() - 0.5) * 0.5
      );
      var vx = (Math.random() - 0.5) * 1.2, vy = 0.9 + Math.random() * 0.7, vz = (Math.random() - 0.5) * 1.2;
      var life = 0.5, t = 0;
      Anim.scene.add(m);
      spawnEffect({
        update: function (dt) {
          t += dt;
          vy -= 3.5 * dt;
          m.position.x += vx * dt;
          m.position.y += vy * dt;
          m.position.z += vz * dt;
          if (m.position.y < 0) { m.position.y = 0; vy *= -0.35; }
          m.material.opacity = 0.8 * (1 - t / life);
          if (t >= life) this.dead = true;
        },
        dispose: function () { Anim.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      });
    }
  }

  /* ---------------- 行棋 / 冲锋 ---------------- */
  function move(piece, from, to, isCapture) {
    var type = piece.type;
    var isHorse = type === 'H';
    var fz = piece.side === 'red' ? -1 : 1;
    var dur = isHorse ? (isCapture ? 0.6 : 0.9) : (isCapture ? 0.42 : 0.5);
    var start = Board.pos(from.col, from.row);
    var end = Board.pos(to.col, to.row);
    var grp = piece.group;
    var anchors = piece.anchors;
    grp.rotation.set(0, 0, 0);
    Audio.move(type);

    if (type === 'C') {
      // 抛石机不冲锋：原地投石，由 attack 抛飞石砸远目标，最后 doMove 落位
      return Promise.resolve();
    }

    if (isHorse) {
      setTimeout(function () { Audio.hoof(); }, 70);
      setTimeout(function () { Audio.hoof(); }, 230);
      setTimeout(function () { Audio.hoof(); }, isCapture ? 410 : 540);
    }

    /* 冲锋起手：举武器待发 */
    if (isCapture && anchors.weapon) {
      if (type === 'H') {
        anchors.weapon.rotation.set(fz * 0.2, 0.4, -1.0);   // 大刀高举
      } else if (type === 'S') {
        anchors.weapon.position.z = fz * 0.35 + fz * 0.34;  // 挺刀
      } else if (type === 'R') {
        anchors.weapon.rotation.x = fz * -0.4;              // 举戈
      } else if (type === 'G') {
        anchors.weapon.rotation.x = -fz * 1.2;              // 举剑
      }
    }

    return tween(dur, function (p) {
      var x = start.x + (end.x - start.x) * p;
      var z = start.z + (end.z - start.z) * p;
      var y = 0;
      if (isHorse) {
        y = Math.abs(Math.sin(p * Math.PI * 6)) * (isCapture ? 0.24 : 0.18);
        var swing = Math.sin(p * Math.PI * 6) * (isCapture ? 1.0 : 0.7);
        if (anchors.legs) {
          anchors.legs[0].group.rotation.z = swing * 0.7;
          anchors.legs[1].group.rotation.z = -swing * 0.7;
          anchors.legs[2].group.rotation.z = -swing * 0.7;
          anchors.legs[3].group.rotation.z = swing * 0.7;
        }
        grp.rotation.z = Math.sin(p * Math.PI * 3) * 0.06;
        grp.rotation.x = isCapture ? 0.13 : 0.07; // 冲锋前倾
      } else {
        y = Math.sin(p * Math.PI) * (isCapture ? 0.2 : 0.15);
      }
      grp.position.set(x, y, z);
    }).then(function () {
      grp.position.copy(end);
      grp.position.y = 0;
      grp.rotation.set(0, 0, 0);
      if (isHorse && anchors.legs) {
        anchors.legs.forEach(function (l) { l.group.rotation.z = 0; });
        addDust(end, isCapture ? 14 : 6);
        Audio.hoof();
        Audio.land();
      } else {
        addDust(end, isCapture ? 10 : 4);
        Audio.land();
      }
    });
  }

  /* ---------------- 吃子挥砍 ---------------- */
  function weaponSwing(w, keys, dur) {
    var s = { x: w.rotation.x, y: w.rotation.y, z: w.rotation.z };
    return tween(dur, function (p) {
      var e = easeIn(p);
      w.rotation.x = s.x + (keys.x - s.x) * e;
      w.rotation.y = s.y + (keys.y - s.y) * e;
      w.rotation.z = s.z + (keys.z - s.z) * e;
    });
  }

  /* 抛石机：投出一枚飞石，抛物线砸向目标（飞越真实距离） */
  function launchStone(grp, w, vp, fz) {
    var stone = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xc2c7cc })
    );
    grp.updateMatrixWorld(true);
    var p0 = new THREE.Vector3();
    w.getWorldPosition(p0);
    if (p0.y < 0.9) p0.y = 0.9; // 保证从高处抛出
    stone.position.copy(p0);
    Anim.scene.add(stone);
    window.__stoneActive = true;
    var p1 = new THREE.Vector3(vp.x, 0.35, vp.z);
    var trailAt = [0.18, 0.36, 0.54];
    var dur = window.__stoneDur || 0.6;
    return tween(dur, function (p) {
      var x = p0.x + (p1.x - p0.x) * p;
      var y = p0.y + (p1.y - p0.y) * p + Math.sin(p * Math.PI) * 1.6;
      var z = p0.z + (p1.z - p0.z) * p;
      stone.position.set(x, y, z);
      stone.rotation.x += 0.4;
      stone.rotation.z += 0.25;
      if (trailAt.length && p >= trailAt[0]) {
        trailAt.shift();
        addDust(new THREE.Vector3(x, y - 0.1, z), 2);
      }
    }).then(function () {
      Anim.scene.remove(stone);
      stone.geometry.dispose(); stone.material.dispose();
      if (window.__stoneActive) window.__stoneActive = false;
      addHit(vp); Audio.cannon(); addDust(vp, 8);
    });
  }

  function attack(piece, victim) {
    var type = piece.type, w = piece.anchors.weapon;
    var fz = piece.side === 'red' ? -1 : 1;
    var vp = victim.group.position;
    var grp = piece.group;
    var seq = Promise.resolve();
    addSplash(vp); // 交锋水花飞溅

    switch (type) {
      case 'H': // 骑兵冲杀：大刀从高举横扫而下
        seq = weaponSwing(w, { x: fz * 0.4, y: -1.1, z: 1.6 }, 0.16)
          .then(function () {
            addSlash(vp, -0.5); addHit(vp); Audio.clash();
            grp.rotation.z = 0.14; grp.position.y = 0.12;
          })
          .then(function () { return sleep(0.16); })
          .then(function () { return weaponSwing(w, { x: 0, y: 0, z: 0 }, 0.18); })
          .then(function () { grp.rotation.z = 0; grp.position.y = 0; });
        break;
      case 'R': // 战车冲撞 + 戈刺
        seq = weaponSwing(w, { x: fz * 0.9, y: 0.4, z: -0.8 }, 0.12)
          .then(function () {
            addSlash(vp, 0.6); addHit(vp); Audio.clash();
            grp.rotation.x = fz * 0.1;
          })
          .then(function () { return sleep(0.14); })
          .then(function () { return weaponSwing(w, { x: 0, y: 0, z: 0 }, 0.15); })
          .then(function () { grp.rotation.x = 0; });
        break;
      case 'G': // 主帅重剑下劈（缓而沉）
        seq = weaponSwing(w, { x: -fz * 1.45, y: 0, z: 0.4 }, 0.2)
          .then(function () {
            addSlash(vp, fz * 0.9); addHit(vp); Audio.clash();
            grp.rotation.x = -fz * 0.12;
          })
          .then(function () { return sleep(0.18); })
          .then(function () { return weaponSwing(w, { x: 0, y: 0, z: 0 }, 0.2); })
          .then(function () { grp.rotation.x = 0; });
        break;
      case 'S': // 步卒挺刀突刺
        seq = tween(0.1, function (p) { w.position.z = fz * 0.35 + fz * 0.6 * easeIn(p); })
          .then(function () {
            addHit(vp); Audio.clash();
            grp.rotation.x = fz * 0.12;
          })
          .then(function () { return sleep(0.12); })
          .then(function () {
            return tween(0.15, function (p) { w.position.z = fz * 0.35 + fz * 0.6 * (1 - easeOut(p)); });
          })
          .then(function () { grp.rotation.x = 0; });
        break;
      case 'C': // 抛石机：后拉蓄力 → 投出飞石 → 复位
        seq = tween(0.16, function (p) { w.rotation.x = fz * 0.55 * easeIn(p); })
          .then(function () {
            return launchStone(grp, w, vp, fz); // 石弹飞行砸落
          })
          .then(function () { return sleep(0.16); })
          .then(function () { return tween(0.4, function (p) { w.rotation.x = fz * -0.7 * (1 - easeOut(p)); }); })
          .then(function () { w.rotation.x = 0; });
        break;
      case 'E': // 战象：扬蹄重踏
        seq = tween(0.16, function (p) {
          grp.rotation.x = -fz * 0.24 * easeIn(p);
          grp.position.y = 0.14 * easeIn(p);
        })
          .then(function () {
            return tween(0.1, function (p) {
              grp.rotation.x = fz * (-0.24 + 0.3) * easeIn(p);
              grp.position.y = 0.14 - 0.2 * easeIn(p);
            });
          })
          .then(function () {
            addHit(vp); Audio.cannon(); addDust(vp, 6);
          })
          .then(function () { return sleep(0.16); })
          .then(function () {
            return tween(0.3, function (p) {
              grp.rotation.x = fz * 0.06 * (1 - easeOut(p));
              grp.position.y = 0;
            });
          });
        break;
      case 'A': // 文官挥笏轻击
        seq = weaponSwing(w, { x: -fz * 1.5, y: 0, z: 0.3 }, 0.12)
          .then(function () {
            addHit(vp); Audio.clash();
            grp.rotation.x = fz * 0.1;
          })
          .then(function () { return sleep(0.13); })
          .then(function () { return weaponSwing(w, { x: 0, y: 0, z: 0 }, 0.16); })
          .then(function () { grp.rotation.x = 0; });
        break;
      default:
        addHit(vp);
        Audio.clash();
        seq = Promise.resolve();
    }
    return seq;
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* ---------------- 被吃：倒地 + 淡出 ---------------- */
  function removeVictim(piece) {
    var grp = piece.group;
    var mats = [];
    addSplash(grp.position); // 倒地水花
    grp.traverse(function (o) {
      if (o.isMesh) {
        var m = o.material;
        if (Array.isArray(m)) {
          m = m.map(function (mm) { var c = mm.clone(); c.transparent = true; return c; });
        } else {
          m = m.clone();
          m.transparent = true;
        }
        o.material = m;
        if (Array.isArray(m)) mats = mats.concat(m);
        else mats.push(m);
      }
    });
    var dir = piece.side === 'red' ? 1 : -1;
    var t0 = 0;
    Audio.captured();
    return tween(0.8, function (p) {
      t0 = p;
      if (p < 0.32) {
        var e = p / 0.32;
        grp.rotation.z = dir * 1.35 * easeIn(e);
        grp.position.y = -0.12 * e;
      } else {
        var f = 1 - (p - 0.32) / 0.68;
        mats.forEach(function (m) { m.opacity = Math.max(0, f); });
      }
    }).then(function () {
      Anim.scene.remove(grp);
    });
  }

  /* ---------------- 对外 ---------------- */
  Anim.addDust = addDust;
  Anim.addSlash = addSlash;
  Anim.addHit = addHit;
  Anim.addSplash = addSplash;
  Anim.move = move;
  Anim.attack = attack;
  Anim.removeVictim = removeVictim;
  Anim.updateEffects = updateEffects;
  Anim.tween = tween;

  window.Anim = Anim;
})();
