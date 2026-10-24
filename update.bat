@echo off
setlocal EnableExtensions
title CallFlow - install WEBHOOK_SECRET on Vultr
set /p DG_KEY="Enter the WEBHOOK_SECRET value to install on the VPS: "
echo.
echo Connecting to Vultr: replacing any WEBHOOK_SECRET / DOGRAH_WEBHOOK_SECRET
echo line in /srv/callflow/.env (old value backed up to .env.bak-secret-update)...
echo.
ssh root@45.76.252.174 "cd /srv/callflow && touch .env && chmod 600 .env && cp .env .env.bak-secret-update && sed -i '/^WEBHOOK_SECRET=/d;/^DOGRAH_WEBHOOK_SECRET=/d' .env && echo WEBHOOK_SECRET=%DG_KEY% >> .env && echo Done. Env vars now: && sed -n 's/=.*/=***hidden***/p' .env"
echo.
echo Restarting the app and showing logs (Ctrl+C to quit)...
echo.
ssh root@45.76.252.174 "systemctl restart callflow && journalctl -u callflow -f -n 20"
pause