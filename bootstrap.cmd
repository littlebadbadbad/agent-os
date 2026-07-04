@echo off
REM bootstrap.cmd  —  One-time project setup using nodeenv
REM
REM Creates a Node.js virtual environment (.nodeenv/) with the correct
REM Node version, installs pnpm, and runs pnpm install.
REM If the environment already exists, all steps are skipped.
REM At the end, the nodeenv is activated automatically.
REM
REM Prerequisites:
REM   Python 3.x with pip (nodeenv is installed automatically)
REM
REM Usage:
REM   bootstrap.cmd
REM   bootstrap.cmd --python C:\path\to\python.exe

setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "PYTHON="

REM Parse arguments
:parse
if not "%~1"=="" (
    if /I "%~1"=="--python" (
        set "PYTHON=%~2"
        shift
        shift
        goto parse
    )
    shift
    goto parse
)

REM Find Python if not specified
if "%PYTHON%"=="" (
    where python >nul 2>nul
    if !errorlevel! equ 0 (
        set "PYTHON=python"
    ) else (
        echo ERROR: Python not found on PATH. Install Python 3.x or pass --python.
        exit /b 1
    )
)

echo ==========================================
echo  Agent SDK — Project Bootstrap
echo ==========================================
echo  Python:  %PYTHON%
echo  Root:    %ROOT%
echo.

REM ----- Step 1: Ensure nodeenv Python package -----
echo [1/4] Ensuring nodeenv is installed...
"%PYTHON%" -m pip install nodeenv
if %errorlevel% neq 0 (
    echo ERROR: Failed to install nodeenv.
    exit /b 1
)

REM ----- Step 2: Ensure Node.js virtual environment -----
echo.
echo [2/4] Checking Node.js virtual environment (.nodeenv/)...
if exist "%ROOT%.nodeenv" (
    echo  .nodeenv/ already exists, skipping creation.
) else (
    echo  Creating .nodeenv/ ...
    "%PYTHON%" -m nodeenv --node=26.3.0 --prebuilt "%ROOT%.nodeenv"
    if !errorlevel! neq 0 (
        echo ERROR: Failed to create nodeenv environment.
        exit /b 1
    )
)

REM Verify node is available
if not exist "%ROOT%.nodeenv\Scripts\node.exe" (
    echo ERROR: node.exe not found in .nodeenv\Scripts\
    exit /b 1
)
for /f "tokens=*" %%i in ('"%ROOT%.nodeenv\Scripts\node.exe" --version') do set "NODE_VER=%%i"
echo  Node %NODE_VER%

REM ----- Step 3: Ensure pnpm is installed -----
echo.
echo [3/4] Ensuring pnpm is installed...
if exist "%ROOT%.nodeenv\Scripts\pnpm.cmd" (
    echo  pnpm already installed, skipping.
) else (
    echo  Installing pnpm@10.6.5 ...
    "%ROOT%.nodeenv\Scripts\npm.cmd" install -g pnpm@10.6.5
    if !errorlevel! neq 0 (
        echo ERROR: Failed to install pnpm.
        exit /b 1
    )
)

REM ----- Step 4: Install project dependencies -----
echo.
echo [4/4] Checking project dependencies...

REM Set proxy for downloading Electron binary (and other remote assets)
@REM set HTTP_PROXY=http://localhost:7890
@REM set HTTPS_PROXY=http://localhost:7890

REM Cache Electron binary under the project directory to avoid re-download
set ELECTRON_CACHE=%ROOT%.electron-cache

if exist "%ROOT%node_modules" (
    echo  node_modules already exists, skipping pnpm install.
) else (
    echo  Running pnpm install ...
    "%ROOT%.nodeenv\Scripts\pnpm.cmd" install
    if !errorlevel! neq 0 (
        echo ERROR: pnpm install failed.
        exit /b 1
    )
)

echo.
echo ==========================================
echo  Bootstrap complete!
echo ==========================================
echo.

REM ----- Auto-activate nodeenv -----
echo Activating node virtual environment...
call "%ROOT%.nodeenv\Scripts\activate.bat"

echo.
echo ==========================================
echo  Environment activated!
echo ==========================================
echo  Node:    %NODE_VER%
for /f "tokens=*" %%i in ('pnpm --version') do set "PNPM_VER=%%i"
echo  pnpm:   v%PNPM_VER%
echo.
echo  Starting a new development shell...
echo  Type "exit" to close when done.
echo.

REM Launch a new cmd session with nodeenv pre-activated
"%ComSpec%" /k "cd /d "%ROOT%" && title Agent SDK && echo Environment ready! && node --version && echo. && echo Run: pnpm start"
