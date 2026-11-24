@echo off
rem © 2026 Kushal Parajuli
title Kam Chai Nabirsa - Local Helper Server
cd /d "%~dp0"

echo ========================================================
echo   Kam Chai Nabirsa - Local Helper Server
echo   Copyright (c) 2026 Kushal Parajuli
echo ========================================================
echo.

if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
) else (
    echo [WARNING] Virtual environment not found in helper\venv. Running with system python...
)

python server.py
pause
