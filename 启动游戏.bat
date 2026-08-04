@echo off
rem 双击启动 3D 中国象棋（优先 node 服务器：静态 + WebSocket，支持在线对战）
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  rem 有 node：启动在线服务器（含 WebSocket 房间系统），打开浏览器
  set PORT=8123
  start "chess-server" cmd /k "node server.js"
  timeout /t 2 /nobreak >nul
  start "" "http://127.0.0.1:8123/index.html"
  exit
)

where python >nul 2>nul
if %errorlevel%==0 (
  rem 无 node 有 python：起本地静态服务（仅本地同屏对战）
  start "chess-server" cmd /k "python -m http.server 8123 --bind 127.0.0.1"
  timeout /t 2 /nobreak >nul
  start "" "http://127.0.0.1:8123/index.html"
) else (
  rem 无 node 无 python：直接以 file:// 打开（离线同屏对战）
  start "" "index.html"
)
exit
