@echo off
rem ---------------------------------------------------------------------------
rem  biz2code launcher — double-click this file.
rem
rem  Starts the API and the web app, waits for the web server to actually accept
rem  a connection, then opens the browser. Closing this window (or Ctrl+C) stops
rem  both servers.
rem
rem  Every failure below pauses instead of exiting, because a window that closes
rem  instantly tells a user nothing.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title biz2code

echo.
echo   biz2code
echo   ----------------------------------------------------------
echo.

rem -- Node -------------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed, or not on your PATH.
  echo   Install version 20 or newer from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

rem -- already running? -------------------------------------------------------
rem  Opening a second copy would fail on the port bind and look like a crash.
rem  Two literal searches, not one regex: a findstr regex containing a space
rem  gets split by cmd and the tail is read as a filename.
netstat -ano | findstr /c:":5173" | findstr /c:"LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo   biz2code is already running. Opening it in your browser.
  echo.
  start "" http://localhost:5173
  timeout /t 3 >nul
  exit /b 0
)

rem -- configuration ----------------------------------------------------------
if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo   Created .env from the example.
  )
  echo.
  echo   Before the first run, open .env and fill in three values:
  echo.
  echo     DATABASE_URL   e.g. postgres://localhost:5432/biz2code
  echo     JWT_SECRET     any long random string
  echo     GROQ_API_KEY   free key from https://console.groq.com/keys
  echo.
  echo   Then run this file again. Setup details are in INSTALL.md.
  echo.
  pause
  exit /b 1
)

rem -- dependencies -----------------------------------------------------------
if not exist "node_modules" (
  echo   First run — installing dependencies. This takes a minute or two.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
  echo.
)

rem -- database ---------------------------------------------------------------
rem  Safe to repeat: applied migrations are skipped, and it reads .env rather
rem  than the shell, which is where DATABASE_URL actually lives.
echo   Preparing the database...
call npm run db:init
if errorlevel 1 (
  echo.
  echo   The database could not be prepared.
  echo.
  echo   Most likely one of:
  echo     - PostgreSQL is not running
  echo     - the database does not exist yet   ^(createdb biz2code^)
  echo     - DATABASE_URL in .env is wrong
  echo.
  echo   Troubleshooting is in INSTALL.md.
  echo.
  pause
  exit /b 1
)
echo.

rem -- open the browser once the port is genuinely accepting -------------------
rem  A fixed sleep either opens a dead tab or wastes time. This polls the socket
rem  and gives up after ~60s so a failed start never leaves a process behind.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=[Diagnostics.Stopwatch]::StartNew();" ^
  "while($d.Elapsed.TotalSeconds -lt 60){" ^
  "  try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',5173);$c.Close();" ^
  "      Start-Process 'http://localhost:5173';break}" ^
  "  catch{Start-Sleep -Milliseconds 400}}"

echo   Starting biz2code. Your browser will open when it is ready.
echo   Keep this window open — closing it stops the app.
echo.

call npm run dev

echo.
echo   biz2code has stopped.
echo.
pause
