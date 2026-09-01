@echo off
setlocal
set "WORKSPACE=%~dp0games\city_drive\workspace"

cd /d "%WORKSPACE%"
start "" "http://127.0.0.1:5173/"
npm run dev -- --host 127.0.0.1 --port 5173

pause
