@echo off
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"
timeout /t 2 >nul
start http://localhost:8080
