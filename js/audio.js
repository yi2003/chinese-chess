/* ============================================================
 * 经典音效（Web Audio API 合成，无需音频文件）
 * 选中=轻木叩 · 提子=短叩 · 行棋=滑走轻声 · 落子=实木嗒，
 * 吃子=双击实木碰 · 被吃=收子轻响 · 将军=双音提示 · 胜利=五音琶音
 * ============================================================ */
(function () {
  'use strict';

  var ctx = null, master = null, noiseBuf = null;
  var enabled = true;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.55 : 0;
      master.connect(ctx.destination);
      /* 白噪声缓冲（复用） */
      var len = ctx.sampleRate * 0.8;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
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
    var attack = opts.attack || 0.004;
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
    g.gain.linearRampToValueAtTime(vol, t + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  /* 一次木质叩击（短促、温润） */
  function woodTap(at, gain) {
    note(210 + Math.random() * 30, 0.075, { type: 'sine', gain: gain || 0.3, at: at, freqEnd: 120 });
    note(620, 0.03, { type: 'triangle', gain: (gain || 0.3) * 0.35, at: at });
    noise(0.02, { type: 'bandpass', freq: 1800, q: 1.4, gain: (gain || 0.3) * 0.5, at: at });
  }

  var Audio = {
    ensure: ensure,
    toggle: function () { setEnabled(!enabled); return enabled; },
    isEnabled: function () { return enabled; },

    /* 选中：很轻的一叩 */
    select: function () {
      woodTap(0, 0.18);
    },

    /* 提子（点击己方棋子）：稍实的木叩 */
    drum: function () {
      woodTap(0.045, 0.26);
    },

    /* 行棋起手：极轻的滑动摩擦声 */
    move: function () {
      noise(0.16, { type: 'bandpass', freq: 420, freqEnd: 900, q: 0.9, gain: 0.06, attack: 0.04 });
    },

    /* 落子：清脆的实木嗒 */
    land: function () {
      woodTap(0, 0.34);
      note(150, 0.09, { type: 'sine', gain: 0.14, at: 0.01, freqEnd: 90 });
    },

    /* 吃子：双击实木相碰 */
    clash: function () {
      woodTap(0, 0.36);
      woodTap(0.055, 0.3);
      note(190, 0.12, { type: 'sine', gain: 0.2, at: 0.05, freqEnd: 100 });
    },

    /* 被吃收子：轻响一下 */
    captured: function () {
      woodTap(0.02, 0.2);
    },

    /* 冲锋指令（走棋瞬间）：轻微布料/衣袖拂动，克制不喧哗 */
    charge: function () {
      noise(0.1, { type: 'lowpass', freq: 900, freqEnd: 300, gain: 0.05, attack: 0.03 });
    },

    /* 将军：两记木鱼式提示 */
    check: function () {
      note(880, 0.14, { type: 'sine', gain: 0.22 });
      note(1174, 0.22, { type: 'sine', gain: 0.2, at: 0.15 });
    },

    /* 胜利：五声音阶琶音（宫商角徵羽） */
    win: function () {
      [523, 587, 659, 784, 1047].forEach(function (f, i) {
        note(f, 0.42, { type: 'triangle', gain: 0.2, at: i * 0.13 });
      });
      [523, 784, 1047].forEach(function (f) {
        note(f, 0.9, { type: 'sine', gain: 0.08, at: 0.75 });
      });
    },

    /* 非法操作：低哑短鸣 */
    illegal: function () {
      note(130, 0.15, { type: 'square', gain: 0.08 });
      note(124, 0.13, { type: 'square', gain: 0.06, at: 0.06 });
    }
  };

  window.Audio = Audio;
})();
