?@echo off
chcp 936 >nul
title 发布 AI 课堂助手到 GitHub
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\publish-api.ps1"
pause
