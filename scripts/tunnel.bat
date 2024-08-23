rem @echo off
REM This script expects VARIABLE="..."

setlocal enabledelayedexpansion

REM Define the path to the .env file
set "filename=..\.env"

REM Read the .env file and set environment variables
for /F "delims== tokens=1,* eol=#" %%i in (%filename%) do (
    set %%i=%%~j
)

REM Process PRIVATE_SSH_KEY and replace \n with real newlines
set key=%PRIVATE_SSH_KEY%
set key=!key:\n=^

!

REM Write PRIVATE_SSH_KEY to id_rsa file
(
echo !key!
) > "%USERPROFILE%\.ssh\id_rsa"

ssh -N -L %SSH_TUNNEL_FORWARD% -i "%USERPROFILE%\.ssh\id_rsa" -o StrictHostKeyChecking=no -p %SSH_TUNNEL_PORT% %SSH_TUNNEL_TARGET%
