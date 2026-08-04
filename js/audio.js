/* ============================================================
 * 程序化音效（Web Audio API 合成，无需音频文件）
 * 动作 → 音色：选中=木敲，行棋=嗖+落步，马=哒哒马蹄，
 * 吃子=兵刃撞击，被吃=倒地声，开炮=轰鸣，将军=警报，胜利=号角
 * ============================================================ */
(function () {
  'use strict';

  var ctx = null, master = null, noiseBuf = null;
  var rainBuf = null, rainSource = null, rainFilter = null, rainGain = null;
  var enabled = true;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.55 : 0;
      master.connect(ctx.destination);
      // 白噪声缓冲（复用，一次性音效）
      var len = ctx.sampleRate * 1.2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // 雨声缓冲（4s，循环）
      var rlen = ctx.sampleRate * 4;
      rainBuf = ctx.createBuffer(1, rlen, ctx.sampleRate);
      var rd = rainBuf.getChannelData(0);
      for (var j = 0; j < rlen; j++) rd[j] = Math.random() * 2 - 1;
      rainStart();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  /* 持续雨声：循环白噪声 → 低通 → 轻音量（背景氛围），静音走 master gain 不影响它 */
  function rainStart() {
    if (!ctx || !enabled || rainSource) return;
    rainSource = ctx.createBufferSource();
    rainSource.buffer = rainBuf;
    rainSource.loop = true;
    rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 750;
    rainGain = ctx.createGain();
    rainGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    rainGain.gain.linearRampToValueAtTime(0.075, ctx.currentTime + 1.5);
    rainSource.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    rainSource.start();
  }

  function rainStop() {
    if (!ctx || !rainSource) return;
    var g = rainGain, src = rainSource, t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    setTimeout(function () {
      try { src.stop(); src.disconnect(); } catch (e) {}
      if (rainSource === src) { rainSource = null; rainFilter = null; rainGain = null; }
    }, 600);
  }

  function setEnabled(v) {
    enabled = v;
    if (master) master.gain.value = v ? 0.55 : 0;
  }

  /* 振荡器音符 */
  function note(freq, dur, opts) {
    if (!ctx || !enabled) return;
    opts = opts || {};
    var t = ctx.currentTime + (opts.at || 0);
    var osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t + dur);
    var g = ctx.createGain();
    var vol = opts.gain || 0.2;
    var attack = opts.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /* 滤波噪声 */
  function noise(dur, opts) {
    if (!ctx || !enabled) return;
    opts = opts || {};
    var t = ctx.currentTime + (opts.at || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var filt = ctx.createBiquadFilter();
    filt.type = opts.type || 'bandpass';
    filt.frequency.setValueAtTime(opts.freq || 1000, t);
    if (opts.freqEnd) filt.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    if (opts.q) filt.Q.value = opts.q;
    var g = ctx.createGain();
    var vol = opts.gain || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (opts.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  var Audio = {
    ensure: ensure,
    toggle: function () { setEnabled(!enabled); return enabled; },
    isEnabled: function () { return enabled; },
    rainStart: rainStart,
    rainStop: rainStop,

    /* 选中：木敲两下 */
    select: function () {
      note(300, 0.09, { type: 'triangle', gain: 0.28 });
      note(410, 0.07, { type: 'triangle', gain: 0.2, at: 0.05 });
      noise(0.03, { type: 'highpass', freq: 2500, gain: 0.1 });
    },

    /* 行棋：嗖 + 轻落步（马会额外播蹄声） */
    move: function (type) {
      noise(0.26, { type: 'bandpass', freq: 350, freqEnd: 900, q: 1.2, gain: 0.16, attack: 0.02 });
      note(150, 0.1, { type: 'sine', gain: 0.12, freqEnd: 90 });
    },

    /* 马蹄：哒 */
    hoof: function () {
      noise(0.07, { type: 'bandpass', freq: 1600, freqEnd: 700, q: 1.5, gain: 0.3 });
      note(120, 0.09, { type: 'sine', gain: 0.2, freqEnd: 70 });
    },

    /* 落步 */
    land: function () {
      note(140, 0.12, { type: 'sine', gain: 0.22, freqEnd: 75 });
      noise(0.05, { type: 'lowpass', freq: 700, gain: 0.12 });
    },

    /* 吃子：金属兵刃撞击 */
    clash: function () {
      var t0 = ctx ? ctx.currentTime : 0;
      [920, 1480, 2350, 3650].forEach(function (f, i) {
        note(f, 0.28, { type: 'square', gain: 0.1 / (i + 1), at: i * 0.012 });
      });
      noise(0.2, { type: 'highpass', freq: 1800, q: 0.7, gain: 0.25 });
      note(180, 0.22, { type: 'sine', gain: 0.3, freqEnd: 60 });
      return t0;
    },

    /* 开炮：轰鸣 */
    cannon: function () {
      note(95, 0.45, { type: 'sine', gain: 0.45, freqEnd: 42 });
      noise(0.4, { type: 'lowpass', freq: 900, freqEnd: 250, gain: 0.35, attack: 0.005 });
      note(210, 0.12, { type: 'triangle', gain: 0.18, freqEnd: 120 });
    },

    /* 被吃：倒地 + 骨碌 */
    captured: function () {
      note(300, 0.3, { type: 'sine', gain: 0.2, freqEnd: 68 });       // 下坠
      note(110, 0.2, { type: 'sine', gain: 0.28, at: 0.12, freqEnd: 55 }); // 撞地
      for (var i = 0; i < 5; i++) {
        noise(0.04, { type: 'bandpass', freq: 900 + i * 350, q: 2, gain: 0.12, at: 0.16 + i * 0.06 });
      }
    },

    /* 将军：警报 */
    check: function () {
      note(660, 0.16, { type: 'square', gain: 0.12 });
      note(880, 0.22, { type: 'square', gain: 0.12, at: 0.16 });
      note(660, 0.18, { type: 'square', gain: 0.12, at: 0.4 });
    },

    /* 胜利：短号角 */
    win: function () {
      var seq = [523, 659, 784, 1047, 1318];
      seq.forEach(function (f, i) { note(f, 0.3, { type: 'triangle', gain: 0.22, at: i * 0.14 }); });
      [523, 659, 784, 1047].forEach(function (f) { note(f, 0.8, { type: 'triangle', gain: 0.09, at: 0.8 }); });
    },

    /* 非法：低鸣 */
    illegal: function () {
      note(110, 0.18, { type: 'square', gain: 0.1 });
      note(105, 0.16, { type: 'square', gain: 0.08, at: 0.06 });
    },

    /* 雷声：低频轰鸣 + 衰减回声 */
    thunder: function () {
      if (!ctx || !enabled) return;
      note(50, 0.6, { type: 'sine', gain: 0.5, freqEnd: 25 });
      noise(2.2, { type: 'lowpass', freq: 220, freqEnd: 55, gain: 0.4, attack: 0.02 });
      noise(1.4, { type: 'lowpass', freq: 120, freqEnd: 40, gain: 0.25, attack: 0.08, at: 0.7 });
    },

    /* 战鼓（选中/点兵）：低鼓两下 */
    drum: function () {
      if (!ctx || !enabled) return;
      note(95, 0.2, { type: 'triangle', gain: 0.4, freqEnd: 50 });
      note(95, 0.2, { type: 'triangle', gain: 0.3, at: 0.12, freqEnd: 50 });
      noise(0.06, { type: 'bandpass', freq: 400, q: 1.2, gain: 0.22 });
    },

    /* 冲锋（下达走子命令）：加速鼓点 + 部队喊杀 */
    charge: function () {
      if (!ctx || !enabled) return;
      [0, 0.14, 0.26, 0.36, 0.44, 0.50].forEach(function (t) {
        note(90, 0.12, { type: 'triangle', gain: 0.34, at: t, freqEnd: 55 });
        noise(0.05, { type: 'bandpass', freq: 500, q: 1.3, gain: 0.2, at: t });
      });
      noise(0.8, { type: 'bandpass', freq: 700, freqEnd: 1500, q: 0.7, gain: 0.16, attack: 0.12 });
    },

    /* 落地水花（吃子/落地溅起） */
    splash: function () {
      if (!ctx || !enabled) return;
      noise(0.12, { type: 'bandpass', freq: 1200, freqEnd: 400, q: 1.2, gain: 0.2 });
      note(800, 0.05, { type: 'triangle', gain: 0.08 });
    }
  };

  window.Audio = Audio;
})();
