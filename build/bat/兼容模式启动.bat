@echo off
title AI 课堂助手 - 兼容模式
setlocal
cd /d "%~dp0"
echo 正在以兼容模式启动（关闭 GPU 硬件加速 / 图形合成）...
start "" "AI-Tutor-Assistant.exe" --disable-gpu --disable-gpu-compositing --disable-software-rasterizer --disable-features=Vulkan,DefaultANGLEVulkan
echo 如果仍然没有窗口，请运行同目录下的「诊断.bat」并把生成的日志发给开发者。
timeout /t 6 /nobreak >nul
endlocal
