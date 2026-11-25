@echo off
chcp 65001 >nul
rem 素材导入：双击打开本地开发服务器，直接进素材导入页面（导入的素材可以写进项目的 public/custom 文件夹）。
rem 用完关掉这个窗口就行。不用这个工具，游戏照常玩。
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 goto nonode
if exist node_modules goto run
echo 第一次用：先装依赖，要等一两分钟……
call npm install
if errorlevel 1 goto fail
:run
echo 正在打开素材导入页面，浏览器会自己打开。用完关掉这个窗口。
call npm run assets
goto end
:nonode
echo 没找到 npm：先装 Node.js，到 https://nodejs.org 下载 LTS 版，装好再双击这个文件。
:fail
pause
exit /b 1
:end
pause
