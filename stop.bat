@echo off
setlocal EnableExtensions
chcp 65001 >nul

echo Fermeture des processus sur les ports 50006 et 50007...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 50006,50007 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
echo Termine.
pause
