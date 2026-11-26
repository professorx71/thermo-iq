@echo off
rem Version, package and deploy ThermoIQ. See the cloud deployment guide.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1" %*
set "RELEASE_EXIT=%ERRORLEVEL%"
echo.
if not "%RELEASE_EXIT%"=="0" echo Release stopped with exit code %RELEASE_EXIT%.
pause
exit /b %RELEASE_EXIT%
