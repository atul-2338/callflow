@echo off
setlocal EnableExtensions
title CallFlow - Fix and Deploy
cd /d "%~dp0"

rem ============================================================
rem  fix-and-deploy.bat -- one-click rescue deploy for CallFlow
rem
rem  Double-click this file. You type the Vultr root password
rem  once and everything else runs automatically, ending with
rem  live journalctl logs.
rem
rem  Target server : root at 45.76.252.174 - Vultr VPS
rem  Service       : systemd unit "callflow" on port 3000
rem
rem  What it does on the server:
rem   1. kills whatever squats on port 3000 - fixes EADDRINUSE
rem   2. systemctl reset-failed callflow - clears the crash
rem      limit that trips after 5 crashes within 60 seconds
rem   3. stashes server-local edits so the pull is clean
rem      - .env and the SQLite DB are never touched by this
rem   4. runs deploy/vps-deploy.sh: git pull + npm ci + build
rem      + restart + health gate with automatic rollback
rem   5. tails journalctl -u callflow -f - press Ctrl+C to quit
rem
rem  Transport:
rem   - plink.exe from PuTTY is preferred: the password is passed
rem     with -pw so there are zero prompts. The script looks for
rem     it on PATH and in the default PuTTY install folders.
rem   - otherwise the built-in Windows OpenSSH ssh.exe runs ALL
rem     commands in ONE session, so the password is typed once.
rem
rem  Maintenance notes:
rem   - The bash payload is written by :write_payload using
rem     append-echo lines. Inside those lines, cmd special
rem     characters must be caret-escaped outside of quotes:
rem     pipe, ampersand, greater-than, less-than. Two percent
rem     signs give a literal percent. Text inside double quotes
rem     needs no escaping.
rem   - The payload is written with Windows CRLF endings; the
rem     remote side strips them with: tr -d '\r' pipe bash -s
rem   - Run with --gen-test to only write the payload to TEMP
rem     and syntax-check it. No connection is made.
rem ============================================================

set "VULTR_HOST=45.76.252.174"
set "VULTR_USER=root"
set "TMPSCRIPT=%TEMP%\callflow-fix-deploy.sh"

echo.
echo  ============================================================
echo    CallFlow - one-click fix and deploy
echo    target: %VULTR_USER%@%VULTR_HOST%
echo    1 kill port 3000    2 reset crash limit    3 stash edits
echo    4 pull + build      5 restart + health    6 live logs
echo  ============================================================
echo.

set "GEN_TEST="
if /i "%~1"=="--gen-test" set "GEN_TEST=1"

rem ---- find a transport ---------------------------------------
set "PLINK_EXE="
where plink >nul 2>nul && set "PLINK_EXE=plink"
if defined PLINK_EXE goto :transport_plink
if exist "%ProgramFiles%\PuTTY\plink.exe" set "PLINK_EXE=%ProgramFiles%\PuTTY\plink.exe"
if defined PLINK_EXE goto :transport_plink
if exist "%ProgramFiles(x86)%\PuTTY\plink.exe" set "PLINK_EXE=%ProgramFiles(x86)%\PuTTY\plink.exe"
if defined PLINK_EXE goto :transport_plink
where ssh >nul 2>nul || goto :no_transport
echo  transport : Windows OpenSSH ssh.exe
echo              you will type the password ONCE
goto :after_transport

:transport_plink
echo  transport : plink.exe - password passed with -pw, no prompts

:after_transport
if defined GEN_TEST goto :gen_test
rem ---- ask for the password exactly once ----------------------
echo.
set "PW="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$p=Read-Host 'Vultr root password' -AsSecureString;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p);$t=[Runtime.InteropServices.Marshal]::PtrToStringAuto($b);[Console]::Write($t)" 2^>nul`) do set "PW=%%p"
if defined PW goto :have_pw
set /p "PW=Vultr root password (typing will be visible): "
if not defined PW goto :no_password

:have_pw
echo.
echo  Writing remote payload...
call :write_payload
if not exist "%TMPSCRIPT%" goto :gen_failed

if defined PLINK_EXE goto :run_plink

echo.
echo  ============================================================
echo   Connecting with ssh. Enter the password when asked - ONCE.
echo   The full deploy runs, then live logs appear.
echo   Press Ctrl+C to stop watching the logs.
echo  ============================================================
echo.
ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=15 %VULTR_USER%@%VULTR_HOST% "tr -d '\r' | bash -s" < "%TMPSCRIPT%"
goto :session_done

:run_plink
echo.
echo  [pre-flight] caching the host key...
echo y| "%PLINK_EXE%" -ssh -pw "%PW%" %VULTR_USER%@%VULTR_HOST% "exit 0" >nul 2>&1
if errorlevel 1 goto :plink_auth_fail
echo.
echo  ============================================================
echo   Connecting with plink - no further prompts.
echo   The full deploy runs, then live logs appear.
echo   Press Ctrl+C to stop watching the logs.
echo  ============================================================
echo.
"%PLINK_EXE%" -ssh -batch -pw "%PW%" %VULTR_USER%@%VULTR_HOST% "tr -d '\r' | bash -s" < "%TMPSCRIPT%"
goto :session_done

:session_done
set "PW="
echo.
echo  ---- session closed ----
del "%TMPSCRIPT%" >nul 2>&1
echo.
echo  You can close this window now.
pause
exit /b 0

:plink_auth_fail
echo.
echo  !! plink could not authenticate - wrong password or host unreachable.
del "%TMPSCRIPT%" >nul 2>&1
pause
exit /b 1

:no_transport
echo.
echo  !! No SSH client found.
echo     Install PuTTY from https://www.putty.org - its plink.exe
echo     enables the zero-prompt password mode of this script.
echo.
pause
exit /b 1

:no_password
echo.
echo  !! No password entered - nothing was done.
echo.
pause
exit /b 1

:gen_failed
echo.
echo  !! Could not write the bash payload to %TEMP%.
echo.
pause
exit /b 1

:gen_test
echo  [gen-test] writing payload to %TMPSCRIPT% - no connection will be made
echo.
call :write_payload
if not exist "%TMPSCRIPT%" goto :gen_failed
echo.
echo  [gen-test] payload written:  %TMPSCRIPT%
if exist "C:\Program Files\Git\bin\bash.exe" "C:\Program Files\Git\bin\bash.exe" -n "%TMPSCRIPT:\=/%" && echo  [gen-test] bash -n: syntax OK
echo  [gen-test] done.
exit /b 0

:write_payload
del "%TMPSCRIPT%" >nul 2>&1
>>"%TMPSCRIPT%" echo #!/usr/bin/env bash
>>"%TMPSCRIPT%" echo # fix-and-deploy payload - generated by fix-and-deploy.bat on Windows.
>>"%TMPSCRIPT%" echo # Runs as root on the Vultr box. Sequence:
>>"%TMPSCRIPT%" echo #   1 clear port 3000 squatters   2 reset systemd crash limit
>>"%TMPSCRIPT%" echo #   3 locate checkout             4 stash server-local edits
>>"%TMPSCRIPT%" echo #   5 deploy via deploy/vps-deploy.sh: git pull + npm ci + build
>>"%TMPSCRIPT%" echo #      + restart + health gate + auto-rollback
>>"%TMPSCRIPT%" echo #   6 live logs via journalctl -f
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo B=callflow
>>"%TMPSCRIPT%" echo HR=------------------------------------------------------------
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "[1/6] Clearing port 3000 conflicts"
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo if ss -ltnp ^| grep -q ':3000 '; then
>>"%TMPSCRIPT%" echo   echo "  port 3000 busy - squatters found:"
>>"%TMPSCRIPT%" echo   ss -ltnp ^| grep ':3000 '
>>"%TMPSCRIPT%" echo   PIDS=$(ss -ltnp 2^>/dev/null ^| grep ':3000 ' ^| grep -oE 'pid=[0-9]+' ^| cut -d= -f2 ^| sort -u)
>>"%TMPSCRIPT%" echo   [ -n "$PIDS" ] ^&^& kill -9 $PIDS 2^>/dev/null ^&^& echo "  killed pid(s): $PIDS"
>>"%TMPSCRIPT%" echo   fuser -k 3000/tcp 2^>/dev/null ^|^| true
>>"%TMPSCRIPT%" echo   pkill -9 -f 'next-server' 2^>/dev/null ^|^| true
>>"%TMPSCRIPT%" echo   pkill -9 -f 'next start' 2^>/dev/null ^|^| true
>>"%TMPSCRIPT%" echo   sleep 1
>>"%TMPSCRIPT%" echo   if ss -ltnp ^| grep -q ':3000 '; then
>>"%TMPSCRIPT%" echo     echo "  WARNING: port 3000 is STILL busy - deploy may hit EADDRINUSE"
>>"%TMPSCRIPT%" echo   else
>>"%TMPSCRIPT%" echo     echo "  port 3000 is free now"
>>"%TMPSCRIPT%" echo   fi
>>"%TMPSCRIPT%" echo else
>>"%TMPSCRIPT%" echo   echo "  port 3000 already free - nothing to kill"
>>"%TMPSCRIPT%" echo fi
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "[2/6] Resetting systemd crash limit for $B"
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo systemctl reset-failed "$B" 2^>/dev/null ^|^| true
>>"%TMPSCRIPT%" echo systemctl daemon-reload 2^>/dev/null ^|^| true
>>"%TMPSCRIPT%" echo echo "  done - failed state wiped, start-limit counter cleared"
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "[3/6] Locating the app checkout"
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo APP_DIR=
>>"%TMPSCRIPT%" echo for d in /srv/callflow /opt/callflow; do
>>"%TMPSCRIPT%" echo   [ -d "$d/.git" ] ^&^& APP_DIR=$d ^&^& break
>>"%TMPSCRIPT%" echo done
>>"%TMPSCRIPT%" echo if [ -z "$APP_DIR" ]; then
>>"%TMPSCRIPT%" echo   echo "  ERROR: no git checkout found at /srv/callflow or /opt/callflow"
>>"%TMPSCRIPT%" echo   exit 78
>>"%TMPSCRIPT%" echo fi
>>"%TMPSCRIPT%" echo APP_USER=$(stat -c '%%U' "$APP_DIR")
>>"%TMPSCRIPT%" echo BRANCH=$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2^>/dev/null)
>>"%TMPSCRIPT%" echo echo "  APP_DIR=$APP_DIR   APP_USER=$APP_USER   BRANCH=${BRANCH:-main}"
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "[4/6] Pulling latest code from GitHub"
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo runuser -u "$APP_USER" -- git -C "$APP_DIR" -c user.name=fix-and-deploy -c user.email=fix-and-deploy@localhost stash push -u -m 'fix-and-deploy auto-stash' ^>/dev/null 2^>^&1 ^|^| true
>>"%TMPSCRIPT%" echo echo "  server-local edits (if any) auto-stashed; deploy will hard-reset to origin"
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "[5/6] Deploy: git pull + npm ci + build + restart + health gate"
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo DEPLOY_RC=0
>>"%TMPSCRIPT%" echo if [ -f "$APP_DIR/deploy/vps-deploy.sh" ]; then
>>"%TMPSCRIPT%" echo   bash "$APP_DIR/deploy/vps-deploy.sh" ^|^| DEPLOY_RC=$?
>>"%TMPSCRIPT%" echo else
>>"%TMPSCRIPT%" echo   echo "  (deploy/vps-deploy.sh missing from checkout - inline fallback)"
>>"%TMPSCRIPT%" echo   runuser -u "$APP_USER" -- git -C "$APP_DIR" fetch origin
>>"%TMPSCRIPT%" echo   runuser -u "$APP_USER" -- git -C "$APP_DIR" reset --hard "origin/${BRANCH:-main}"
>>"%TMPSCRIPT%" echo   runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"
>>"%TMPSCRIPT%" echo   systemctl restart "$B"
>>"%TMPSCRIPT%" echo   sleep 4
>>"%TMPSCRIPT%" echo fi
>>"%TMPSCRIPT%" echo.
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "[6/6] Service status + live logs"
>>"%TMPSCRIPT%" echo echo "$HR"
>>"%TMPSCRIPT%" echo echo "  service state : $(systemctl is-active "$B")"
>>"%TMPSCRIPT%" echo curl -s -o /dev/null -w '  local http    : %%{http_code}\n' http://127.0.0.1:3000/ ^|^| true
>>"%TMPSCRIPT%" echo [ "$DEPLOY_RC" -ne 0 ] ^&^& echo "  !! deploy exited with code $DEPLOY_RC - read the output above" ^|^| true
>>"%TMPSCRIPT%" echo echo
>>"%TMPSCRIPT%" echo echo "  >>> LIVE LOGS - journalctl -u $B -f - press Ctrl+C to stop <<<"
>>"%TMPSCRIPT%" echo echo
>>"%TMPSCRIPT%" echo journalctl -u "$B" -f -n 40 --no-pager
exit /b 0