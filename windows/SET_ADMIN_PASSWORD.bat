@echo off
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" tools\set_admin_password.py
) else (
  python tools\set_admin_password.py
)
pause
