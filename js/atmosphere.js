/* ============================================================
 * 大气系统：暴雨雨幕 + 闪电照明 + 地面水花
 * - 雨：THREE.Points 粒子（原地逐帧更新，避免每帧分配）
 * - 闪电：专用 DirectionalLight（不 castShadow），rAF 状态机驱动
 *   （勿用 setTimeout——后台标签页定时器会被节流）
 * - 水花：ring 池，上限 ~10
 * 暴露 window.Atmos = { init(scene), update(dt, now) }
 * ============================================================ */
(function () {
  'use strict';

  var RAIN_N = 3000;
  var RAIN_BOX = 17;     // x/z 范围 ±17
  var RAIN_TOP = 12;

  var scene = null;
  var rainGeo = null;
  var rainPos = null;
  var rainSpeed = null;

  var flashLight = null;
  var flashState = 'idle';   // idle | strike
  var flashTimer = 6 + Math.random() * 12; // 距离下次闪电的剩余秒
  var strikeT = 0;           // 本次闪光内进度
  var thunderDelay = 0;      // 雷声延迟倒计时
  var thunderFired = false;

  var splashes = [];
  var splashTimer = 0;

  function rainTexture() {
    var cv = document.createElement('canvas');
    cv.width = 16; cv.height = 32;
    var ctx = cv.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(159,178,204,0)');
    g.addColorStop(0.5, 'rgba(159,178,204,0.85)');
    g.addColorStop(1, 'rgba(159,178,204,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 32);
    return new THREE.CanvasTexture(cv);
  }

  function init(s) {
    scene = s;

    /* ---- 雨幕 ---- */
    rainPos = new Float32Array(RAIN_N * 3);
    rainSpeed = new Float32Array(RAIN_N);
    for (var i = 0; i < RAIN_N; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      rainPos[i * 3 + 1] = Math.random() * RAIN_TOP;
      rainPos[i * 3 + 2] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      rainSpeed[i] = 13 + Math.random() * 4;
    }
    rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    var mat = new THREE.PointsMaterial({
      map: rainTexture(),
      color: 0x9fb2cc,
      size: 0.14,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    scene.add(new THREE.Points(rainGeo, mat));

    /* ---- 闪电灯（强度 0，闪时抬升） ---- */
    flashLight = new THREE.DirectionalLight(0xcfe0ff, 0);
    flashLight.position.set(12, 18, -8);
    scene.add(flashLight);
  }

  function updateRain(dt) {
    var pos = rainGeo.attributes.position.array;
    for (var i = 0; i < RAIN_N; i++) {
      var y = pos[i * 3 + 1] - rainSpeed[i] * dt;
      if (y < 0) {
        pos[i * 3] = (Math.random() - 0.5) * 2 * RAIN_BOX;
        pos[i * 3 + 1] = RAIN_TOP;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      } else {
        pos[i * 3 + 1] = y;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  function updateLightning(dt) {
    if (flashState === 'idle') {
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flashState = 'strike';
        strikeT = 0;
        thunderDelay = 0.9 + Math.random() * 1.1;
        thunderFired = false;
      }
      return;
    }
    /* strike：2.4 冲高 → 1.4 → 0.2 → 指数衰减 */
    strikeT += dt;
    var t = strikeT, inten;
    if (t < 0.09) inten = 2.4 * (t / 0.09);
    else if (t < 0.18) inten = 2.4 - (2.4 - 1.4) * ((t - 0.09) / 0.09);
    else if (t < 0.40) inten = 1.4 - (1.4 - 0.2) * ((t - 0.18) / 0.22);
    else inten = 0.2 * Math.exp(-12 * (t - 0.40));
    flashLight.intensity = inten;

    if (thunderDelay > 0) {
      thunderDelay -= dt;
      if (thunderDelay <= 0 && !thunderFired) {
        thunderFired = true;
        if (window.Audio) Audio.thunder();
      }
    }

    if (t > 0.9) {
      flashLight.intensity = 0;
      flashState = 'idle';
      flashTimer = 6 + Math.random() * 12;
    }
  }

  function spawnSplash(x, z) {
    var geo = new THREE.RingGeometry(0.06, 0.16, 20);
    var mat = new THREE.MeshBasicMaterial({
      color: 0x8fa3b8, transparent: true, opacity: 0.4, depthWrite: false
    });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    scene.add(m);
    splashes.push({ mesh: m, t: 0 });
  }

  function updateSplashes(dt) {
    splashTimer -= dt;
    if (splashTimer <= 0 && splashes.length < 10) {
      splashTimer = 0.15;
      spawnSplash((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 9);
    }
    for (var i = splashes.length - 1; i >= 0; i--) {
      var s = splashes[i];
      s.t += dt;
      var p = Math.min(1, s.t / 0.5);
      s.mesh.scale.set(1 + p * 2.2, 1, 1 + p * 2.2);
      s.mesh.material.opacity = 0.4 * (1 - p);
      if (p >= 1) {
        scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        splashes.splice(i, 1);
      }
    }
  }

  var Atmos = {
    init: init,
    update: function (dt, now) {
      if (!rainGeo) return;
      dt = Math.min(dt, 0.1); // 防止后台切回第一帧大跳
      updateRain(dt);
      updateLightning(dt);
      updateSplashes(dt);
    }
  };

  window.Atmos = Atmos;
})();
