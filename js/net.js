/* ============================================================
 * 网络层：WebSocket 客户端 + 大厅遮罩 UI
 * - 连接失败（file://、纯静态服务、本地离线）→ 本地热座模式，
 *   游戏行为与旧版完全一致（Net.mode === 'local'）
 * - 连接成功 → 在线模式：创建房间 / 输入房间码加入 / 观战
 * 暴露 window.Net；main.js 通过 Net.handlers 注册业务回调
 * ============================================================ */
(function () {
  'use strict';

  var ws = null;
  var mode = 'local';   // local | online
  var side = null;      // 'red' | 'black' | 'spec'（有房时）
  var roomCode = null;
  var connectedOnce = false;
  var handlers = {};

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 大厅遮罩 ---------------- */
  function lobbyEl() { return $('lobby'); }

  function setStatus(text) {
    var el = $('lobby-status');
    if (el) el.textContent = text;
  }

  function showLobby() { lobbyEl().classList.remove('hidden'); }
  function hideLobby() { lobbyEl().classList.add('hidden'); }

  function show(elId) { $(elId).classList.remove('hidden'); }
  function hide(elId) { $(elId).classList.add('hidden'); }

  function showMenu() {
    show('lobby-menu'); hide('lobby-waiting'); hide('lobby-disconnected');
    setStatus(connectedOnce ? '已连接服务器，创建房间或输入房间码加入' : '正在连接服务器…');
    $('btn-leave').classList.add('hidden');
    $('roombadge').classList.add('hidden');
  }

  function showWaiting(msg) {
    hide('lobby-menu'); show('lobby-waiting'); hide('lobby-disconnected');
    $('lobby-wait-msg').textContent = msg;
    setStatus(connectedOnce ? '已连接服务器' : '正在连接服务器…');
    $('btn-leave').classList.add('hidden');
  }

  function showDisconnected() {
    hide('lobby-menu'); hide('lobby-waiting'); show('lobby-disconnected');
  }

  /* ---------------- 房间徽标（顶栏） ---------------- */
  function setBadge(text) {
    var b = $('roombadge');
    b.textContent = text;
    b.classList.remove('hidden');
  }

  /* ---------------- 发送 ---------------- */
  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  /* ---------------- 对外 API ---------------- */
  var Net = {
    get mode() { return mode; },
    get side() { return side; },
    get roomCode() { return roomCode; },
    isOnline: function () { return mode === 'online'; },
    inRoom: function () { return mode === 'online' && !!roomCode; },

    handlers: handlers,

    /* 进入房间后（玩家或观战）由服务器消息驱动，无需手动 */
    createRoom: function () { send({ type: 'create' }); },
    joinRoom: function (code) { send({ type: 'join', code: code }); },
    sendMove: function (from, to) {
      if (mode !== 'online' || !roomCode || side === 'spec') return;
      send({ type: 'move', from: from, to: to });
    },
    sendRematch: function () { send({ type: 'rematch' }); },
    requestSync: function () { send({ type: 'sync' }); },
    leave: function () {
      send({ type: 'leave' });
      roomCode = null;
      side = null;
      showMenu();
      if (Net.handlers.onLeave) Net.handlers.onLeave();
    },

    /* main.js 调用：离开房间回大厅（保持在线） */
    backToLobby: function () {
      roomCode = null;
      side = null;
      showLobby();
      showMenu();
    },

    /* 隐藏大厅（进入对局/观战），由 net 内部或 main 调用 */
    hideLobby: hideLobby,
    showWaiting: showWaiting,
    setStatus: setStatus
  };

  /* ---------------- 消息分发 ---------------- */
  function handleMessage(msg) {
    switch (msg.type) {
      case 'created':
      case 'joined': {
        side = msg.side;
        roomCode = msg.code;
        if (side === 'spec') {
          setBadge('观战 · 房间 ' + roomCode);
          hideLobby();
          $('btn-leave').classList.remove('hidden');
        } else if (msg.phase === 'waiting') {
          $('lobby-code').textContent = roomCode;
          showWaiting('等待对手加入…');
          showLobby();
        } else {
          setBadge('房间 ' + roomCode + ' · ' + (side === 'red' ? '红方' : '黑方'));
          hideLobby();
          $('btn-leave').classList.remove('hidden');
        }
        if (Net.handlers.onEnterRoom) Net.handlers.onEnterRoom(msg);
        break;
      }
      case 'game_start': {
        hideLobby();
        if (Net.handlers.onGameStart) Net.handlers.onGameStart(msg);
        break;
      }
      case 'opponent_joined': {
        if (Net.handlers.onOpponentJoined) Net.handlers.onOpponentJoined(msg);
        break;
      }
      case 'move': {
        if (Net.handlers.onMove) Net.handlers.onMove(msg);
        break;
      }
      case 'move_ack': {
        if (Net.handlers.onMoveAck) Net.handlers.onMoveAck(msg);
        break;
      }
      case 'opponent_left': {
        $('lobby-code').textContent = roomCode || '?????';
        showWaiting('对方已离开，等待新玩家加入…');
        showLobby();
        if (Net.handlers.onOpponentLeft) Net.handlers.onOpponentLeft(msg);
        break;
      }
      case 'rematch_offer': {
        if (Net.handlers.onRematchOffer) Net.handlers.onRematchOffer(msg);
        break;
      }
      case 'rematch_started': {
        if (Net.handlers.onRematchStart) Net.handlers.onRematchStart(msg);
        break;
      }
      case 'spec_count': {
        if (Net.handlers.onSpecCount) Net.handlers.onSpecCount(msg);
        break;
      }
      case 'sync_state': {
        if (Net.handlers.onSyncState) Net.handlers.onSyncState(msg);
        break;
      }
      case 'room_closed': {
        if (Net.handlers.onRoomClosed) Net.handlers.onRoomClosed(msg);
        break;
      }
      case 'error': {
        if (Net.handlers.onError) Net.handlers.onError(msg);
        break;
      }
      default: break;
    }
  }

  /* ---------------- 连接 ---------------- */
  function connect() {
    /* file:// 或非 http 环境无 WS → 直接本地模式 */
    if (location.protocol === 'file:' || location.protocol === 'about:') {
      mode = 'local';
      hideLobby();
      if (Net.handlers.onLocal) Net.handlers.onLocal();
      return;
    }
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    /* 先显示大厅，连接结果出来再决定（失败→本地热座） */
    showLobby();
    setStatus('正在连接服务器…');
    try {
      ws = new WebSocket(proto + location.host + '/ws');
    } catch (e) {
      mode = 'local';
      hideLobby();
      if (Net.handlers.onLocal) Net.handlers.onLocal();
      return;
    }

    ws.onopen = function () {
      connectedOnce = true;
      mode = 'online';
      setStatus('已连接服务器，创建房间或输入房间码加入');
      showLobby();
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };
    ws.onerror = function () { /* 走 onclose */ };
    ws.onclose = function () {
      if (!connectedOnce) {
        /* 从未连上（纯静态服务 / 无服务器）→ 本地热座 */
        mode = 'local';
        hideLobby();
        if (Net.handlers.onLocal) Net.handlers.onLocal();
      } else {
        /* 已连上后断开 → 提示刷新 */
        showLobby();
        showDisconnected();
      }
    };
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindUI() {
    $('btn-create-room').addEventListener('click', function () {
      Net.createRoom();
      setStatus('正在创建房间…');
    });
    $('btn-join-room').addEventListener('click', function () {
      var code = ($('join-code').value || '').toUpperCase().trim();
      if (!code) return;
      Net.joinRoom(code);
      setStatus('正在加入房间 ' + code + ' …');
    });
    $('join-code').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('btn-join-room').click();
    });
    $('btn-copy-code').addEventListener('click', function () {
      var code = $('lobby-code').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () {
          var b = this;
          var old = b.textContent;
          b.textContent = '已复制 ✓';
          setTimeout(function () { b.textContent = old; }, 1200);
        }.bind(this)).catch(function () {});
      }
    });
    $('btn-cancel-room').addEventListener('click', function () { Net.leave(); });
    $('btn-leave').addEventListener('click', function () { Net.leave(); });
    $('btn-reload').addEventListener('click', function () { location.reload(); });
    $('btn-local-play').addEventListener('click', function () {
      /* 不建房，直接本地双人对弈 */
      side = null;
      roomCode = null;
      hideLobby();
      if (Net.handlers.onLocal) Net.handlers.onLocal();
    });
  }

  bindUI();
  connect();
  window.Net = Net;
})();
