/* ============================================================
 * 经典动画：行棋=平滑滑行（轻微抬起弧线）+ 落子轻顿，
 * 吃子=攻方前顶一碰、守方快速缩放退场 + 淡金涟漪。
 * 所有动画返回 Promise，主流程 await 串行播放。
 * ============================================================ */
(function () {
  'use strict';

  var Anim = {
    scene: null,
    effects: []
  };

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
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

  function sleep(sec) {
    return new Promise(function (res) { setTimeout(res, sec * 1000); });
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

  /* 落子/吃子处的一圈淡金涟漪 */
  function addRipple(pos, color) {
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.30, 30),
      new THREE.MeshBasicMaterial({
        color: color || 0xd8b46a, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.035, pos.z);
    Anim.scene.add(ring);
    var t = 0, dur = 0.45;
    spawnEffect({
      update: function (dt) {
        t += dt;
        var e = Math.min(1, t / dur);
        var s = 1 + easeOut(e) * 2.2;
        ring.scale.set(s, s, 1);
        ring.material.opacity = 0.55 * (1 - e);
        if (t >= dur) this.dead = true;
      },
      dispose: function () { Anim.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); }
    });
  }

  /* ---------------- 行棋：平滑滑行 ---------------- */
  function move(piece, from, to) {
    var start = Board.pos(from.col, from.row);
    var end = Board.pos(to.col, to.row);
    var grp = piece.group;
    grp.rotation.set(0, 0, 0);

    var dx = end.x - start.x, dz = end.z - start.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var dur = Math.min(0.62, 0.26 + dist * 0.055);   /* 距离越远稍久，上限克制 */

    Audio.move(piece.type);
    return tween(dur, function (p) {
      var e = easeInOut(p);
      grp.position.set(
        start.x + dx * e,
        Math.sin(e * Math.PI) * 0.32,   /* 轻抬弧线，像被手提起再放下 */
        start.z + dz * e
      );
    }).then(function () {
      grp.position.copy(end);
      grp.position.y = 0;
      grp.rotation.set(0, 0, 0);
      Audio.land();
      addRipple(end);
    });
  }

  /* ---------------- 吃子：前顶一碰 ---------------- */
  function attack(attacker, victim) {
    var grp = attacker.group;
    var from = grp.position.clone();
    var vp = victim.group.position;
    var dir = new THREE.Vector3().subVectors(vp, from);
    dir.y = 0;
    var len = dir.length();
    if (len > 0.001) dir.divideScalar(len);
    var push = Math.min(0.22, len * 0.4);

    return sleep(0.05).then(function () {
      /* 向目标快速一顶 */
      return tween(0.09, function (p) {
        var e = 1 - Math.pow(1 - p, 2);
        grp.position.set(from.x + dir.x * push * e, 0.10 * e, from.z + dir.z * push * e);
      });
    }).then(function () {
      Audio.clash();               /* 实木碰撞声 */
      addRipple(vp, 0xc96a4a);
      /* 回弹落位 */
      return tween(0.12, function (p) {
        var e = easeOut(p);
        grp.position.set(from.x + dir.x * push * (1 - e), 0.10 * (1 - e), from.z + dir.z * push * (1 - e));
      });
    }).then(function () {
      grp.position.copy(from);
      grp.position.y = 0;
    });
  }

  /* 被吃棋子：快速缩小退场（材质共享缓存，不做透明淡出） */
  function removeVictim(victim) {
    Audio.captured();
    var grp = victim.group;
    return tween(0.16, function (p) {
      var s = Math.max(0.001, 1 - p);
      grp.scale.set(s, s, s);
      grp.position.y = 0.25 * p;   /* 像被从盘上拈起收走 */
    }).then(function () {
      grp.scale.set(1, 1, 1);
      grp.position.y = 0;
    });
  }

  Anim.move = move;
  Anim.attack = attack;
  Anim.removeVictim = removeVictim;
  Anim.updateEffects = updateEffects;

  window.Anim = Anim;
})();
