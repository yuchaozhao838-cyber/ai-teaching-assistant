?@echo off
chcp 936 >nul
title AI 课堂助手 - 手机版服务
cd /d "%~dp0..\..\dist-mobile"
echo.
echo ==========================================
echo   AI 课堂助手 手机版（PWA）
echo ==========================================
echo.
echo 本机打开:  http://127.0.0.1:8899/
echo.
echo 手机打开（同一 Wi-Fi 下，把下面地址输进手机浏览器）:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do echo    http://%%b:8899/
)
echo.
echo 手机浏览器里点菜单 - 添加到主屏幕，就能像 App 一样使用。
echo 关闭这个窗口就会停止服务。
echo.
start "" http://127.0.0.1:8899/
"C:\Users\Lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" -m http.server 8899 --bind 0.0.0.0
pause
