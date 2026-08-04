/* ============================================================
 * 大气系统：暴雨雨幕 + 闪电照明 + 地面水花
 * - 雨：GPU 顶点着色器动画（mod 循环下落），零 CPU 逐帧开销
 * - 闪电：专用 DirectionalLight（不 castShadow），rAF 状态机驱动
 * - 水花：预建 ring 池复用，避免逐帧/逐次分配造成 GC 卡顿
 * 暴露 window.Atmos = { init(scene), update(dt, now) }
 * 需要 main.js 设置 Atmos.renderer（用于雨点大小衰减）
 * ============================================================ */
(function () {
  'use strict';

  var RAIN_N = 2000;
  var RAIN_BOX = 17;     // x/z 范围 ±17
  var RAIN_TOP = 12;

  var scene = null;
  var rainUniforms = null;

  var flashLight = null;
  var flashState = 'idle';   // idle | strike
  var flashTimer = 6 + Math.random() * 12;
  var strikeT = 0;
  var thunderDelay = 0;
  var thunderFired = false;

  var SPLASH_POOL = 10;
  var splashPool = [];
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

  /* 雨：GPU 动画。顶点里用 mod(baseY - uTime*speed, RAIN_TOP) 循环下落，
   * 无需 CPU 逐帧改 position 也不再每帧重传缓冲。 */
  function initRain() {
    var pos = new Float32Array(RAIN_N * 3);
    var speed = new Float32Array(RAIN_N);
    for (var i = 0; i < RAIN_N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      pos[i * 3 + 1] = Math.random() * RAIN_TOP;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      speed[i] = 13 + Math.random() * 4;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));

    rainUniforms = {
      uTime: { value: 0 },
      uScale: { value: 200 },
      uMap: { value: rainTexture() }
    };
    var mat = new THREE.ShaderMaterial({
      uniforms: rainUniforms,
      vertexShader: [
        'uniform float uTime;',
        'uniform float uScale;',
        'attribute float aSpeed;',
        'varying float vFade;',
        'void main() {',
        '  vec3 base = position;',
        '  float y = mod(base.y - uTime * aSpeed, 12.0);',
        '  vFade = smoothstep(0.0, 2.0, y) * (1.0 - smoothstep(8.0, 11.0, y));',
        '  vec4 mv = modelViewMatrix * vec4(base.x, y, base.z, 1.0);',
        '  gl_PointSize = 0.14 * (uScale / -mv.z);',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'varying float vFade;',
        'void main() {',
        '  vec4 t = texture2D(uMap, gl_PointCoord);',
        '  gl_FragColor = vec4(0.62, 0.70, 0.80, 1.0) * t.a * vFade * 0.55;',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    scene.add(new THREE.Points(geo, mat));
  }

  function updateRain(dt) {
    rainUniforms.uTime.value += dt;
    if (Atmos.renderer && Atmos.renderer.domElement) {
      rainUniforms.uScale.value = Atmos.renderer.domElement.height * 0.5;
    }
  }

  function initLightning() {
    flashLight = new THREE.DirectionalLight(0xcfe0ff, 0);
    flashLight.position.set(12, 18, -8);
    scene.add(flashLight);
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

  /* 水花：预建 ring 池（共享几何，逐 mesh 材质克隆），循环复用 */
  function initSplashes() {
    var geo = new THREE.RingGeometry(0.06, 0.16, 20);
    for (var i = 0; i < SPLASH_POOL; i++) {
      var mat = new THREE.MeshBasicMaterial({
        color: 0x8fa3b8, transparent: true, opacity: 0.4, depthWrite: false
      });
      var m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      splashPool.push(m);
    }
  }

  function spawnSplash(x, z) {
    var m = splashPool.shift();
    if (!m) return;
    m.visible = true;
    m.position.set(x, 0.012, z);
    m.scale.set(1, 1, 1);
    m.material.opacity = 0.4;
    splashes.push({ mesh: m, t: 0 });
  }

  function updateSplashes(dt) {
    splashTimer -= dt;
    if (splashTimer <= 0 && splashes.length < SPLASH_POOL) {
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
        s.mesh.visible = false;
        splashPool.push(s.mesh);
        splashes.splice(i, 1);
      }
    }
  }

  var Atmos = {
    renderer: null,
    init: function (s) {
      scene = s;
      initRain();
      initLightning();
      initSplashes();
    },
    update: function (dt) {
      if (!rainUniforms) return;
      dt = Math.min(dt, 0.1);
      updateRain(dt);
      updateLightning(dt);
      updateSplashes(dt);
    }
  };

  window.Atmos = Atmos;
})();
