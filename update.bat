@echo off
rem Double-click to fetch new episodes and publish them. Needs Python and Git installed.
cd /d "%~dp0"

echo [1/4] Getting the latest code from GitHub...
git pull --no-edit
if errorlevel 1 (echo Could not reach GitHub. Check your internet connection. & pause & exit /b 1)

echo [2/4] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
  echo Python is not installed, or not on PATH.
  echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH", then run this again.
  pause & exit /b 1
)
python --version

echo [3/4] Installing or updating yt-dlp (can take a minute the first time)...
python -m pip install --upgrade --disable-pip-version-check --no-warn-script-location yt-dlp

echo [4/4] Downloading new episodes...
python ingest.py

git add data
git diff --cached --quiet || git commit -m "Add new episode transcripts"
set AHEAD=0
for /f %%i in ('git rev-list --count @{u}..HEAD') do set AHEAD=%%i
if "%AHEAD%"=="0" (
  echo Nothing new to publish.
) else (
  git push && echo Published. The site updates in about a minute.
)
pause
