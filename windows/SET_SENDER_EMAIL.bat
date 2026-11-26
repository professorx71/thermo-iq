@echo off
rem Change the alarm sender account in the local .env and on the cloud server.
rem Example: SET_SENDER_EMAIL.bat --email alarm@octaveworks.com --host mail.octaveworks.com
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (set "PY=.venv\Scripts\python.exe") else (set "PY=python")
"%PY%" tools\set_sender.py %*
echo.
pause
