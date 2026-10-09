@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo    PCB 数据智能助手 - 启动中...
echo    启动成功后浏览器打开 http://localhost:3000
echo ============================================
node --env-file-if-exists=.env server\index.js
pause
