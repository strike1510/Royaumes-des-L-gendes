@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title Royaumes de Legende - Demarrage

echo ============================================
echo   Royaumes de Legende - Lancement propre
echo ============================================
echo.
echo Ports utilises :
echo   Site web       : http://127.0.0.1:50006
echo   Serveur de jeu : http://127.0.0.1:50007
echo   Cloudflare     : play.lavignere.eu -^> http://127.0.0.1:50006
echo.

where bun >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo [ERREUR] Bun n'est pas installe ou pas accessible dans le PATH.
  echo Installe Bun puis relance ce fichier :
  echo powershell -c "irm bun.sh/install.ps1 ^| iex"
  pause
  exit /b 1
)

echo [1/5] Fermeture des anciens processus sur les ports 50006 et 50007...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 50006,50007 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

echo.
echo [2/5] Installation des dependances du serveur de jeu si necessaire...
pushd "%~dp0mini-services\game-server"
if not exist "node_modules" (
  call bun install
  if errorlevel 1 (
    echo [ERREUR] Impossible d'installer les dependances du serveur de jeu.
    pause
    exit /b 1
  )
) else (
  echo Deja installe.
)
popd

echo.
echo [3/5] Lancement du serveur de jeu sur le port 50007...
start "RDL - SERVEUR JEU 50007" "%ComSpec%" /k "cd /d ""%~dp0mini-services\game-server"" && set ""GAME_SERVER_PORT=50007"" && set ""GAME_SERVER_HOST=127.0.0.1"" && bun index.ts"
timeout /t 3 /nobreak >nul

echo.
echo [4/5] Installation/build du site Next.js...
if not exist "node_modules" (
  call bun install
  if errorlevel 1 (
    echo [ERREUR] Impossible d'installer les dependances du site.
    pause
    exit /b 1
  )
) else (
  echo Dependances deja installees.
)

set "GAME_SERVER_INTERNAL_URL=http://127.0.0.1:50007"
set "NEXT_PUBLIC_GAME_SERVER_URL="
call bun run build
if %ERRORLEVEL% neq 0 (
  echo [ERREUR] Le build Next.js a echoue.
  pause
  exit /b 1
)

if not exist ".next\standalone\server.js" (
  echo [ERREUR] .next\standalone\server.js est introuvable.
  echo Verifie que next.config.ts contient bien output: "standalone".
  pause
  exit /b 1
)

if not exist ".next\standalone\.next" mkdir ".next\standalone\.next"
if exist ".next\standalone\.next\static" rmdir /S /Q ".next\standalone\.next\static"
xcopy /E /I /Y ".next\static" ".next\standalone\.next\static" >nul

if exist "public" (
  if exist ".next\standalone\public" rmdir /S /Q ".next\standalone\public"
  xcopy /E /I /Y "public" ".next\standalone\public" >nul
)

echo.
echo [5/5] Lancement du site web sur le port 50006...
start "RDL - SITE WEB 50006" "%ComSpec%" /k "cd /d ""%~dp0"" && bun start-site.cjs"

echo.
echo ============================================
echo   TERMINE
echo ============================================
echo Site local      : http://127.0.0.1:50006
echo Serveur de jeu  : http://127.0.0.1:50007
echo Domaine public  : https://play.lavignere.eu
echo.
echo Dans Cloudflare Tunnel, mets UNE SEULE route :
echo   play.lavignere.eu -^> http://127.0.0.1:50006
echo.
echo Le site redirige automatiquement /socket.io vers le serveur de jeu 50007.
echo ============================================
echo.
pause
