@echo off
title AI 课堂助手 - 诊断
setlocal
set "BASE=%~dp0"
set "LOG=%BASE%诊断日志.txt"
set "DATA=%APPDATA%\AITutorAssistant"

echo ==== 诊断开始 %date% %time% ==== > "%LOG%"
echo. >> "%LOG%"
echo [1] 系统信息 >> "%LOG%"
ver >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo [2] Electron 版本自检 >> "%LOG%"
"%BASE%AI-Tutor-Assistant.exe" --version >> "%LOG%" 2>&1
echo （上面没有输出版本号 = Electron 本体起不来） >> "%LOG%"
echo. >> "%LOG%"
echo [3] 正常启动一次 >> "%LOG%"
start "" "%BASE%AI-Tutor-Assistant.exe"
timeout /t 10 /nobreak >nul
echo. >> "%LOG%"
echo [4] boot.log（进程是否加载了程序） >> "%LOG%"
if exist "%DATA%\boot.log" (type "%DATA%\boot.log" >> "%LOG%") else (echo 缺失：程序代码从未被执行 >> "%LOG%")
echo. >> "%LOG%"
echo [5] startup.log（启动到哪一步） >> "%LOG%"
if exist "%DATA%\startup.log" (type "%DATA%\startup.log" >> "%LOG%") else (echo 缺失：初始化阶段没跑起来 >> "%LOG%")
echo. >> "%LOG%"
echo [6] 运行中的进程 >> "%LOG%"
tasklist /FI "IMAGENAME eq AI-Tutor-Assistant.exe" >> "%LOG%" 2>&1
echo. >> "%LOG%"
echo ==== 诊断结束 ==== >> "%LOG%"

echo.
echo 诊断完成，日志已保存为：
echo   %LOG%
echo 请把这个文件发给开发者。
echo.
notepad "%LOG%"
endlocal
